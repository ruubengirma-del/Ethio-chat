import React, { useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { compressImage, processPostVideoFile } from '../../lib/mediaCompression';
import { dispatchMentionNotifications } from '../../lib/socialHelpers';
import { Post, MediaType, AudienceVisibility } from '../../types';
import { AudienceSelector } from '../common/AudienceSelector';
import {
  X,
  Image as ImageIcon,
  Video as VideoIcon,
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  MessageSquareOff,
  Users
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupContext?: { groupId: string; groupName: string } | null;
}

interface PendingPhoto {
  id: string;
  dataUrl: string;
  thumbUrl: string;
  origSize: number;
  compSize: number;
}

const MAX_PHOTOS_PER_POST = 200;

export const CreatePostModal: React.FC<CreatePostModalProps> = ({
  isOpen,
  onClose,
  groupContext = null,
}) => {
  const { userProfile, allUsers } = useAuth();
  const { t } = useLanguage();
  const [content, setContent] = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('none');
  const [mediaUrl, setMediaUrl] = useState<string>('');
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [visibility, setVisibility] = useState<AudienceVisibility>('public');
  const [excludedUserIds, setExcludedUserIds] = useState<string[]>(
    userProfile?.closeFriendsExcludedIds || []
  );
  const [allowedUserIds, setAllowedUserIds] = useState<string[]>(
    userProfile?.selectedFriendIds || []
  );
  const [commentsDisabled, setCommentsDisabled] = useState(false);
  const [compressionStats, setCompressionStats] = useState<{ orig: number; comp: number } | null>(
    null
  );
  const [compressProgress, setCompressProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [videoUploadPct, setVideoUploadPct] = useState<number | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !userProfile) return null;

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
    setCompressProgress({ current: 0, total: toProcess.length });

    try {
      const processed: PendingPhoto[] = [];
      let totalOrig = compressionStats?.orig || 0;
      let totalComp = compressionStats?.comp || 0;

      for (let i = 0; i < toProcess.length; i++) {
        setCompressProgress({ current: i + 1, total: toProcess.length });
        const file = toProcess[i];
        const full = await compressImage(file, 1080, 1080, 0.72);
        const thumb = await compressImage(file, 320, 320, 0.56);
        totalOrig += full.originalSize;
        totalComp += full.sizeBytes;
        processed.push({
          id: `ph_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          dataUrl: full.dataUrl,
          thumbUrl: thumb.dataUrl,
          origSize: full.originalSize,
          compSize: full.sizeBytes,
        });
      }

      const nextPhotos = [...photos, ...processed];
      setPhotos(nextPhotos);
      setMediaType('image');
      setMediaUrl(nextPhotos[0]?.dataUrl || '');
      setCompressionStats({ orig: totalOrig, comp: totalComp });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to process and compress images');
    } finally {
      setIsCompressing(false);
      setCompressProgress(null);
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
      setPhotos([]);
      setMediaUrl(res.url);
      setMediaType('video');
      setCompressionStats({
        orig: res.sizeBytes,
        comp: res.sizeBytes,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to upload video file');
    } finally {
      setIsCompressing(false);
      setVideoUploadPct(null);
      e.target.value = '';
    }
  };

  const removePhotoAt = (idx: number) => {
    const next = photos.filter((_, i) => i !== idx);
    setPhotos(next);
    if (next.length === 0) {
      setMediaType('none');
      setMediaUrl('');
      setCompressionStats(null);
    } else {
      setMediaUrl(next[0].dataUrl);
    }
  };

  const removeAllMedia = () => {
    setMediaType('none');
    setMediaUrl('');
    setPhotos([]);
    setCompressionStats(null);
  };

  const handleCreatePost = async () => {
    const hasMedia =
      (mediaType === 'image' && photos.length > 0) || (mediaType === 'video' && Boolean(mediaUrl));
    if (!content.trim() && !hasMedia) {
      setErrorMsg('Please write a message or attach a photo/video');
      return;
    }

    setIsPosting(true);
    setErrorMsg(null);

    const postId = `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const isMultiPhoto = mediaType === 'image' && photos.length > 1;
    const previewThumbs = isMultiPhoto ? photos.slice(0, 4).map((p) => p.thumbUrl) : [];

    const newPost: Post = {
      postId,
      authorId: userProfile.userId,
      authorUsername: userProfile.username,
      authorDisplayName: userProfile.displayName,
      ...(userProfile.photoURL ? { authorPhotoURL: userProfile.photoURL } : {}),
      content: content.trim(),
      mediaUrl: isMultiPhoto
        ? previewThumbs[0] || ''
        : mediaType === 'image'
        ? photos[0]?.dataUrl || ''
        : mediaType === 'video'
        ? mediaUrl
        : '',
      mediaType,
      ...(isMultiPhoto ? { previewPhotos: previewThumbs } : {}),
      totalPhotosCount: mediaType === 'image' ? photos.length : 0,
      visibility: groupContext ? 'public' : visibility,
      excludedUserIds: groupContext ? [] : excludedUserIds,
      allowedUserIds: groupContext ? [] : allowedUserIds,
      commentsDisabled,
      ...(groupContext
        ? {
            groupId: groupContext.groupId,
            groupName: groupContext.groupName.slice(0, 80),
          }
        : {}),
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      viewsCount: 0,
      reportsCount: 0,
      createdAt: now,
    };

    try {
      await setDoc(doc(db, 'posts', postId), newPost);

      // Persist all photos (up to 200) in subcollection in safe batched chunks of 15
      if (isMultiPhoto) {
        for (let i = 0; i < photos.length; i += 15) {
          const chunk = photos.slice(i, i + 15);
          const batch = writeBatch(db);
          chunk.forEach((p, offset) => {
            const orderIndex = i + offset;
            const photoId = `ph_${orderIndex}_${p.id.slice(-6)}`;
            batch.set(doc(db, 'posts', postId, 'photos', photoId), {
              photoId,
              postId,
              orderIndex,
              mediaUrl: p.dataUrl,
              likesCount: 0,
              commentsCount: 0,
              createdAt: now,
            });
          });
          await batch.commit();
        }
      }

      // Notify @mentioned users in Firestore & Push
      await dispatchMentionNotifications({
        text: content,
        postId,
        actor: userProfile,
        knownUsers: allUsers,
      });

      confetti({
        particleCount: 45,
        spread: 60,
        origin: { y: 0.8 },
        colors: ['#7560DF', '#9E8CF8', '#FFD166'],
      });
      setContent('');
      removeAllMedia();
      setCommentsDisabled(false);
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `posts/${postId}`);
    } finally {
      setIsPosting(false);
    }
  };

  const formatKB = (bytes: number) => {
    if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    return Math.round(bytes / 1024) + 'KB';
  };

  const hasContentOrMedia =
    Boolean(content.trim()) ||
    (mediaType === 'image' && photos.length > 0) ||
    (mediaType === 'video' && Boolean(mediaUrl));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-lg rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#7560DF]" />
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              {t('createPost')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Group Context Banner (posts go directly to Home feed) */}
          {groupContext && (
            <div className="px-3.5 py-2.5 rounded-2xl bg-[#7560DF]/10 border border-[#7560DF]/30 flex items-center gap-2 text-xs font-bold text-[#7560DF] dark:text-[#B09EFC]">
              <Users className="w-4 h-4 shrink-0" />
              <span className="truncate">
                Posting in {groupContext.groupName} (appears on Home)
              </span>
            </div>
          )}

          {/* User Preview */}
          <div className="flex items-center gap-3">
            <img
              src={
                userProfile.photoURL ||
                `https://api.dicebear.com/7.x/bottts/svg?seed=${userProfile.username}`
              }
              alt={userProfile.displayName}
              className="w-11 h-11 rounded-full object-cover ring-2 ring-[#7560DF]/30"
            />
            <div>
              <div className="font-bold text-sm text-slate-900 dark:text-white">
                {userProfile.displayName}
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                @{userProfile.username}
              </span>
            </div>
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write a post, @mention someone, or attach up to 200 photos / video..."
            rows={4}
            maxLength={2000}
            className="w-full text-base bg-transparent border-0 focus:ring-0 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 resize-none outline-none leading-relaxed"
          />

          {/* Single or Multi-Photo Preview (up to 200) */}
          {mediaType === 'image' && photos.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
                <span>
                  {photos.length} / {MAX_PHOTOS_PER_POST} {t('photosCountLabel')}
                </span>
                <button
                  type="button"
                  onClick={removeAllMedia}
                  className="text-rose-500 hover:underline text-xs font-semibold"
                >
                  Remove all
                </button>
              </div>

              {photos.length === 1 ? (
                <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-purple-900/50 bg-slate-50 dark:bg-black/30">
                  <img
                    src={photos[0].dataUrl}
                    alt="Attachment preview"
                    className="w-full max-h-72 object-contain bg-slate-900/5"
                  />
                  <button
                    onClick={() => removePhotoAt(0)}
                    className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-900/70 hover:bg-slate-900 text-white backdrop-blur-md"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
                  {photos.map((p, idx) => (
                    <div
                      key={p.id}
                      className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 dark:border-purple-900/50 bg-slate-100 dark:bg-[#201c38]"
                    >
                      <img
                        src={p.thumbUrl}
                        alt={`Selected ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/65 text-white text-[9px] font-bold">
                        {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePhotoAt(idx)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white hover:bg-rose-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {compressionStats && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 text-emerald-300 text-xs font-semibold border border-emerald-500/30">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    Optimized: {formatKB(compressionStats.orig)} → {formatKB(compressionStats.comp)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Video Preview */}
          {mediaType === 'video' && mediaUrl && (
            <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-purple-900/50 bg-slate-50 dark:bg-black/30">
              <video src={mediaUrl} controls className="w-full max-h-72 object-contain bg-black" />
              <button
                onClick={removeAllMedia}
                className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-900/70 hover:bg-slate-900 text-white backdrop-blur-md transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {isCompressing && (
            <div className="p-4 rounded-2xl bg-[#7560DF]/10 border border-[#7560DF]/30 space-y-2 text-sm text-[#7560DF] dark:text-[#A798F8]">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                <span>
                  {compressProgress
                    ? `Optimizing photo ${compressProgress.current} of ${compressProgress.total}...`
                    : videoUploadPct !== null
                    ? `Uploading video... ${videoUploadPct}%`
                    : 'Validating and preparing media...'}
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

          {/* 4 Audience Privacy Selector (only for regular Home posts; Group posts are public to Home) */}
          {!groupContext && (
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
          )}

          {/* Turn Off Comments Switch */}
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
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 flex items-center gap-2.5 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-5 py-4 border-t border-slate-100 dark:border-purple-950/40 bg-slate-50/50 dark:bg-[#120f24]/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 sm:gap-2">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleSelectImages}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-purple-900/40 transition-colors"
            >
              <ImageIcon className="w-4 h-4 text-emerald-500" />
              <span>{t('photo')} (up to 200)</span>
            </button>

            <input
              type="file"
              ref={videoInputRef}
              accept="video/*"
              className="hidden"
              onChange={handleSelectVideo}
            />
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-purple-900/40 transition-colors"
            >
              <VideoIcon className="w-4 h-4 text-blue-500" />
              <span className="hidden sm:inline">{t('video')}</span>
            </button>
          </div>

          <button
            onClick={handleCreatePost}
            disabled={isPosting || isCompressing || !hasContentOrMedia}
            className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] disabled:opacity-50 text-white font-bold text-sm shadow-md shadow-[#7560DF]/25 hover:shadow-lg transition-all"
          >
            {isPosting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Posting...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>{t('publish')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
