import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  deleteDoc,
  getDocs,
  getDocsFromServer
} from 'firebase/firestore';
import { Post, Story } from '../../types';
import { isAudienceVisibleToUser } from '../../lib/socialHelpers';
import { PostCard } from './PostCard';
import { CreatePostModal } from './CreatePostModal';
import { CommentsModal } from './CommentsModal';
import { CreateStoryModal } from './CreateStoryModal';
import { StoryViewerModal } from './StoryViewerModal';
import { 
  Plus, 
  Image as ImageIcon, 
  Video as VideoIcon, 
  Sparkles, 
  Radio,
  X,
  RefreshCw,
  ArrowDown,
  CheckCircle2
} from 'lucide-react';

interface FeedViewProps {
  onViewProfile: (userId: string) => void;
  onOpenGroup?: (groupId: string) => void;
  focusedPostId?: string | null;
  focusedCommentId?: string | null;
  onClearFocusedPost?: () => void;
  onClearFocusedComment?: () => void;
  newFollowingPostsCount?: number;
  onMarkHomeSeen?: () => void;
  externalRefreshSignal?: number;
}

export const FeedView: React.FC<FeedViewProps> = ({
  onViewProfile,
  onOpenGroup,
  focusedPostId,
  focusedCommentId,
  onClearFocusedPost,
  onClearFocusedComment,
  newFollowingPostsCount = 0,
  onMarkHomeSeen,
  externalRefreshSignal = 0,
}) => {
  const { userProfile, currentUser, blockedIds } = useAuth();
  const { t } = useLanguage();
  const [posts, setPosts] = useState<Post[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isCreateStoryOpen, setIsCreateStoryOpen] = useState<boolean>(false);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [viewingStoryIndex, setViewingStoryIndex] = useState<number | null>(null);
  const [activeCommentsPost, setActiveCommentsPost] = useState<Post | null>(null);

  // Pull-to-refresh state (triggers when user pulls down & holds or releases past threshold)
  const [pullDistance, setPullDistance] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshJustDone, setRefreshJustDone] = useState<boolean>(false);
  const [listenerVersion, setListenerVersion] = useState<number>(0);

  const touchStartYRef = useRef<number | null>(null);
  const isPointerDraggingRef = useRef<boolean>(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshingRef = useRef<boolean>(false);
  const pullDistanceRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const updatePullDistance = useCallback((value: number) => {
    pullDistanceRef.current = value;
    setPullDistance(value);
  }, []);

  const PULL_THRESHOLD = 62;

  const isAtTopOfScroll = useCallback(() => {
    if (typeof window !== 'undefined' && window.scrollY > 4) return false;
    let el: HTMLElement | null = containerRef.current;
    while (el) {
      if (el.scrollTop > 4) return false;
      el = el.parentElement;
    }
    return true;
  }, []);

  const triggerFeedRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    touchStartYRef.current = null;
    isPointerDraggingRef.current = false;
    setIsRefreshing(true);
    updatePullDistance(PULL_THRESHOLD);

    const startedAt = Date.now();
    try {
      const postsQ = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
      const storiesQ = query(collection(db, 'stories'), orderBy('createdAt', 'desc'));

      const [postsSnap, storiesSnap] = await Promise.all([
        getDocsFromServer(postsQ).catch(() => getDocs(postsQ)),
        getDocsFromServer(storiesQ).catch(() => getDocs(storiesQ)),
      ]);

      const freshPosts: Post[] = [];
      postsSnap.forEach((docSnap) => freshPosts.push(docSnap.data() as Post));
      setPosts(freshPosts);

      const freshStories: Story[] = [];
      const now = Date.now();
      storiesSnap.forEach((d) => {
        const st = d.data() as Story;
        if (!st.expiresAt || new Date(st.expiresAt).getTime() > now) {
          freshStories.push(st);
        }
      });
      setStories(freshStories);
      setListenerVersion((v) => v + 1);
      onMarkHomeSeen?.();
    } catch (err) {
      console.warn('Pull-to-refresh notice:', err);
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 550) {
        await new Promise((r) => setTimeout(r, 550 - elapsed));
      }
      refreshingRef.current = false;
      setIsRefreshing(false);
      updatePullDistance(0);
      setRefreshJustDone(true);
      setTimeout(() => setRefreshJustDone(false), 1800);
    }
  }, [onMarkHomeSeen, updatePullDistance]);

  useEffect(() => {
    if (externalRefreshSignal > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      triggerFeedRefresh();
    }
  }, [externalRefreshSignal, triggerFeedRefresh]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  const startPullGesture = (clientY: number) => {
    if (refreshingRef.current || !isAtTopOfScroll()) return;
    touchStartYRef.current = clientY;
  };

  const movePullGesture = (clientY: number) => {
    if (touchStartYRef.current === null || refreshingRef.current) return;
    if (!isAtTopOfScroll()) {
      touchStartYRef.current = null;
      updatePullDistance(0);
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      return;
    }

    const delta = clientY - touchStartYRef.current;
    if (delta <= 0) {
      updatePullDistance(0);
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      return;
    }

    const damped = Math.min(92, Math.round(delta * 0.52));
    updatePullDistance(damped);

    // If user pulls down past threshold and holds briefly (~380ms), trigger refresh automatically
    if (damped >= PULL_THRESHOLD) {
      if (!holdTimerRef.current) {
        holdTimerRef.current = setTimeout(() => {
          triggerFeedRefresh();
        }, 380);
      }
    } else if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const endPullGesture = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const shouldRefresh = pullDistanceRef.current >= PULL_THRESHOLD && !refreshingRef.current;
    touchStartYRef.current = null;
    isPointerDraggingRef.current = false;

    if (shouldRefresh) {
      triggerFeedRefresh();
    } else if (!refreshingRef.current) {
      updatePullDistance(0);
    }
  };

  // Real-time snapshot listener on posts (newest first)
  useEffect(() => {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Post[] = [];
      snapshot.forEach((docSnap) => {
        list.push(docSnap.data() as Post);
      });
      setPosts(list);
      setLoading(false);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'posts');
      } catch (err) {
        console.warn('Posts listener notice:', err);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, listenerVersion]);

  // Real-time snapshot listener on stories (auto-delete expired stories after 24h)
  useEffect(() => {
    const q = query(collection(db, 'stories'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: Story[] = [];
        const now = Date.now();
        snapshot.forEach((d) => {
          const st = d.data() as Story;
          if (!st.expiresAt || new Date(st.expiresAt).getTime() > now) {
            list.push(st);
          } else if (currentUser && st.authorId === currentUser.uid) {
            deleteDoc(doc(db, 'stories', st.storyId)).catch(() => {});
          }
        });
        setStories(list);
      },
      (err) => console.warn('Stories listener notice:', err)
    );
    return () => unsub();
  }, [currentUser, listenerVersion]);

  // Filter posts by privacy audience & blocked users (and optional ?post= deep link)
  const visiblePosts = useMemo(() => {
    const allowed = posts.filter((post) => {
      if (blockedIds.has(post.authorId)) return false;
      return isAudienceVisibleToUser(post, currentUser?.uid);
    });
    if (focusedPostId) {
      const focused = allowed.filter((p) => p.postId === focusedPostId);
      if (focused.length > 0) return focused;
    }
    return allowed;
  }, [posts, blockedIds, currentUser, focusedPostId]);

  // Auto-open CommentsModal when navigating from a comment @mention notification or FCM link
  useEffect(() => {
    if (!focusedPostId) return;
    const postEl = document.getElementById(`post-${focusedPostId}`);
    if (postEl) {
      postEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (focusedCommentId) {
      const targetPost = posts.find((p) => p.postId === focusedPostId);
      if (targetPost) {
        setActiveCommentsPost(targetPost);
      }
    }
  }, [focusedPostId, focusedCommentId, posts]);

  // Filter stories by privacy audience & blocked users
  const visibleStories = useMemo(() => {
    return stories.filter((story) => {
      if (blockedIds.has(story.authorId)) return false;
      return isAudienceVisibleToUser(story, currentUser?.uid);
    });
  }, [stories, blockedIds, currentUser]);

  return (
    <div
      ref={containerRef}
      onTouchStart={(e) => {
        if (e.touches.length === 1) startPullGesture(e.touches[0].clientY);
      }}
      onTouchMove={(e) => {
        if (e.touches.length === 1) movePullGesture(e.touches[0].clientY);
      }}
      onTouchEnd={endPullGesture}
      onTouchCancel={endPullGesture}
      onMouseDown={(e) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
        isPointerDraggingRef.current = true;
        startPullGesture(e.clientY);
      }}
      onMouseMove={(e) => {
        if (isPointerDraggingRef.current) movePullGesture(e.clientY);
      }}
      onMouseUp={() => {
        if (isPointerDraggingRef.current) endPullGesture();
      }}
      onMouseLeave={() => {
        if (isPointerDraggingRef.current) endPullGesture();
      }}
      className="max-w-xl mx-auto px-4 py-4 space-y-4 pb-24 min-h-[calc(100dvh-8rem)] overscroll-y-contain"
    >
      {/* Pull-to-Refresh Indicator */}
      {(pullDistance > 8 || isRefreshing || refreshJustDone) && (
        <div
          style={{
            height: isRefreshing ? 46 : refreshJustDone ? 40 : Math.min(54, Math.max(28, pullDistance * 0.65)),
          }}
          className="flex items-center justify-center transition-all duration-200 overflow-hidden"
        >
          <div className="px-4 py-1.5 rounded-full bg-white dark:bg-[#1a1633] border border-[#7560DF]/35 shadow-md flex items-center gap-2 text-xs font-bold text-[#7560DF] dark:text-[#B09EFC]">
            {isRefreshing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Refreshing Home...</span>
              </>
            ) : refreshJustDone ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">Home updated!</span>
              </>
            ) : (
              <>
                <ArrowDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    pullDistance >= PULL_THRESHOLD ? 'rotate-180' : ''
                  }`}
                />
                <span>
                  {pullDistance >= PULL_THRESHOLD
                    ? 'Hold or release to refresh'
                    : 'Pull down to refresh'}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {newFollowingPostsCount > 0 && !isRefreshing && (
        <div className="flex justify-center sticky top-18 z-20">
          <button
            type="button"
            onClick={() => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              triggerFeedRefresh();
              onMarkHomeSeen?.();
            }}
            className="px-4 py-2 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-extrabold shadow-lg shadow-[#7560DF]/35 flex items-center gap-2 transition-transform active:scale-95 animate-bounce"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>
              {newFollowingPostsCount} {t('newFollowingPostsTap')}
            </span>
          </button>
        </div>
      )}

      {focusedPostId && (
        <div className="px-4 py-2.5 rounded-2xl bg-[#7560DF]/10 dark:bg-[#7560DF]/20 border border-[#7560DF]/30 flex items-center justify-between text-xs">
          <span className="font-bold text-[#7560DF] dark:text-[#B09EFC]">
            Viewing shared post link
          </span>
          {onClearFocusedPost && (
            <button
              onClick={onClearFocusedPost}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#7560DF] text-white font-bold text-[11px]"
            >
              <X className="w-3 h-3" />
              <span>Show All Home</span>
            </button>
          )}
        </div>
      )}

      {/* Stories Bar (strictly shows users who posted an active Story) */}
      <div className="bg-white dark:bg-[#16132b] rounded-3xl p-3.5 border border-slate-200/80 dark:border-purple-950/40 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between mb-2.5 px-1">
          <div className="flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-[#7560DF] animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              {t('storiesAndCommunity')}
            </span>
          </div>
          <span className="text-[11px] font-semibold text-[#7560DF] dark:text-[#A798F8]">
            {visibleStories.length}
          </span>
        </div>

        <div className="flex items-center gap-3 overflow-x-auto pb-1 no-scrollbar">
          {/* Add Story Bubble */}
          <div 
            onClick={() => setIsCreateStoryOpen(true)}
            className="flex flex-col items-center gap-1 cursor-pointer shrink-0 group"
          >
            <div className="relative w-14 h-14 rounded-full border-2 border-dashed border-[#7560DF] flex items-center justify-center bg-[#7560DF]/5 group-hover:bg-[#7560DF]/15 transition-all">
              <Plus className="w-6 h-6 text-[#7560DF]" />
            </div>
            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate w-14 text-center">
              {t('addStory')}
            </span>
          </div>

          {/* Active Stories */}
          {visibleStories.map((st, idx) => (
            <div
              key={st.storyId}
              onClick={() => setViewingStoryIndex(idx)}
              className="flex flex-col items-center gap-1 cursor-pointer shrink-0 group"
              title={`View ${st.authorDisplayName}'s story`}
            >
              <div className="relative w-14 h-14 rounded-full p-0.5 bg-gradient-to-tr from-rose-500 via-[#7560DF] to-amber-400 group-hover:scale-105 transition-transform">
                <img
                  src={st.authorPhotoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${st.authorUsername}`}
                  alt={st.authorDisplayName}
                  className="w-full h-full rounded-full object-cover border-2 border-white dark:border-[#16132b]"
                />
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 px-1.5 py-0.2 rounded-full bg-[#7560DF] text-white text-[8px] font-bold uppercase">
                  Story
                </span>
              </div>
              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate w-14 text-center">
                {st.authorId === currentUser?.uid ? 'Your Story' : st.authorDisplayName.split(' ')[0]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* "What's on your mind?" Post Creator Trigger */}
      <div className="bg-white dark:bg-[#16132b] rounded-3xl p-4 border border-slate-200/80 dark:border-purple-950/40 shadow-sm space-y-3">
        <div className="flex items-center gap-3">
          {userProfile && (
            <img
              src={userProfile.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${userProfile.username}`}
              alt={userProfile.displayName}
              className="w-10 h-10 rounded-full object-cover ring-2 ring-[#7560DF]/30 cursor-pointer"
              onClick={() => onViewProfile(userProfile.userId)}
            />
          )}
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex-1 text-left px-4 py-2.5 rounded-full bg-slate-100 dark:bg-[#201c38] text-slate-500 dark:text-slate-400 text-xs sm:text-sm hover:bg-slate-200/70 dark:hover:bg-[#272244] transition-colors truncate"
          >
            {t('whatsOnMind')}, {userProfile?.displayName?.split(' ')[0] || 'Friend'}?
          </button>
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-purple-950/30 flex items-center justify-around text-xs font-semibold text-slate-600 dark:text-slate-300">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-purple-950/30 transition-colors text-emerald-600 dark:text-emerald-400"
          >
            <ImageIcon className="w-4 h-4" />
            <span>{t('photo')}</span>
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-purple-950/30 transition-colors text-blue-600 dark:text-blue-400"
          >
            <VideoIcon className="w-4 h-4" />
            <span>{t('video')}</span>
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-purple-950/30 transition-colors text-[#7560DF] dark:text-[#A798F8]"
          >
            <Sparkles className="w-4 h-4" />
            <span>{t('post')}</span>
          </button>
        </div>
      </div>

      {/* Posts Stream (Home shows Photos, Text, and Videos) */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((n) => (
            <div key={n} className="bg-white dark:bg-[#16132b] rounded-3xl p-5 border border-slate-100 dark:border-purple-950/30 animate-pulse space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-slate-200 dark:bg-purple-900/40" />
                <div className="space-y-2 flex-1">
                  <div className="w-32 h-4 rounded bg-slate-200 dark:bg-purple-900/40" />
                  <div className="w-20 h-3 rounded bg-slate-100 dark:bg-purple-900/20" />
                </div>
              </div>
              <div className="w-full h-16 rounded-xl bg-slate-100 dark:bg-purple-900/20" />
            </div>
          ))}
        </div>
      ) : visiblePosts.length === 0 ? (
        <div className="bg-white dark:bg-[#16132b] rounded-3xl p-8 border border-slate-200/80 dark:border-purple-950/40 text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-[#7560DF]/10 text-[#7560DF] flex items-center justify-center mx-auto">
            <Sparkles className="w-7 h-7" />
          </div>
          <h4 className="font-bold text-base text-slate-900 dark:text-white">
            {t('homeEmptyTitle')}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
            Share a text update, photo, or video with your chosen audience!
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-5 py-2.5 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-xs shadow-md shadow-[#7560DF]/25 transition-all inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>{t('createPost')}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {visiblePosts.map((post) => (
            <PostCard
              key={post.postId}
              post={post}
              highlighted={focusedPostId === post.postId}
              onOpenComments={(p) => setActiveCommentsPost(p)}
              onViewProfile={onViewProfile}
              onOpenGroup={onOpenGroup}
            />
          ))}
        </div>
      )}

      {/* Post Creation Modal */}
      <CreatePostModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />

      {/* Story Creation / Edit Modal */}
      <CreateStoryModal
        isOpen={isCreateStoryOpen || editingStory !== null}
        editStory={editingStory}
        onClose={() => {
          setIsCreateStoryOpen(false);
          setEditingStory(null);
        }}
      />

      {/* Story Viewer Modal */}
      {viewingStoryIndex !== null && visibleStories.length > 0 && (
        <StoryViewerModal
          stories={visibleStories}
          initialIndex={viewingStoryIndex}
          onClose={() => setViewingStoryIndex(null)}
          onViewProfile={onViewProfile}
          onEditStory={(st) => {
            setViewingStoryIndex(null);
            setEditingStory(st);
          }}
        />
      )}

      {/* Comments Drawer */}
      <CommentsModal
        post={activeCommentsPost}
        onClose={() => {
          setActiveCommentsPost(null);
          onClearFocusedComment?.();
        }}
        onViewProfile={onViewProfile}
        highlightedCommentId={focusedCommentId}
        onClearHighlightedComment={onClearFocusedComment}
      />
    </div>
  );
};
