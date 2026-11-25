import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  increment
} from 'firebase/firestore';
import { SocialGroup, Post } from '../../types';
import { isAudienceVisibleToUser } from '../../lib/socialHelpers';
import { PostCard } from './PostCard';
import { CreatePostModal } from './CreatePostModal';
import { CommentsModal } from './CommentsModal';
import {
  ArrowLeft,
  Users,
  Plus,
  Image as ImageIcon,
  Video as VideoIcon,
  Sparkles,
  Lock,
  Unlock,
  Trash2,
  LogOut,
  Crown,
  Check,
  Loader2,
  Home
} from 'lucide-react';

interface GroupViewModalProps {
  groupId: string | null;
  initialGroup?: SocialGroup | null;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
}

export const GroupViewModal: React.FC<GroupViewModalProps> = ({
  groupId,
  initialGroup = null,
  onClose,
  onViewProfile,
}) => {
  const { currentUser, userProfile, blockedIds } = useAuth();
  const { t } = useLanguage();

  const [group, setGroup] = useState<SocialGroup | null>(initialGroup);
  const [groupPosts, setGroupPosts] = useState<Post[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [isCreatePostOpen, setIsCreatePostOpen] = useState(false);
  const [activeCommentsPost, setActiveCommentsPost] = useState<Post | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  useEffect(() => {
    setGroup(initialGroup || null);
    setConfirmDelete(false);
  }, [groupId, initialGroup]);

  // Listen to live group doc
  useEffect(() => {
    if (!groupId) return;
    const unsub = onSnapshot(
      doc(db, 'groups', groupId),
      (snap) => {
        if (snap.exists()) {
          setGroup(snap.data() as SocialGroup);
        } else {
          setGroup(null);
        }
      },
      () => {}
    );
    return () => unsub();
  }, [groupId]);

  // Listen to posts belonging to this group (client-side sort by createdAt desc avoids composite index issues)
  useEffect(() => {
    if (!groupId) {
      setGroupPosts([]);
      setLoadingPosts(false);
      return;
    }
    setLoadingPosts(true);
    const q = query(collection(db, 'posts'), where('groupId', '==', groupId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Post[] = [];
        snap.forEach((d) => list.push(d.data() as Post));
        list.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setGroupPosts(list);
        setLoadingPosts(false);
      },
      () => {
        setLoadingPosts(false);
      }
    );
    return () => unsub();
  }, [groupId]);

  const visiblePosts = useMemo(() => {
    return groupPosts.filter(
      (p) => !blockedIds.has(p.authorId) && isAudienceVisibleToUser(p, currentUser?.uid)
    );
  }, [groupPosts, blockedIds, currentUser?.uid]);

  if (!groupId) return null;

  const isOwner = Boolean(currentUser && group && group.ownerId === currentUser.uid);
  const isMember = Boolean(
    currentUser && group && (isOwner || (group.memberIds || []).includes(currentUser.uid))
  );
  const canPost = Boolean(isMember && group && (!group.postingLocked || isOwner));

  const handleJoinGroup = async () => {
    if (!currentUser || !group || busyAction) return;
    setBusyAction(true);
    try {
      await updateDoc(doc(db, 'groups', group.groupId), {
        memberIds: arrayUnion(currentUser.uid),
        memberCount: increment(1),
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!currentUser || !group || isOwner || busyAction) return;
    setBusyAction(true);
    try {
      await updateDoc(doc(db, 'groups', group.groupId), {
        memberIds: arrayRemove(currentUser.uid),
        memberCount: increment(-1),
        updatedAt: new Date().toISOString(),
      });
      onClose();
    } finally {
      setBusyAction(false);
    }
  };

  const handleToggleLock = async () => {
    if (!isOwner || !group || busyAction) return;
    setBusyAction(true);
    try {
      await updateDoc(doc(db, 'groups', group.groupId), {
        postingLocked: !group.postingLocked,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!isOwner || !group || busyAction) return;
    setBusyAction(true);
    try {
      await deleteDoc(doc(db, 'groups', group.groupId));
      onClose();
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-[#0f0d1a] flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="px-4 py-3 bg-white dark:bg-[#16132b] border-b border-slate-200/80 dark:border-purple-950/40 flex items-center justify-between gap-2 shrink-0 shadow-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="p-2 -ml-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-purple-900/30 shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {group?.photoURL ? (
            <img
              src={group.photoURL}
              alt={group.name}
              className="w-10 h-10 rounded-2xl object-cover shrink-0 ring-1 ring-slate-200 dark:ring-purple-800"
            />
          ) : (
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] text-white flex items-center justify-center shrink-0 font-black">
              <Users className="w-5 h-5" />
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                {group?.name || 'Group'}
              </h3>
              {isOwner ? (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 text-[10px] font-extrabold inline-flex items-center gap-0.5 shrink-0">
                  <Crown className="w-2.5 h-2.5" />
                  {t('ownerBadge')}
                </span>
              ) : isMember ? (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-extrabold inline-flex items-center gap-0.5 shrink-0">
                  <Check className="w-2.5 h-2.5" />
                  {t('joinedBadge')}
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {(group?.memberCount ?? group?.memberIds?.length ?? 1).toLocaleString()} {t('membersCount')}
              {group?.description ? ` · ${group.description}` : ''}
            </p>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {group && !isMember && (
            <button
              type="button"
              disabled={busyAction}
              onClick={handleJoinGroup}
              className="px-3.5 py-2 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold flex items-center gap-1 shadow-sm"
            >
              {busyAction ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{t('joinGroupBtn')}</span>
            </button>
          )}

          {group && isOwner && (
            <>
              <button
                type="button"
                disabled={busyAction}
                onClick={handleToggleLock}
                className={`p-2 rounded-xl text-xs font-bold ${
                  group.postingLocked
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                }`}
                title={group.postingLocked ? t('unlockPosting') : t('lockPosting')}
              >
                {group.postingLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </button>

              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="p-2 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 hover:bg-rose-500/25"
                  title={t('deleteGroup')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={handleDeleteGroup}
                    className="px-2.5 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold"
                  >
                    {t('yesBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold"
                  >
                    {t('noBtn')}
                  </button>
                </div>
              )}
            </>
          )}

          {group && isMember && !isOwner && (
            <button
              type="button"
              disabled={busyAction}
              onClick={handleLeaveGroup}
              className="px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1"
              title={t('leaveGroup')}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('leaveGroup')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Scrollable Content (Post-Only Group Hub — NO Chat Box) */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-xl mx-auto space-y-4 pb-16">
          {!group ? (
            <div className="bg-white dark:bg-[#16132b] rounded-3xl p-8 border border-slate-200/80 dark:border-purple-950/40 text-center space-y-2">
              <Users className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Group not found or deleted
              </p>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-[#7560DF] text-white text-xs font-bold"
              >
                Go Back
              </button>
            </div>
          ) : (
            <>
              {/* Home-Synced Notice Banner */}
              <div className="px-4 py-2.5 rounded-2xl bg-[#7560DF]/10 dark:bg-[#7560DF]/20 border border-[#7560DF]/25 flex items-center gap-2 text-xs font-semibold text-[#7560DF] dark:text-[#B09EFC]">
                <Home className="w-4 h-4 shrink-0" />
                <span>Posts shared in this group (text, photos, videos) appear directly on Home.</span>
              </div>

              {/* Group Post Composer Box (Replaces any chat box; Post-only!) */}
              {!isMember ? (
                <div className="bg-white dark:bg-[#16132b] rounded-3xl p-5 border border-slate-200/80 dark:border-purple-950/40 text-center space-y-3">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Join <strong>{group.name}</strong> to post text, photos, or videos to Home.
                  </p>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={handleJoinGroup}
                    className="px-5 py-2.5 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-md shadow-[#7560DF]/25"
                  >
                    {busyAction ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    <span>{t('joinGroupBtn')} Group</span>
                  </button>
                </div>
              ) : canPost ? (
                <div className="bg-white dark:bg-[#16132b] rounded-3xl p-4 border border-slate-200/80 dark:border-purple-950/40 shadow-sm space-y-3">
                  <div className="flex items-center gap-3">
                    {userProfile && (
                      <img
                        src={userProfile.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${userProfile.username}`}
                        alt={userProfile.displayName}
                        className="w-10 h-10 rounded-full object-cover ring-2 ring-[#7560DF]/30 shrink-0"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setIsCreatePostOpen(true)}
                      className="flex-1 text-left px-4 py-2.5 rounded-full bg-slate-100 dark:bg-[#201c38] text-slate-500 dark:text-slate-400 text-xs sm:text-sm hover:bg-slate-200/70 dark:hover:bg-[#272244] transition-colors truncate"
                    >
                      Post in {group.name}...
                    </button>
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-purple-950/30 flex items-center justify-around text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setIsCreatePostOpen(true)}
                      className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-purple-950/30 text-emerald-600 dark:text-emerald-400"
                    >
                      <ImageIcon className="w-4 h-4" />
                      <span>{t('photo')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreatePostOpen(true)}
                      className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-purple-950/30 text-blue-600 dark:text-blue-400"
                    >
                      <VideoIcon className="w-4 h-4" />
                      <span>{t('video')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreatePostOpen(true)}
                      className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-purple-950/30 text-[#7560DF] dark:text-[#A798F8]"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>{t('post')}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/40 text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-2">
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>{t('groupPostingLockedBanner')}</span>
                </div>
              )}

              {/* Group Posts Feed */}
              {loadingPosts ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-[#7560DF]" />
                </div>
              ) : visiblePosts.length === 0 ? (
                <div className="bg-white dark:bg-[#16132b] rounded-3xl p-8 border border-slate-200/80 dark:border-purple-950/40 text-center space-y-2">
                  <Sparkles className="w-8 h-8 text-[#7560DF] mx-auto opacity-60" />
                  <p className="text-sm font-bold text-slate-800 dark:text-white">
                    No posts in {group.name} yet
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Share a text update, photo, or video — it will appear here and on Home!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {visiblePosts.map((post) => (
                    <PostCard
                      key={post.postId}
                      post={post}
                      onOpenComments={(p) => setActiveCommentsPost(p)}
                      onViewProfile={(uid) => {
                        onClose();
                        onViewProfile(uid);
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Create Post inside Group (saved to /posts with groupId & groupName so it appears on Home) */}
      {group && (
        <CreatePostModal
          isOpen={isCreatePostOpen}
          onClose={() => setIsCreatePostOpen(false)}
          groupContext={{ groupId: group.groupId, groupName: group.name }}
        />
      )}

      {/* Comments Modal */}
      <CommentsModal
        post={activeCommentsPost}
        onClose={() => setActiveCommentsPost(null)}
        onViewProfile={(uid) => {
          setActiveCommentsPost(null);
          onClose();
          onViewProfile(uid);
        }}
      />
    </div>
  );
};
