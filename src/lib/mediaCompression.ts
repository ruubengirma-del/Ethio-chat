/**
 * Client-side high efficiency media compression utility
 * Compresses images via Canvas API and validates + persists videos to cloud Firestore chunks.
 */
import { Bytes, doc, getDoc, setDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

export async function compressImage(
  file: File | Blob, 
  maxWidth: number = 1080, 
  maxHeight: number = 1080, 
  quality: number = 0.78
): Promise<{ dataUrl: string; sizeBytes: number; originalSize: number }> {
  const originalSize = file.size;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }

        // Smooth high quality scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to WebP if supported or JPEG fallback
        const format = 'image/jpeg';
        const dataUrl = canvas.toDataURL(format, quality);
        const approxSize = Math.round((dataUrl.length * 3) / 4);

        resolve({
          dataUrl,
          sizeBytes: approxSize,
          originalSize
        });
      };
      img.onerror = (err) => reject(new Error('Failed to load image for compression'));
      img.src = event.target?.result as string;
    };
    reader.onerror = (err) => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Handle small inline video files (e.g. Stories / Report evidence stored in Firestore/email)
 */
export async function processVideoFile(file: File): Promise<{
  dataUrl: string;
  thumbnailUrl: string;
  duration: number;
  sizeBytes: number;
}> {
  return new Promise((resolve, reject) => {
    // Limit raw inline video in Firestore/email to 20MB
    if (file.size > 20 * 1024 * 1024) {
      reject(new Error('Video size exceeds 20MB limit. Please select a shorter video.'));
      return;
    }

    const video = document.createElement('video');
    video.preload = 'metadata';
    const blobUrl = URL.createObjectURL(file);
    video.src = blobUrl;

    video.onloadedmetadata = () => {
      // Seek slightly into video for good thumbnail
      video.currentTime = Math.min(1.0, video.duration / 2);
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth, 640);
      canvas.height = Math.round((canvas.width / (video.videoWidth || 1)) * video.videoHeight);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.7);

      const reader = new FileReader();
      reader.onload = (e) => {
        resolve({
          dataUrl: e.target?.result as string,
          thumbnailUrl,
          duration: Math.round(video.duration),
          sizeBytes: file.size
        });
        URL.revokeObjectURL(blobUrl);
      };
      reader.readAsDataURL(file);
    };

    video.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('Unable to read video file. Format may not be supported by browser.'));
    };
  });
}

export const MAX_CHAT_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_POST_VIDEO_BYTES = 790 * 1024 * 1024; // 790 MB
export const MAX_POST_VIDEO_SECONDS = 30 * 60; // Strictly under 30 minutes (< 1800s)

export function getVideoDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const blobUrl = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(blobUrl);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Could not read video duration. Please choose a valid video file.'));
    }, 12000);

    video.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const dur = video.duration;
      cleanup();
      if (!Number.isFinite(dur) || dur <= 0) {
        reject(new Error('Unable to determine video duration. Please try another video.'));
        return;
      }
      resolve(dur);
    };

    video.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error('Unable to read video file. Format may not be supported.'));
    };

    video.src = blobUrl;
  });
}

export const PERSISTENT_CHUNK_BYTES = 700 * 1024; // 700 KB binary chunks (< 1 MiB Firestore limit)

async function persistVideoChunksToFirestore(params: {
  mediaId: string;
  fileName: string;
  mimeType: string;
  scope: 'chat' | 'post';
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const { mediaId, fileName, mimeType, scope, file, onProgress } = params;
  const ownerId = auth.currentUser?.uid || 'anonymous';
  const totalSize = file.size;
  const chunkCount = Math.max(1, Math.ceil(totalSize / PERSISTENT_CHUNK_BYTES));

  await setDoc(doc(db, 'mediaFiles', mediaId), {
    mediaId,
    ownerId,
    scope,
    fileName,
    mimeType,
    totalSize,
    chunkSize: PERSISTENT_CHUNK_BYTES,
    chunkCount,
    createdAt: new Date().toISOString(),
  });

  const BATCH_CHUNKS = 4; // ~2.8 MB per batch commit (safely below Firestore 10 MiB batch limit)
  for (let startIdx = 0; startIdx < chunkCount; startIdx += BATCH_CHUNKS) {
    const endIdx = Math.min(startIdx + BATCH_CHUNKS, chunkCount);
    const batch = writeBatch(db);

    for (let idx = startIdx; idx < endIdx; idx++) {
      const byteStart = idx * PERSISTENT_CHUNK_BYTES;
      const byteEnd = Math.min(byteStart + PERSISTENT_CHUNK_BYTES, totalSize);
      const sliceBuf = await file.slice(byteStart, byteEnd).arrayBuffer();
      const uint8 = new Uint8Array(sliceBuf);

      batch.set(doc(db, 'mediaFiles', mediaId, 'chunks', String(idx)), {
        mediaId,
        chunkIndex: idx,
        data: Bytes.fromUint8Array(uint8),
      });
    }

    await batch.commit();
    if (onProgress) {
      onProgress(Math.min(99, 50 + Math.round((endIdx / chunkCount) * 49)));
    }
  }
}

export async function deletePersistedVideoMedia(mediaUrl?: string): Promise<void> {
  if (!mediaUrl || typeof mediaUrl !== 'string') return;
  const match = mediaUrl.match(/\/api\/media\/stream\/([a-zA-Z0-9_.-]+)/);
  if (!match) return;
  const fileId = match[1];
  const mediaId = fileId.replace(/\.[^.]+$/, '');

  // Delete server disk cache if present
  fetch(`/api/media/stream/${encodeURIComponent(fileId)}`, { method: 'DELETE' }).catch(() => {});

  if (!/^[a-zA-Z0-9_-]+$/.test(mediaId)) return;
  try {
    const metaRef = doc(db, 'mediaFiles', mediaId);
    const metaSnap = await getDoc(metaRef);
    if (metaSnap.exists()) {
      const data = metaSnap.data() as { chunkCount?: number };
      const count = Number(data?.chunkCount || 0);
      const DELETE_BATCH = 150;
      for (let i = 0; i < count; i += DELETE_BATCH) {
        const batch = writeBatch(db);
        const end = Math.min(i + DELETE_BATCH, count);
        for (let idx = i; idx < end; idx++) {
          batch.delete(doc(db, 'mediaFiles', mediaId, 'chunks', String(idx)));
        }
        await batch.commit().catch(() => {});
      }
      await deleteDoc(metaRef).catch(() => {});
    }
  } catch {
    // ignore cleanup error
  }
}

export async function uploadVideoInChunks(
  file: File,
  scope: 'chat' | 'post',
  onProgress?: (percent: number) => void
): Promise<{ url: string; sizeBytes: number; mimeType: string }> {
  const initResp = await fetch('/api/media/upload-init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope,
      fileName: file.name || 'video.mp4',
      mimeType: file.type || 'video/mp4',
      totalSize: file.size,
    }),
  });

  const initData = await initResp.json().catch(() => ({}));
  if (!initResp.ok || !initData?.uploadId) {
    throw new Error(initData?.error || 'Failed to start video upload.');
  }

  const uploadId = String(initData.uploadId);
  const finalFileName = String(initData.finalFileName || `${uploadId}.mp4`);
  const chunkSize = 4 * 1024 * 1024; // 4 MB chunks (safe across reverse proxies)
  let offset = 0;

  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    const slice = file.slice(offset, end);

    const chunkResp = await fetch(
      `/api/media/upload-chunk?uploadId=${encodeURIComponent(uploadId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: slice,
      }
    );

    if (!chunkResp.ok) {
      const errData = await chunkResp.json().catch(() => ({}));
      throw new Error(errData?.error || 'Video upload interrupted. Please try again.');
    }

    offset = end;
    if (onProgress) {
      onProgress(Math.min(50, Math.round((offset / file.size) * 50)));
    }
  }

  const completeResp = await fetch('/api/media/upload-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });

  const completeData = await completeResp.json().catch(() => ({}));
  if (!completeResp.ok || !completeData?.url) {
    throw new Error(completeData?.error || 'Failed to finalize video upload.');
  }

  const resolvedMime = String(completeData.mimeType || file.type || 'video/mp4');

  // Persist video permanently to Firestore so it works across restarts & for all users until deleted by author
  await persistVideoChunksToFirestore({
    mediaId: uploadId,
    fileName: finalFileName,
    mimeType: resolvedMime,
    scope,
    file,
    onProgress,
  });

  if (onProgress) onProgress(100);
  return {
    url: String(completeData.url),
    sizeBytes: Number(completeData.fileSize || file.size),
    mimeType: resolvedMime,
  };
}

/**
 * Post Video Validation & Upload:
 * - Must be strictly under 30 minutes (< 1800 seconds)
 * - Must not exceed 790 MB
 */
export async function processPostVideoFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ url: string; duration: number; sizeBytes: number; mimeType: string }> {
  if (file.size > MAX_POST_VIDEO_BYTES) {
    const fileMB = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`Video rejected: ${fileMB} MB exceeds the 790 MB maximum limit.`);
  }

  const duration = await getVideoDurationSeconds(file);
  if (duration >= MAX_POST_VIDEO_SECONDS) {
    const mins = Math.floor(duration / 60);
    const secs = Math.round(duration % 60);
    throw new Error(
      `Video rejected: Duration (${mins}m ${secs}s) must be under 30 minutes.`
    );
  }

  const uploaded = await uploadVideoInChunks(file, 'post', onProgress);
  return {
    url: uploaded.url,
    duration: Math.round(duration),
    sizeBytes: uploaded.sizeBytes,
    mimeType: uploaded.mimeType,
  };
}

/**
 * Chat Video Validation & Upload:
 * - Supports videos up to 50 MB
 */
export async function processChatVideoFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ url: string; sizeBytes: number; mimeType: string }> {
  if (file.size > MAX_CHAT_VIDEO_BYTES) {
    const fileMB = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`Video rejected: ${fileMB} MB exceeds the 50 MB chat limit.`);
  }

  return uploadVideoInChunks(file, 'chat', onProgress);
}
