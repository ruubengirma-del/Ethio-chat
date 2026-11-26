import React, { useState, useEffect, useRef } from 'react';
import { Post, PostPhoto, MediaType, AudienceVisibility } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  compressImage,
  processPostVideoFile,
  deletePersistedVideoMedia,
} from '../../lib/mediaCompression';
import {
  dispatchMentionNotifications,
  extractMentionUsernames,
} from '../../lib/socialHelpers';
import { AudienceSelector } from '../common/AudienceSelector';
import { useBackHandler } from '../../lib/backNavigation';
import {
  X,
  Image as ImageIcon,
  Video as VideoIcon,
  Loader2,
  Check,
  AlertCircle,
  MessageSquareOff,
  Edit3,
} from 'lucide-react';

interface EditPostModalProps {
  post: Post | null;
  isOpen: boolean;
  onClose: () => void;
}

interface EditablePhoto {
  photoId: string;
  mediaUrl: string;
  thumbUrl: string;
  likesCount: number;
  commentsCount: number;
  createdAt: string;
  isNew?: boolean;
}

const MAX_PHOTOS_PER_POST = 200;

export const EditPostModal: React.FC<EditPostModalProps> = ({ post, isOpen, onClose }) => {
  const { userProfile, allUsers } = useAuth();
  const { t } = useLanguage();
  useBackHandler(isOpen, onClose);

  const [content, setContent] = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('none');
  const [mediaUrl, setMediaUrl] = useState('');
  const [photos, setPhotos] = useState<EditablePhoto[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<AudienceVisibility>('public');
  const [excludedUserIds, setExcludedUserIds] = useState<string[]>([]);
  const [allowedUserIds, setAllowedUserIds] = useState<string[]>([]);
  const [commentsDisabled, setCommentsDisabled] = useState(false);

  const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
  const [videoUploadPct, setVideoUploadPct] = useState<number | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !post) return;
    setContent(post.content || '');
    setMediaType(post.mediaType || 'none');
    setMediaUrl(post.mediaUrl || '');
    setVisibility(post.visibility || 'public');
    setExcludedUserIds(post.excludedUserIds || []);
    setAllowedUserIds(post.allowedUserIds || []);
    setCommentsDisabled(Boolean(post.commentsDisabled));
    setRemovedPhotoIds([]);
    setErrorMsg(null);

    if ((post.totalPhotosCount || 0) > 1) {
      setIsLoadingPhotos(true);
      getDocs(query(collection(db, 'posts', post.postId, 'photos'), orderBy('orderIndex', 'asc')))
        .then((snap) => {
          const loaded: EditablePhoto[] = [];
          snap.forEach((d) => {
            const p = d.data() as PostPhoto;
            loaded.push({
              photoId: p.photoId,
              mediaUrl: p.mediaUrl,
              thumbUrl: p.mediaUrl,
              likesCount: p.likesCount || 0,
              commentsCount: p.commentsCount || 0,
              createdAt: p.createdAt,
            });
          });
          setPhotos(loaded);
        })
        .catch(() => {})
        .finally(() => setIsLoadingPhotos(false));
    } else if (post.mediaType === 'image' && post.mediaUrl) {
      setPhotos([
        {
          photoId: `single_${post.postId}`,
          mediaUrl: post.mediaUrl,
          thumbUrl: post.mediaUrl,
          likesCount: 0,
          commentsCount: 0,
          createdAt: post.createdAt,
          isNew: true,
        },
      ]);
    } else {
      setPhotos([]);
    }
  }, [isOpen, post]);

  if (!isOpen || !post || !userProfile) return null;

  const handleSelectImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    if (fileList.length === 0) return;

    const remaining = MAX_PHOTOS_PER_POST - photos.length;
    if (remaining <= 0) {
      setErrorMsg(`Maximum ${MAX_PHOTOS_PER_POST} photos per post reached.`);
      e.target.value = '';
      return;
    }

    const toProcess = fileList.slice(0, remaining);
    if (fileList.length > remaining) {
      setErrorMsg(`Only added ${remaining} photo(s) to stay within the ${MAX_PHOTOS_PER_POST}-photo limit.`);
    } else {
      setErrorMsg(null);
    }

    setIsCompressing(true);
    try {
      const added: EditablePhoto[] = [];
      for (let i = 0; i < toProcess.length; i++) {
        const f = toProcess[i];
        const full = await compressImage(f, 1080, 1080, 0.72);
        const thumb = await compressImage(f, 340, 340, 0.56);
        added.push({
          photoId: `ph_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          mediaUrl: full.dataUrl,
          thumbUrl: thumb.dataUrl,
          likesCount: 0,
          commentsCount: 0,
          createdAt: new Date().toISOString(),
          isNew: true,
        });
      }
      setMediaType('image');
      setMediaUrl(photos[0]?.mediaUrl || added[0]?.mediaUrl || '');
      setPhotos((prev) => [...prev, ...added]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to compress selected photo(s)');
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleSelectVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setIsCompressing(true);
    setVideoUploadPct(0);
    try {
      const res = await processPostVideoFile(file, (pct) => setVideoUploadPct(pct));
      photos.forEach((p) => {
        if (!p.isNew) {
          setRemovedPhotoIds((prev) => [...prev, p.photoId]);
        }
      });
      setPhotos([]);
      setMediaType('video');
      setMediaUrl(res.url);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to upload video file');
    } finally {
      setIsCompressing(false);
      setVideoUploadPct(null);
      e.target.value = '';
    }
  };

  const handleRemovePhotoAt = (idx: number) => {
    const target = photos[idx];
    if (target && !target.isNew && !target.photoId.startsWith('single_')) {
      setRemovedPhotoIds((prev) => [...prev, target.photoId]);
    }
    const next = photos.filter((_, i) => i !== idx);
    setPhotos(next);
    if (next.length === 0) {
      setMediaType('none');
      setMediaUrl('');
    } else {
      setMediaUrl(next[0].mediaUrl);
    }
  };

  const handleSaveChanges = async () => {
    const hasContent = Boolean(content.trim());
    const hasPhotos = photos.length > 0 && mediaType === 'image';
    const hasVideo = Boolean(mediaUrl) && mediaType === 'video';

    if (!hasContent && !hasPhotos && !hasVideo) {
      setErrorMsg('Post cannot be empty. Write text or attach media.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    const now = new Date().toISOString();

    try {
      // Remove any deleted existing subcollection photos
      if (removedPhotoIds.length > 0) {
        const delChunks = [];
        for (let i = 0; i < removedPhotoIds.length; i += 20) {
          delChunks.push(removedPhotoIds.slice(i, i + 20));
        }
        for (const chunk of delChunks) {
          const b = writeBatch(db);
          chunk.forEach((pid) => b.delete(doc(db, 'posts', post.postId, 'photos', pid)));
          await b.commit();
        }
      }

      if (mediaType === 'image' && photos.length > 1) {
        // Persist all photos in subcollection in batches of 15
        for (let i = 0; i < photos.length; i += 15) {
          const slice = photos.slice(i, i + 15);
          const batch = writeBatch(db);
          slice.forEach((p, offset) => {
            const orderIndex = i + offset;
            const photoDocId = p.photoId.startsWith('single_')
              ? `ph_${Date.now()}_${orderIndex}`
              : p.photoId;
            batch.set(doc(db, 'posts', post.postId, 'photos', photoDocId), {
              photoId: photoDocId,
              postId: post.postId,
              orderIndex,
              mediaUrl: p.mediaUrl,
              likesCount: p.likesCount || 0,
              commentsCount: p.commentsCount || 0,
              createdAt: p.createdAt || now,
            });
          });
          await batch.commit();
        }

        const thumbs = photos.slice(0, 4).map((p) => p.thumbUrl || p.mediaUrl);
        await updateDoc(doc(db, 'posts', post.postId), {
          content: content.trim(),
          mediaType: 'image',
          mediaUrl: thumbs[0] || '',
          previewPhotos: thumbs,
          totalPhotosCount: photos.length,
          visibility,
          excludedUserIds,
          allowedUserIds,
          commentsDisabled,
          editedAt: now,
        });
      } else {
        // Single image, video, or text-only
        const resolvedMediaUrl =
          mediaType === 'image' ? photos[0]?.mediaUrl || mediaUrl : mediaType === 'video' ? mediaUrl : '';
        await updateDoc(doc(db, 'posts', post.postId), {
          content: content.trim(),
          mediaType,
          mediaUrl: resolvedMediaUrl,
          previewPhotos: [],
          totalPhotosCount: mediaType === 'image' ? 1 : 0,
          visibility,
          excludedUserIds,
          allowedUserIds,
          commentsDisabled,
          editedAt: now,
        });
      }

      if (post.mediaType === 'video' && post.mediaUrl) {
        const nextUrl = mediaType === 'video' ? mediaUrl : '';
        if (nextUrl !== post.mediaUrl) {
          deletePersistedVideoMedia(post.mediaUrl).catch(() => {});
        }
      }

      const prevHandles = new Set(
        extractMentionUsernames(post.content || '').map((h) => h.toLowerCase())
      );
      const addedHandles = extractMentionUsernames(content).filter(
        (h) => !prevHandles.has(h.toLowerCase())
      );
      if (addedHandles.length > 0) {
        await dispatchMentionNotifications({
          text: content,
          postId: post.postId,
          actor: userProfile,
          knownUsers: allUsers,
          onlyHandles: addedHandles,
        });
      }

      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update post');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-lg rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-[#7560DF]" />
            <h2 className="font-bold text-base text-slate-900 dark:text-white">{t('editPost')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Update your post text..."
            rows={4}
            maxLength={2000}
            className="w-full text-base bg-slate-50/70 dark:bg-[#201c38] rounded-2xl p-3.5 border border-slate-200/80 dark:border-purple-900/40 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 resize-none outline-none focus:ring-2 focus:ring-[#7560DF]"
          />

          {isLoadingPhotos && (
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#201c38] flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-[#7560DF]" />
              <span>Loading post photos...</span>
            </div>
          )}

          {/* Photos preview grid */}
          {mediaType === 'image' && photos.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
                <span>
                  {photos.length} / {MAX_PHOTOS_PER_POST} {t('photosCountLabel')}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
                {photos.map((p, idx) => (
                  <div
                    key={p.photoId}
                    className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/40"
                  >
                    <img src={p.mediaUrl} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => handleRemovePhotoAt(idx)}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white hover:bg-rose-600 transition-colors"
                      title="Remove photo"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Video preview */}
          {mediaType === 'video' && mediaUrl && (
            <div className="relative rounded-2xl overflow-hidden bg-black">
              <video src={mediaUrl} controls className="w-full max-h-60 object-contain" />
              <button
                type="button"
                onClick={() => {
                  setMediaType('none');
                  setMediaUrl('');
                }}
                className="absolute top-2.5 right-2.5 p-1.5 rounded-full bg-black/70 text-white hover:bg-rose-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {isCompressing && (
            <div className="p-3 rounded-2xl bg-[#7560DF]/10 text-[#7560DF] text-xs space-y-1.5">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>
                  {videoUploadPct !== null ? `Uploading video... ${videoUploadPct}%` : 'Compressing media...'}
                </span>
              </div>
              {videoUploadPct !== null && (
                <div className="w-full h-1.5 rounded-full bg-[#7560DF]/20 overflow-hidden">
                  <div
                    className="h-full bg-[#7560DF] transition-all duration-200"
                    style={{ width: `${videoUploadPct}%` }}
                  />
                </div>
              )}
            </div>
          )}

          <AudienceSelector
            visibility={visibility}
            excludedUserIds={excludedUserIds}
            allowedUserIds={allowedUserIds}
            onChange={(next) => {
              setVisibility(next.visibility);
              setExcludedUserIds(next.excludedUserIds);
              setAllowedUserIds(next.allowedUserIds);
            }}
          />

          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200/80 dark:border-purple-950/50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <MessageSquareOff className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {t('turnOffComments')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCommentsDisabled(!commentsDisabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                commentsDisabled ? 'bg-[#7560DF]' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                  commentsDisabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 dark:border-purple-950/40 bg-slate-50/50 dark:bg-[#120f24]/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleSelectImages}
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-purple-900/40"
            >
              <ImageIcon className="w-4 h-4 text-emerald-500" />
              <span>{t('photo')} (max 200)</span>
            </button>

            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handleSelectVideo}
            />
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-purple-900/40"
            >
              <VideoIcon className="w-4 h-4 text-blue-500" />
              <span className="hidden sm:inline">{t('video')}</span>
            </button>
          </div>

          <button
            type="button"
            disabled={isSaving || isCompressing || isLoadingPhotos}
            onClick={handleSaveChanges}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] disabled:opacity-50 text-white font-bold text-sm shadow-md shadow-[#7560DF]/25"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            <span>{t('saveChanges')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
