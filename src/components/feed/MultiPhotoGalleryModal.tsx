import React, { useState, useEffect } from 'react';
import { Post, PostPhoto, Comment } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
} from 'firebase/firestore';
import { createAppNotification, dispatchMentionNotifications, saveMediaToDevice } from '../../lib/socialHelpers';
import {
  X,
  Heart,
  MessageCircle,
  Download,
  Send,
  Loader2,
  Trash2,
  Check,
  Images,
  ZoomIn,
} from 'lucide-react';
import { MediaLightboxModal } from '../common/MediaLightboxModal';
import { GoldVerifiedBadge } from '../common/GoldVerifiedBadge';
import { useBackHandler } from '../../lib/backNavigation';

interface MultiPhotoGalleryModalProps {
  post: Post | null;
  isOpen: boolean;
  initialPhotoIndex?: number;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
}

interface PhotoItemCardProps {
  post: Post;
  photo: PostPhoto;
  index: number;
  totalCount: number;
  onViewProfile: (userId: string) => void;
  onCloseParent: () => void;
  onZoomPhoto: (photo: PostPhoto, index: number) => void;
}

const PhotoItemCard: React.FC<PhotoItemCardProps> = ({
  post,
  photo,
  index,
  totalCount,
  onViewProfile,
  onCloseParent,
  onZoomPhoto,
}) => {
  const { currentUser, userProfile, allUsers } = useAuth();
  const { t } = useLanguage();

  const [hasLiked, setHasLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(photo.likesCount || 0);
  const [commentsCount, setCommentsCount] = useState(photo.commentsCount || 0);
  const [isLiking, setIsLiking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setLikesCount(photo.likesCount || 0);
  }, [photo.likesCount]);

  useEffect(() => {
    setCommentsCount(photo.commentsCount || 0);
  }, [photo.commentsCount]);

  // Check if current user liked this individual photo
  useEffect(() => {
    if (!currentUser || photo.photoId.startsWith('fallback_')) return;
    getDoc(doc(db, 'posts', post.postId, 'photos', photo.photoId, 'likes', currentUser.uid))
      .then((snap) => setHasLiked(snap.exists()))
      .catch(() => {});
  }, [currentUser, post.postId, photo.photoId]);

  // Live comments subscription when drawer toggled open for this photo
  useEffect(() => {
    if (!showComments || photo.photoId.startsWith('fallback_')) return;
    const q = query(
      collection(db, 'posts', post.postId, 'photos', photo.photoId, 'comments'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Comment[] = [];
        snap.forEach((d) => list.push(d.data() as Comment));
        setComments(list);
      },
      (err) => console.warn('Photo comments error:', err)
    );
    return () => unsub();
  }, [showComments, post.postId, photo.photoId]);

  const handleToggleLike = async () => {
    if (!currentUser || !userProfile || isLiking || photo.photoId.startsWith('fallback_')) return;
    setIsLiking(true);

    const willLike = !hasLiked;
    setHasLiked(willLike);
    setLikesCount((prev) => (willLike ? prev + 1 : Math.max(0, prev - 1)));

    try {
      const likeRef = doc(db, 'posts', post.postId, 'photos', photo.photoId, 'likes', currentUser.uid);
      const photoRef = doc(db, 'posts', post.postId, 'photos', photo.photoId);

      if (willLike) {
        await setDoc(likeRef, {
          userId: currentUser.uid,
          photoId: photo.photoId,
          username: userProfile.username,
          displayName: userProfile.displayName,
          ...(userProfile.photoURL ? { photoURL: userProfile.photoURL } : {}),
          createdAt: new Date().toISOString(),
        });
        await updateDoc(photoRef, { likesCount: increment(1) }).catch(() => {});
        await createAppNotification({
          recipientId: post.authorId,
          actor: userProfile,
          type: 'like',
          postId: post.postId,
          text: `liked photo #${index + 1} in your post`,
        });
      } else {
        await deleteDoc(likeRef);
        await updateDoc(photoRef, { likesCount: increment(-1) }).catch(() => {});
      }
    } catch {
      setHasLiked(!willLike);
      setLikesCount((prev) => (willLike ? Math.max(0, prev - 1) : prev + 1));
    } finally {
      setIsLiking(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !userProfile || !newComment.trim() || isSubmitting) return;
    if (photo.photoId.startsWith('fallback_')) return;

    setIsSubmitting(true);
    const commentId = `pcmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const payload: Comment = {
      commentId,
      postId: post.postId,
      authorId: userProfile.userId,
      authorUsername: userProfile.username,
      authorDisplayName: userProfile.displayName,
      ...(userProfile.photoURL ? { authorPhotoURL: userProfile.photoURL } : {}),
      text: newComment.trim(),
      mediaType: 'none',
      createdAt: new Date().toISOString(),
    };

    try {
      await setDoc(
        doc(db, 'posts', post.postId, 'photos', photo.photoId, 'comments', commentId),
        payload
      );
      await updateDoc(doc(db, 'posts', post.postId, 'photos', photo.photoId), {
        commentsCount: increment(1),
      }).catch(() => {});
      setCommentsCount((prev) => prev + 1);

      await createAppNotification({
        recipientId: post.authorId,
        actor: userProfile,
        type: 'comment',
        postId: post.postId,
        commentId,
        text: `commented on photo #${index + 1}: "${newComment.trim().slice(0, 60)}"`,
      });
      await dispatchMentionNotifications({
        text: newComment.trim(),
        postId: post.postId,
        commentId,
        actor: userProfile,
        knownUsers: allUsers,
      });
      setNewComment('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (photo.photoId.startsWith('fallback_')) return;
    await deleteDoc(
      doc(db, 'posts', post.postId, 'photos', photo.photoId, 'comments', commentId)
    ).catch(() => {});
    await updateDoc(doc(db, 'posts', post.postId, 'photos', photo.photoId), {
      commentsCount: increment(-1),
    }).catch(() => {});
    setCommentsCount((prev) => Math.max(0, prev - 1));
  };

  const handleDownloadPhoto = async () => {
    if (!photo.mediaUrl || isDownloading) return;
    setIsDownloading(true);
    try {
      await saveMediaToDevice(
        photo.mediaUrl,
        `ethio_chat_${post.postId}_photo_${index + 1}.jpg`,
        'image/jpeg'
      );
      setDownloadDone(true);
      setTimeout(() => setDownloadDone(false), 1800);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      id={`gallery-photo-${index}`}
      className="bg-white dark:bg-[#16132b] rounded-3xl border border-slate-200/80 dark:border-purple-950/50 overflow-hidden shadow-sm"
    >
      <div className="relative bg-black/5 dark:bg-black/30">
        <img
          src={photo.mediaUrl}
          alt={`Photo ${index + 1} of ${totalCount}`}
          onClick={() => onZoomPhoto(photo, index)}
          className="w-full max-h-[540px] object-contain mx-auto cursor-zoom-in"
          loading="lazy"
        />
        <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/65 text-white text-[11px] font-bold backdrop-blur-md">
          {index + 1} / {totalCount}
        </span>

        <button
          type="button"
          onClick={() => onZoomPhoto(photo, index)}
          className="absolute bottom-3 right-3 p-2 rounded-full bg-black/65 hover:bg-black/85 text-white backdrop-blur-md shadow transition-all"
          title="Zoom Photo"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleDownloadPhoto}
          disabled={isDownloading}
          className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-black/65 hover:bg-black/85 text-white text-xs font-bold backdrop-blur-md flex items-center gap-1.5 shadow transition-all"
          title={t('downloadImage')}
        >
          {isDownloading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : downloadDone ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          <span>{downloadDone ? 'Saved' : t('downloadImage')}</span>
        </button>
      </div>

      {/* Per-Photo Like, Comment & Download Controls */}
      <div className="px-4 py-2.5 flex items-center justify-around border-t border-slate-100 dark:border-purple-950/30 text-xs font-bold text-slate-600 dark:text-slate-300">
        <button
          type="button"
          onClick={handleToggleLike}
          disabled={photo.photoId.startsWith('fallback_')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-2xl transition-colors ${
            hasLiked
              ? 'text-rose-500 bg-rose-50 dark:bg-rose-950/20'
              : 'hover:bg-slate-100 dark:hover:bg-purple-950/30'
          }`}
        >
          <Heart className={`w-4 h-4 ${hasLiked ? 'fill-rose-500 text-rose-500' : ''}`} />
          <span>
            {hasLiked ? t('liked') : t('like')} ({likesCount})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setShowComments((prev) => !prev)}
          disabled={photo.photoId.startsWith('fallback_') || post.commentsDisabled}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-2xl transition-colors ${
            showComments
              ? 'text-[#7560DF] bg-[#7560DF]/10'
              : 'hover:bg-slate-100 dark:hover:bg-purple-950/30'
          } disabled:opacity-50`}
        >
          <MessageCircle className="w-4 h-4 text-[#7560DF]" />
          <span>
            {t('comment')} ({commentsCount})
          </span>
        </button>

        <button
          type="button"
          onClick={handleDownloadPhoto}
          disabled={isDownloading}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-purple-950/30 transition-colors"
        >
          <Download className="w-4 h-4 text-emerald-500" />
          <span>{t('saveToGallery')}</span>
        </button>
      </div>

      {/* Per-Photo Comment Thread */}
      {showComments && !post.commentsDisabled && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-purple-950/30 space-y-3 bg-slate-50/60 dark:bg-[#120f24]/60">
          {comments.length === 0 ? (
            <p className="text-center text-[11px] text-slate-400 py-2">
              Be the first to comment on this photo.
            </p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {comments.map((c) => {
                const isCmtOwner = currentUser?.uid === c.authorId;
                return (
                  <div
                    key={c.commentId}
                    className="flex items-start gap-2.5 bg-white dark:bg-[#1d1936] p-2.5 rounded-2xl border border-slate-100 dark:border-purple-950/40"
                  >
                    <img
                      src={
                        c.authorPhotoURL ||
                        `https://api.dicebear.com/7.x/bottts/svg?seed=${c.authorUsername}`
                      }
                      alt={c.authorDisplayName}
                      onClick={() => {
                        onCloseParent();
                        onViewProfile(c.authorId);
                      }}
                      className="w-7 h-7 rounded-full object-cover cursor-pointer shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onCloseParent();
                            onViewProfile(c.authorId);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-extrabold text-slate-900 dark:text-white hover:text-[#7560DF] truncate"
                        >
                          <span className="truncate">{c.authorDisplayName}</span>
                          <GoldVerifiedBadge userId={c.authorId} size="xs" />
                        </button>
                        {isCmtOwner && (
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(c.commentId)}
                            className="p-1 text-slate-400 hover:text-rose-500"
                            title="Delete comment"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-700 dark:text-slate-200 break-words">
                        {c.text}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <form onSubmit={handleAddComment} className="flex items-center gap-2">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={`Comment on photo #${index + 1}...`}
              maxLength={600}
              className="flex-1 px-3.5 py-2 rounded-full bg-white dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
            />
            <button
              type="submit"
              disabled={!newComment.trim() || isSubmitting}
              className="p-2 rounded-full bg-[#7560DF] hover:bg-[#624ec7] disabled:opacity-40 text-white transition-colors"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export const MultiPhotoGalleryModal: React.FC<MultiPhotoGalleryModalProps> = ({
  post,
  isOpen,
  initialPhotoIndex = 0,
  onClose,
  onViewProfile,
}) => {
  useBackHandler(isOpen, onClose);
  const { userProfile } = useAuth();
  const { t } = useLanguage();
  const [photos, setPhotos] = useState<PostPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoomedItem, setZoomedItem] = useState<{ photo: PostPhoto; index: number } | null>(null);

  useEffect(() => {
    if (!isOpen || !post) return;
    setLoading(true);
    const q = query(collection(db, 'posts', post.postId, 'photos'), orderBy('orderIndex', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: PostPhoto[] = [];
        snap.forEach((d) => list.push(d.data() as PostPhoto));
        if (list.length === 0 && (post.previewPhotos?.length || post.mediaUrl)) {
          const urls =
            post.previewPhotos && post.previewPhotos.length > 0
              ? post.previewPhotos
              : post.mediaUrl
              ? [post.mediaUrl]
              : [];
          urls.forEach((url, idx) =>
            list.push({
              photoId: `fallback_${idx}`,
              postId: post.postId,
              orderIndex: idx,
              mediaUrl: url,
              likesCount: 0,
              commentsCount: 0,
              createdAt: post.createdAt,
            })
          );
        }
        setPhotos(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [isOpen, post]);

  useEffect(() => {
    if (!isOpen || loading || initialPhotoIndex <= 0) return;
    const el = document.getElementById(`gallery-photo-${initialPhotoIndex}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isOpen, loading, initialPhotoIndex]);

  if (!isOpen || !post) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-50 dark:bg-[#0f0d1a] w-full max-w-2xl h-full sm:h-[90vh] sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-purple-950/60 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 bg-white dark:bg-[#16132b] border-b border-slate-200/80 dark:border-purple-950/40 flex items-center justify-between gap-3">
          <div
            onClick={() => {
              onClose();
              onViewProfile(post.authorId);
            }}
            className="flex items-center gap-3 cursor-pointer min-w-0"
          >
            <img
              src={
                post.authorPhotoURL ||
                `https://api.dicebear.com/7.x/bottts/svg?seed=${post.authorUsername}`
              }
              alt={post.authorDisplayName}
              className="w-10 h-10 rounded-full object-cover ring-2 ring-[#7560DF]/30 shrink-0"
            />
            <div className="min-w-0">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white truncate">
                {post.authorDisplayName}
              </h3>
              <p className="text-[11px] font-bold text-[#7560DF] dark:text-[#A798F8] flex items-center gap-1">
                <Images className="w-3.5 h-3.5" />
                <span>
                  {photos.length || post.totalPhotosCount || 0} {t('photosCountLabel')}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Post Caption if present */}
        {post.content && (
          <div className="px-5 py-3 bg-white dark:bg-[#16132b] border-b border-slate-100 dark:border-purple-950/30 text-xs sm:text-sm text-slate-800 dark:text-slate-100">
            {post.content}
          </div>
        )}

        {/* All Photos List (Up to 50) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
              <Loader2 className="w-7 h-7 animate-spin text-[#7560DF]" />
              <span className="text-xs font-semibold">Loading photos...</span>
            </div>
          ) : (
            photos.map((photo, idx) => (
              <PhotoItemCard
                key={photo.photoId}
                post={post}
                photo={photo}
                index={idx}
                totalCount={photos.length}
                onViewProfile={onViewProfile}
                onCloseParent={onClose}
                onZoomPhoto={(p, i) => setZoomedItem({ photo: p, index: i })}
              />
            ))
          )}
        </div>
      </div>

      {zoomedItem && (
        <MediaLightboxModal
          isOpen={true}
          mediaType="image"
          mediaUrl={zoomedItem.photo.mediaUrl}
          title={`${post.authorDisplayName} (${zoomedItem.index + 1}/${photos.length})`}
          viewerUsername={userProfile?.username}
          onSave={() =>
            saveMediaToDevice(
              zoomedItem.photo.mediaUrl,
              `ethio_chat_${post.postId}_photo_${zoomedItem.index + 1}.jpg`,
              'image/jpeg'
            )
          }
          onClose={() => setZoomedItem(null)}
        />
      )}
    </div>
  );
};
