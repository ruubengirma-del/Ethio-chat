import React, { useState, useEffect, useRef } from 'react';
import { Post, PostLike } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
  collection,
  onSnapshot,
} from 'firebase/firestore';
import { createAppNotification, recordViewStat, saveMediaToDevice } from '../../lib/socialHelpers';
import {
  Heart,
  MessageCircle,
  Share2,
  Trash2,
  UserPlus,
  Check,
  Download,
  Globe,
  Lock,
  Users,
  UserCheck,
  MessageSquareOff,
  MoreHorizontal,
  Link as LinkIcon,
  X,
  Loader2,
  Edit3,
  Flag,
  Eye,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { deletePersistedVideoMedia } from '../../lib/mediaCompression';
import confetti from 'canvas-confetti';
import { SharePostModal } from './SharePostModal';
import { EditPostModal } from './EditPostModal';
import { ReportModal } from './ReportModal';
import { MultiPhotoGalleryModal } from './MultiPhotoGalleryModal';
import { GoldVerifiedBadge } from '../common/GoldVerifiedBadge';
import { MediaLightboxModal } from '../common/MediaLightboxModal';

interface PostCardProps {
  post: Post;
  onOpenComments: (post: Post) => void;
  onViewProfile: (userId: string) => void;
  onOpenGroup?: (groupId: string) => void;
  highlighted?: boolean;
}

export const PostCard: React.FC<PostCardProps> = ({
  post,
  onOpenComments,
  onViewProfile,
  onOpenGroup,
  highlighted = false,
}) => {
  const { currentUser, userProfile, allUsers, followingIds, followUser, unfollowUser } =
    useAuth();
  const { t } = useLanguage();
  const [hasLiked, setHasLiked] = useState<boolean>(false);
  const [likesCount, setLikesCount] = useState<number>(post.likesCount || 0);
  const [sharesCount, setSharesCount] = useState<number>(post.sharesCount || 0);
  const [viewsCount, setViewsCount] = useState<number>(post.viewsCount || 0);
  const [isLiking, setIsLiking] = useState<boolean>(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [galleryOpenIndex, setGalleryOpenIndex] = useState<number | null>(null);
  const [zoomSinglePhotoOpen, setZoomSinglePhotoOpen] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [copiedLinkToast, setCopiedLinkToast] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [videoRetryTick, setVideoRetryTick] = useState(0);

  // Facebook-style Likes Modal
  const [showLikesModal, setShowLikesModal] = useState(false);
  const [postLikes, setPostLikes] = useState<PostLike[]>([]);

  const menuRef = useRef<HTMLDivElement>(null);

  const isAuthor = currentUser?.uid === post.authorId;
  const isFollowingAuthor = followingIds.has(post.authorId);
  const isVideoPost = post.mediaType === 'video' && Boolean(post.mediaUrl);
  const canSeeViews = isVideoPost || isAuthor;

  const authorObj = allUsers.find((u) => u.userId === post.authorId);
  const showAuthorOnline = !authorObj?.hideOnlineStatus;

  const previewPhotos = post.previewPhotos || [];
  const totalPhotosCount = post.totalPhotosCount || previewPhotos.length || 0;
  const isMultiPhoto = post.mediaType === 'image' && totalPhotosCount > 1 && previewPhotos.length > 1;

  // Close `...` menu on outside click
  useEffect(() => {
    if (!showMoreMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMoreMenu]);

  // Record post view once per session
  useEffect(() => {
    if (!currentUser) return;
    recordViewStat({
      targetUserId: post.authorId,
      viewerId: currentUser.uid,
      kind: 'post',
      targetId: post.postId,
    });
  }, [post.postId, post.authorId, currentUser]);

  // Check if current user has liked this post
  useEffect(() => {
    if (!currentUser) return;
    const checkLike = async () => {
      try {
        const likeSnap = await getDoc(doc(db, 'posts', post.postId, 'likes', currentUser.uid));
        setHasLiked(likeSnap.exists());
      } catch {
        // quiet catch
      }
    };
    checkLike();
  }, [currentUser, post.postId]);

  useEffect(() => {
    setLikesCount(post.likesCount || 0);
  }, [post.likesCount]);

  useEffect(() => {
    setSharesCount(post.sharesCount || 0);
  }, [post.sharesCount]);

  useEffect(() => {
    setViewsCount(post.viewsCount || 0);
  }, [post.viewsCount]);

  useEffect(() => {
    setVideoError(false);
    setVideoRetryTick(0);
  }, [post.mediaUrl]);

  // Listen to likes list only when Likes Modal is open
  useEffect(() => {
    if (!showLikesModal) return;
    const unsub = onSnapshot(
      collection(db, 'posts', post.postId, 'likes'),
      (snap) => {
        const list: PostLike[] = [];
        snap.forEach((d) => list.push(d.data() as PostLike));
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setPostLikes(list);
      },
      (err) => console.warn('Likes list listener error:', err)
    );
    return () => unsub();
  }, [showLikesModal, post.postId]);

  const toggleLike = async () => {
    if (!currentUser || !userProfile || isLiking) return;
    setIsLiking(true);

    const willLike = !hasLiked;
    setHasLiked(willLike);
    setLikesCount((prev) => (willLike ? prev + 1 : Math.max(0, prev - 1)));

    if (willLike) {
      confetti({
        particleCount: 25,
        spread: 40,
        origin: { y: 0.7 },
        colors: ['#7560DF', '#FF4E88', '#FFB703'],
      });
    }

    try {
      const likeDocRef = doc(db, 'posts', post.postId, 'likes', currentUser.uid);
      const postDocRef = doc(db, 'posts', post.postId);

      if (willLike) {
        await setDoc(likeDocRef, {
          userId: currentUser.uid,
          postId: post.postId,
          username: userProfile.username,
          displayName: userProfile.displayName,
          ...(userProfile.photoURL ? { photoURL: userProfile.photoURL } : {}),
          createdAt: new Date().toISOString(),
        });
        await updateDoc(postDocRef, {
          likesCount: increment(1),
        }).catch(async () => {
          await setDoc(postDocRef, { ...post, likesCount: (post.likesCount || 0) + 1 }, { merge: true });
        });

        await createAppNotification({
          recipientId: post.authorId,
          actor: userProfile,
          type: 'like',
          postId: post.postId,
          text: post.content ? post.content.slice(0, 80) : 'your photo/video',
        });
      } else {
        await deleteDoc(likeDocRef);
        await updateDoc(postDocRef, {
          likesCount: increment(-1),
        }).catch(async () => {
          await setDoc(
            postDocRef,
            { ...post, likesCount: Math.max(0, (post.likesCount || 0) - 1) },
            { merge: true }
          );
        });
      }
    } catch (err) {
      setHasLiked(!willLike);
      setLikesCount((prev) => (willLike ? Math.max(0, prev - 1) : prev + 1));
      handleFirestoreError(err, OperationType.UPDATE, `posts/${post.postId}`);
    } finally {
      setIsLiking(false);
    }
  };

  const handleToggleCommentsDisabled = async () => {
    if (!isAuthor) return;
    setShowMoreMenu(false);
    await updateDoc(doc(db, 'posts', post.postId), {
      commentsDisabled: !post.commentsDisabled,
    }).catch(() => {});
  };

  const handleDeletePost = async () => {
    setShowMoreMenu(false);
    try {
      await deleteDoc(doc(db, 'posts', post.postId));
      if (post.mediaType === 'video' && post.mediaUrl) {
        await deletePersistedVideoMedia(post.mediaUrl);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `posts/${post.postId}`);
    }
  };

  // Real File Manager / Gallery Download for both Images and Videos
  const handleDownloadMedia = async () => {
    if (!post.mediaUrl || isDownloading) return;
    setIsDownloading(true);
    try {
      const ext = post.mediaType === 'video' ? 'mp4' : 'jpg';
      const mime = post.mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
      await saveMediaToDevice(post.mediaUrl, `ethio_chat_${post.postId}.${ext}`, mime);
    } finally {
      setIsDownloading(false);
    }
  };

  const getPostShareUrl = () => {
    return `${window.location.origin}/?post=${encodeURIComponent(post.postId)}`;
  };

  const handleCopyPostLink = async () => {
    const shareUrl = getPostShareUrl();
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const el = document.createElement('textarea');
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setShowMoreMenu(false);
    setCopiedLinkToast(true);
    setTimeout(() => setCopiedLinkToast(false), 2200);
  };

  const handleShare = () => {
    setShowShareModal(true);
  };

  const formatTime = (isoString: string) => {
    try {
      const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
      if (diff < 60) return 'Just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    } catch {
      return '';
    }
  };

  const renderFormattedContent = (text: string) => {
    const words = text.split(/(\s+)/);
    return words.map((word, i) => {
      if ((word.startsWith('#') || word.startsWith('@')) && word.length > 1) {
        return (
          <span
            key={i}
            className="text-[#7560DF] dark:text-[#A798F8] font-semibold hover:underline cursor-pointer"
          >
            {word}
          </span>
        );
      }
      return word;
    });
  };

  const renderVisibilityBadge = () => {
    const v = post.visibility || 'public';
    if (v === 'private')
      return (
        <span title="Private">
          <Lock className="w-3 h-3 text-amber-500" />
        </span>
      );
    if (v === 'close_friends')
      return (
        <span title="Close Friends">
          <Users className="w-3 h-3 text-rose-500" />
        </span>
      );
    if (v === 'select_friends')
      return (
        <span title="Select Friends">
          <UserCheck className="w-3 h-3 text-[#7560DF]" />
        </span>
      );
    return (
      <span title="Public">
        <Globe className="w-3 h-3 text-emerald-500" />
      </span>
    );
  };

  return (
    <>
      <article
        id={`post-${post.postId}`}
        className={`bg-white dark:bg-[#16132b] rounded-3xl border shadow-sm hover:shadow-md transition-all relative ${
          highlighted
            ? 'border-[#7560DF] ring-2 ring-[#7560DF]/40'
            : 'border-slate-200/80 dark:border-purple-950/40'
        }`}
      >
        {copiedLinkToast && (
          <div className="absolute top-3 right-14 z-20 px-3 py-1 rounded-full bg-slate-900 dark:bg-[#7560DF] text-white text-[11px] font-bold shadow-lg animate-in fade-in">
            {t('linkCopied')}
          </div>
        )}

        {/* Post Author Header */}
        <div className="p-4 sm:p-5 flex items-center justify-between gap-2">
          <div
            onClick={() => onViewProfile(post.authorId)}
            className="flex items-center gap-3 cursor-pointer group min-w-0"
          >
            <div className="relative shrink-0">
              <img
                src={
                  post.authorPhotoURL ||
                  `https://api.dicebear.com/7.x/bottts/svg?seed=${post.authorUsername}`
                }
                alt={post.authorDisplayName}
                className="w-11 h-11 rounded-full object-cover ring-2 ring-slate-100 dark:ring-purple-900/50 group-hover:ring-[#7560DF] transition-all"
              />
              {showAuthorOnline && (
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-[#16132b]" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                {isVideoPost && !isAuthor && currentUser && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isFollowingAuthor) {
                        unfollowUser(post.authorId);
                      } else {
                        followUser(post.authorId);
                      }
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-extrabold transition-all shrink-0 ${
                      isFollowingAuthor
                        ? 'bg-slate-100 dark:bg-purple-950/50 text-slate-600 dark:text-slate-300'
                        : 'bg-[#7560DF] hover:bg-[#624ec7] text-white shadow-sm shadow-[#7560DF]/25'
                    }`}
                  >
                    {isFollowingAuthor ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>{t('addedUserBtn')}</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-3 h-3" />
                        <span>{t('addUserBtn')}</span>
                      </>
                    )}
                  </button>
                )}
                <span className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors inline-flex items-center gap-1 min-w-0 max-w-full">
                  <span className="truncate">{post.authorDisplayName}</span>
                  <GoldVerifiedBadge userId={post.authorId} size="xs" />
                </span>
                <span className="text-slate-400 text-xs">·</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {formatTime(post.createdAt)}
                </span>
                {post.editedAt && (
                  <span className="text-[10px] font-semibold text-slate-400">(edited)</span>
                )}
                <span className="ml-0.5">{renderVisibilityBadge()}</span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap truncate">
                <span>@{post.authorUsername}</span>
                {post.groupId && post.groupName && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenGroup?.(post.groupId!);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#7560DF]/10 text-[#7560DF] dark:text-[#B09EFC] text-[10px] font-bold hover:bg-[#7560DF]/20 transition-colors"
                  >
                    <Users className="w-2.5 h-2.5" />
                    <span className="truncate max-w-[140px]">{post.groupName}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Controls: Follow + ... Menu */}
          <div className="flex items-center gap-1.5 shrink-0" ref={menuRef}>
            {!isAuthor && currentUser && !isVideoPost && (
              <button
                onClick={() =>
                  isFollowingAuthor ? unfollowUser(post.authorId) : followUser(post.authorId)
                }
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  isFollowingAuthor
                    ? 'bg-slate-100 dark:bg-purple-950/40 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    : 'bg-[#7560DF]/10 dark:bg-[#7560DF]/20 text-[#7560DF] dark:text-[#B09EFC] hover:bg-[#7560DF]/25'
                }`}
              >
                {isFollowingAuthor ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>{t('following')}</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{t('follow')}</span>
                  </>
                )}
              </button>
            )}

            {/* ... Post Options Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMoreMenu((prev) => !prev)}
                className="p-2 rounded-full text-slate-500 dark:text-slate-300 hover:text-[#7560DF] hover:bg-slate-100 dark:hover:bg-purple-950/40 transition-colors"
                title="Post options"
                aria-label="Post options"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>

              {showMoreMenu && (
                <div className="absolute right-0 mt-1.5 w-52 rounded-2xl bg-white dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/60 shadow-xl py-1.5 z-30 animate-in fade-in zoom-in-95 duration-150">
                  <button
                    type="button"
                    onClick={handleCopyPostLink}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-purple-900/30 flex items-center gap-2.5"
                  >
                    <LinkIcon className="w-4 h-4 text-[#7560DF]" />
                    <span>{t('copyLink')}</span>
                  </button>

                  {post.mediaUrl && post.mediaType !== 'none' && !isMultiPhoto && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMoreMenu(false);
                        handleDownloadMedia();
                      }}
                      className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-purple-900/30 flex items-center gap-2.5"
                    >
                      <Download className="w-4 h-4 text-emerald-500" />
                      <span>{t('downloadImage')}</span>
                    </button>
                  )}

                  {isAuthor ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMoreMenu(false);
                          setShowEditModal(true);
                        }}
                        className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-purple-900/30 flex items-center gap-2.5"
                      >
                        <Edit3 className="w-4 h-4 text-[#7560DF]" />
                        <span>{t('editPost')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleToggleCommentsDisabled}
                        className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-purple-900/30 flex items-center gap-2.5"
                      >
                        <MessageSquareOff className="w-4 h-4 text-amber-500" />
                        <span>{post.commentsDisabled ? 'Enable Comments' : t('turnOffComments')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleDeletePost}
                        className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-2.5"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Delete Post</span>
                      </button>
                    </>
                  ) : (
                    currentUser && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowMoreMenu(false);
                          setShowReportModal(true);
                        }}
                        className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-2.5"
                      >
                        <Flag className="w-4 h-4" />
                        <span>{t('reportPost')}</span>
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Post Text Body */}
        {post.content && (
          <div className="px-5 pb-3.5 text-sm sm:text-base text-slate-800 dark:text-slate-100 leading-relaxed break-words">
            {renderFormattedContent(post.content)}
          </div>
        )}

        {/* Attached Multi-Photo Grid (2, 3 crisp, or 3 crisp + 4th blurred with remaining/total count) OR Single Photo / Video */}
        {isMultiPhoto ? (
          <div className="border-t border-b border-slate-100 dark:border-purple-950/30 bg-slate-100 dark:bg-black/30">
            {totalPhotosCount === 2 ? (
              <div className="grid grid-cols-2 gap-1">
                {previewPhotos.slice(0, 2).map((src, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setGalleryOpenIndex(idx)}
                    className="aspect-square overflow-hidden bg-slate-200 dark:bg-black/40 relative group"
                  >
                    <img
                      src={src}
                      alt={`Photo ${idx + 1}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            ) : totalPhotosCount === 3 ? (
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setGalleryOpenIndex(0)}
                  className="row-span-2 aspect-square sm:aspect-auto sm:h-full overflow-hidden bg-slate-200 dark:bg-black/40 relative group"
                >
                  <img
                    src={previewPhotos[0]}
                    alt="Photo 1"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                </button>
                {previewPhotos.slice(1, 3).map((src, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setGalleryOpenIndex(i + 1)}
                    className="aspect-square overflow-hidden bg-slate-200 dark:bg-black/40 relative group"
                  >
                    <img
                      src={src}
                      alt={`Photo ${i + 2}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1">
                {previewPhotos.slice(0, 4).map((src, idx) => {
                  const isFourthBlurred = idx === 3;
                  const extraCount = Math.max(1, totalPhotosCount - 3);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setGalleryOpenIndex(idx)}
                      className="aspect-square overflow-hidden bg-slate-200 dark:bg-black/40 relative group"
                    >
                      <img
                        src={src}
                        alt={`Photo ${idx + 1}`}
                        className={`w-full h-full object-cover transition-transform duration-300 ${
                          isFourthBlurred
                            ? 'blur-sm scale-110 brightness-75'
                            : 'group-hover:scale-105'
                        }`}
                        loading="lazy"
                      />
                      {isFourthBlurred && (
                        <div className="absolute inset-0 bg-slate-950/55 flex flex-col items-center justify-center text-white p-2">
                          <span className="text-2xl sm:text-3xl font-black tracking-tight">
                            +{extraCount}
                          </span>
                          <span className="text-[11px] font-bold uppercase tracking-wider opacity-90">
                            {totalPhotosCount} {t('photosCountLabel')}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          post.mediaUrl &&
          post.mediaType !== 'none' && (
            <div className="relative border-t border-b border-slate-100 dark:border-purple-950/30 bg-black/5 dark:bg-black/20 overflow-hidden">
              {post.mediaType === 'image' ? (
                <img
                  src={post.mediaUrl}
                  alt="Post attachment"
                  onClick={() => setZoomSinglePhotoOpen(true)}
                  className="w-full max-h-[500px] object-cover sm:object-contain bg-slate-900/5 mx-auto cursor-zoom-in"
                  loading="lazy"
                />
              ) : videoError ? (
                <div className="w-full min-h-[240px] py-10 px-6 bg-slate-950 flex flex-col items-center justify-center text-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <div className="space-y-1 max-w-xs">
                    <p className="text-sm font-bold text-white">
                      This video cannot play right now
                    </p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      If your connection dropped, tap &quot;Retry&quot;. If this video was uploaded before recent updates, re-posting may be required.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVideoError(false);
                      setVideoRetryTick((prev) => prev + 1);
                    }}
                    className="px-4 py-2 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                </div>
              ) : (
                <video
                  key={videoRetryTick}
                  src={
                    videoRetryTick > 0
                      ? `${post.mediaUrl}${post.mediaUrl.includes('?') ? '&' : '?'}r=${videoRetryTick}`
                      : post.mediaUrl
                  }
                  controls
                  playsInline
                  preload={userProfile?.autoDownloadMedia === false ? 'none' : 'metadata'}
                  onLoadedMetadata={() => setVideoError(false)}
                  onError={() => setVideoError(true)}
                  onPlay={() => {
                    if (!currentUser) return;
                    recordViewStat({
                      targetUserId: post.authorId,
                      viewerId: currentUser.uid,
                      kind: 'post',
                      targetId: post.postId,
                    });
                  }}
                  className="w-full max-h-[500px] object-contain bg-black mx-auto"
                />
              )}

              {/* Public views badge on videos (everyone) | Author-only views badge on photos */}
              {canSeeViews && (
                <div
                  className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/65 text-white text-[11px] font-bold backdrop-blur-md flex items-center gap-1.5 shadow-md pointer-events-none"
                  title={isVideoPost ? 'Video views (visible to everyone)' : 'Photo views (visible only to you)'}
                >
                  <Eye className="w-3.5 h-3.5 text-[#A798F8]" />
                  <span>
                    {viewsCount.toLocaleString()} {viewsCount === 1 ? 'view' : 'views'}
                  </span>
                </div>
              )}

              <button
                onClick={handleDownloadMedia}
                disabled={isDownloading}
                className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-black/65 hover:bg-black/85 text-white text-xs font-bold backdrop-blur-md flex items-center gap-1.5 shadow-md transition-all"
                title={t('downloadImage')}
              >
                {isDownloading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>{t('downloadImage')}</span>
              </button>
            </div>
          )
        )}

        {/* Facebook-style Engagement Stats Bar (Likes, Comments, Shares & Views) */}
        <div className="px-5 py-2.5 flex items-center justify-between gap-2 flex-wrap text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-purple-950/30">
          <button
            type="button"
            onClick={() => setShowLikesModal(true)}
            className="flex items-center gap-1.5 hover:underline cursor-pointer"
          >
            <span className="w-5 h-5 rounded-full bg-gradient-to-tr from-[#7560DF] to-rose-500 flex items-center justify-center text-white text-[10px] shadow-sm">
              ❤️
            </span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {likesCount} {likesCount === 1 ? 'like' : 'likes'}
            </span>
          </button>

          <div className="flex items-center gap-3 flex-wrap">
            {canSeeViews && (
              <span
                className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300"
                title={isVideoPost ? 'Video views (public)' : 'Post views (author only)'}
              >
                <Eye className="w-3.5 h-3.5 text-[#7560DF]" />
                <span>
                  {viewsCount.toLocaleString()} {viewsCount === 1 ? 'view' : 'views'}
                </span>
              </span>
            )}

            <button
              type="button"
              onClick={() => onOpenComments(post)}
              className="hover:underline font-semibold text-slate-700 dark:text-slate-300"
            >
              {post.commentsDisabled
                ? t('commentsOffNotice')
                : `${post.commentsCount || 0} ${post.commentsCount === 1 ? 'comment' : 'comments'}`}
            </button>

            <button
              type="button"
              onClick={handleShare}
              className="hover:underline font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1"
            >
              <span>
                {sharesCount} {t('sharesLabel')}
              </span>
            </button>
          </div>
        </div>

        {/* Interactive Action Bar (Like, Comment, Share) */}
        <div className="px-3 py-2 flex items-center justify-around text-slate-600 dark:text-slate-300">
          <button
            onClick={toggleLike}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-2xl font-semibold text-xs sm:text-sm transition-all ${
              hasLiked
                ? 'text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20'
                : 'hover:bg-slate-100 dark:hover:bg-purple-950/30'
            }`}
          >
            <Heart
              className={`w-5 h-5 transition-transform active:scale-125 ${
                hasLiked ? 'fill-rose-500 text-rose-500' : ''
              }`}
            />
            <span>{hasLiked ? t('liked') : t('like')}</span>
          </button>

          <button
            onClick={() => onOpenComments(post)}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-purple-950/30 font-semibold text-xs sm:text-sm transition-colors"
          >
            <MessageCircle className="w-5 h-5 text-[#7560DF]" />
            <span>{t('comment')}</span>
          </button>

          <button
            onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-purple-950/30 font-semibold text-xs sm:text-sm transition-colors relative"
          >
            <Share2 className="w-5 h-5 text-blue-500" />
            <span>{t('share')}</span>
            {sharesCount > 0 && (
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                ({sharesCount})
              </span>
            )}
          </button>
        </div>
      </article>

      {/* Facebook-style Post Likes Modal */}
      {showLikesModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 flex flex-col max-h-[75vh] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-gradient-to-tr from-[#7560DF] to-rose-500 flex items-center justify-center text-white text-xs">
                  ❤️
                </span>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  {t('likesListTitle')} ({postLikes.length})
                </h3>
              </div>
              <button
                onClick={() => setShowLikesModal(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/30"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {postLikes.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-xs">{t('noLikesYet')}</div>
              ) : (
                postLikes.map((liker) => {
                  const matched = allUsers.find((u) => u.userId === liker.userId);
                  const displayName =
                    matched?.displayName || liker.displayName || 'Ethio Chat User';
                  const username = matched?.username || liker.username || 'member';
                  const photoURL =
                    matched?.photoURL ||
                    liker.photoURL ||
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;

                  return (
                    <button
                      key={liker.userId}
                      onClick={() => {
                        setShowLikesModal(false);
                        onViewProfile(liker.userId);
                      }}
                      className="w-full p-2.5 rounded-2xl hover:bg-slate-50 dark:hover:bg-[#201c38] flex items-center gap-3 text-left transition-colors"
                    >
                      <img
                        src={photoURL}
                        alt={displayName}
                        className="w-10 h-10 rounded-full object-cover ring-1 ring-slate-200 dark:ring-purple-900/50"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 min-w-0">
                          <p className="font-bold text-sm text-slate-900 dark:text-white truncate">
                            {displayName}
                          </p>
                          <GoldVerifiedBadge userId={liker.userId} size="xs" />
                        </div>
                        <p className="text-xs text-[#7560DF] dark:text-[#A798F8] truncate">
                          @{username}
                        </p>
                      </div>
                      <Heart className="w-4 h-4 fill-rose-500 text-rose-500 shrink-0" />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* In-App Only Share Modal (Users & Groups in Ethio Chat) */}
      <SharePostModal
        post={post}
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        onShared={(added) => setSharesCount((prev) => prev + added)}
      />

      {/* Author Edit Post Modal */}
      <EditPostModal
        post={post}
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
      />

      {/* Report Post Modal */}
      <ReportModal
        post={post}
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
      />

      {/* Multi-Photo Full Gallery (Per-Photo Like, Comment, Download) */}
      <MultiPhotoGalleryModal
        post={post}
        isOpen={galleryOpenIndex !== null}
        initialPhotoIndex={galleryOpenIndex ?? 0}
        onClose={() => setGalleryOpenIndex(null)}
        onViewProfile={onViewProfile}
      />

      {/* Fullscreen Zoomable Photo Lightbox for Single-Photo Posts */}
      {post.mediaUrl && post.mediaType === 'image' && !isMultiPhoto && (
        <MediaLightboxModal
          isOpen={zoomSinglePhotoOpen}
          mediaType="image"
          mediaUrl={post.mediaUrl}
          title={post.authorDisplayName}
          viewerUsername={userProfile?.username}
          onSave={handleDownloadMedia}
          onClose={() => setZoomSinglePhotoOpen(false)}
        />
      )}
    </>
  );
};
