import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, onSnapshot, getDocs, getDocsFromServer } from 'firebase/firestore';
import { Post } from '../../types';
import { isAudienceVisibleToUser } from '../../lib/socialHelpers';
import { PostCard } from '../feed/PostCard';
import { CreatePostModal } from '../feed/CreatePostModal';
import { CommentsModal } from '../feed/CommentsModal';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { PullToRefreshBanner } from '../common/PullToRefreshBanner';
import { Clapperboard, Plus, RefreshCw } from 'lucide-react';

interface VideoFeedViewProps {
  onViewProfile: (userId: string) => void;
  newVideosCount?: number;
  onMarkVideoSeen?: () => void;
  externalRefreshSignal?: number;
}

export const VideoFeedView: React.FC<VideoFeedViewProps> = ({
  onViewProfile,
  newVideosCount = 0,
  onMarkVideoSeen,
  externalRefreshSignal = 0,
}) => {
  const { currentUser, blockedIds } = useAuth();
  const { t } = useLanguage();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [activeCommentsPost, setActiveCommentsPost] = useState<Post | null>(null);
  const [listenerVersion, setListenerVersion] = useState<number>(0);

  const handleRefreshVideos = useCallback(async () => {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
    const snap = await getDocsFromServer(q).catch(() => getDocs(q));
    const fresh: Post[] = [];
    snap.forEach((docSnap) => {
      const post = docSnap.data() as Post;
      if (post.mediaType === 'video' && post.mediaUrl) {
        fresh.push(post);
      }
    });
    setPosts(fresh);
    setListenerVersion((v) => v + 1);
    onMarkVideoSeen?.();
  }, [onMarkVideoSeen]);

  const {
    containerRef,
    pullDistance,
    isRefreshing,
    refreshJustDone,
    triggerRefresh,
    pullHandlers,
  } = usePullToRefresh({
    onRefresh: handleRefreshVideos,
    externalRefreshSignal,
  });

  useEffect(() => {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: Post[] = [];
        snapshot.forEach((docSnap) => {
          const post = docSnap.data() as Post;
          if (post.mediaType === 'video' && post.mediaUrl) {
            list.push(post);
          }
        });
        setPosts(list);
        setLoading(false);
      },
      (err) => {
        console.warn('Video feed listener error:', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [currentUser, listenerVersion]);

  const visibleVideos = useMemo(() => {
    return posts.filter((post) => {
      if (blockedIds.has(post.authorId)) return false;
      return isAudienceVisibleToUser(post, currentUser?.uid);
    });
  }, [posts, blockedIds, currentUser]);

  return (
    <div
      ref={containerRef}
      {...pullHandlers}
      className="max-w-xl mx-auto px-4 py-4 space-y-4 pb-24 overscroll-y-contain"
    >
      <PullToRefreshBanner
        pullDistance={pullDistance}
        isRefreshing={isRefreshing}
        refreshJustDone={refreshJustDone}
        refreshingLabel="Refreshing Video..."
        updatedLabel="Videos updated!"
      />

      {newVideosCount > 0 && !isRefreshing && (
        <div className="flex justify-center sticky top-18 z-20">
          <button
            type="button"
            onClick={() => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              triggerRefresh();
              onMarkVideoSeen?.();
            }}
            className="px-4 py-2 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-extrabold shadow-lg shadow-[#7560DF]/35 flex items-center gap-2 transition-transform active:scale-95 animate-bounce"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>
              {newVideosCount} {t('newVideosTap')}
            </span>
          </button>
        </div>
      )}

      {/* Video Feed Header */}
      <div className="bg-white dark:bg-[#16132b] rounded-3xl px-5 py-4 border border-slate-200/80 dark:border-purple-950/40 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#7560DF]/15 text-[#7560DF] dark:text-[#A798F8] flex items-center justify-center">
            <Clapperboard className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-extrabold text-base text-slate-900 dark:text-white">
              {t('navVideo')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {visibleVideos.length} {visibleVideos.length === 1 ? 'video' : 'videos'}
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold shadow-sm transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>{t('video')}</span>
        </button>
      </div>

      {/* Videos Stream (Shows ONLY video posts with Follow, Like, Comment, Share, Copy Link, Report & Download) */}
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
              <div className="w-full h-52 rounded-xl bg-slate-100 dark:bg-purple-900/20" />
            </div>
          ))}
        </div>
      ) : visibleVideos.length === 0 ? (
        <div className="bg-white dark:bg-[#16132b] rounded-3xl p-8 border border-slate-200/80 dark:border-purple-950/40 text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-[#7560DF]/10 text-[#7560DF] flex items-center justify-center mx-auto">
            <Clapperboard className="w-7 h-7" />
          </div>
          <h4 className="font-bold text-base text-slate-900 dark:text-white">
            {t('noVideosYet')}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
            Videos shared by people on Ethio Chat will appear here for watching, liking, commenting, and sharing!
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
          {visibleVideos.map((post) => (
            <PostCard
              key={post.postId}
              post={post}
              onOpenComments={(p) => setActiveCommentsPost(p)}
              onViewProfile={onViewProfile}
            />
          ))}
        </div>
      )}

      <CreatePostModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />

      <CommentsModal
        post={activeCommentsPost}
        onClose={() => setActiveCommentsPost(null)}
        onViewProfile={onViewProfile}
      />
    </div>
  );
};
