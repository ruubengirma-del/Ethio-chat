import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import { collection, onSnapshot, doc, updateDoc, arrayUnion, increment, getDocs, getDocsFromServer } from 'firebase/firestore';
import { isPinnedAllUser, isUserOnlineNow, searchUsersWithFallback, sortUsersWithPinnedFirst } from '../../lib/socialHelpers';
import { ChatParticipant, SocialGroup, UserProfile } from '../../types';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { PullToRefreshBanner } from './PullToRefreshBanner';
import { GoldVerifiedBadge } from './GoldVerifiedBadge';
import {
  Users,
  Search,
  UserPlus,
  Check,
  MessageSquare,
  Sparkles,
  X,
  Radio,
  Plus,
  Loader2,
  ArrowRight,
  Pin
} from 'lucide-react';

interface AllUsersViewProps {
  onSelectUserToChat: (recipient: ChatParticipant) => void;
  onViewProfile: (userId: string) => void;
  onOpenGroup?: (group: SocialGroup) => void;
}

export const AllUsersView: React.FC<AllUsersViewProps> = ({
  onSelectUserToChat,
  onViewProfile,
  onOpenGroup
}) => {
  const {
    allUsers,
    currentUser,
    followingIds,
    followerIds,
    blockedIds,
    followUser,
    unfollowUser,
    refreshDirectory,
  } = useAuth();
  const { t } = useLanguage();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'follow_back' | 'added' | 'groups'>('all');
  const [showOnlineModal, setShowOnlineModal] = useState(false);
  const [allGroups, setAllGroups] = useState<SocialGroup[]>([]);
  const [joiningGroupId, setJoiningGroupId] = useState<string | null>(null);
  const [listenerVersion, setListenerVersion] = useState(0);

  const handleRefreshUsers = useCallback(async () => {
    const groupsRef = collection(db, 'groups');
    const [, groupsSnap] = await Promise.all([
      refreshDirectory(),
      getDocsFromServer(groupsRef).catch(() => getDocs(groupsRef)),
    ]);
    const list: SocialGroup[] = [];
    groupsSnap.forEach((d) => list.push(d.data() as SocialGroup));
    list.sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime()
    );
    setAllGroups(list);
    setListenerVersion((v) => v + 1);
  }, [refreshDirectory]);

  const {
    containerRef,
    pullDistance,
    isRefreshing,
    refreshJustDone,
    pullHandlers,
  } = usePullToRefresh({
    onRefresh: handleRefreshUsers,
  });

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'groups'),
      (snap) => {
        const list: SocialGroup[] = [];
        snap.forEach((d) => list.push(d.data() as SocialGroup));
        list.sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt || 0).getTime() -
            new Date(a.updatedAt || a.createdAt || 0).getTime()
        );
        setAllGroups(list);
      },
      () => {}
    );
    return () => unsub();
  }, [listenerVersion]);

  // All non-blocked users with pinned accounts permanently at top, then newest accounts first
  const sortedAllUsers = useMemo(() => {
    return sortUsersWithPinnedFirst(
      allUsers.filter((u) => u.userId !== currentUser?.uid && !blockedIds.has(u.userId))
    );
  }, [allUsers, currentUser?.uid, blockedIds]);

  // Users in your network (Added / Following OR Follow-back) who are currently online
  const onlineNetworkUsers = useMemo(() => {
    return sortedAllUsers.filter(
      (u) => (followingIds.has(u.userId) || followerIds.has(u.userId)) && isUserOnlineNow(u)
    );
  }, [sortedAllUsers, followingIds, followerIds]);

  // Pending Follow Back requests (people who added you that you haven't added back yet)
  const pendingFollowBackCount = useMemo(() => {
    return sortedAllUsers.filter((u) => followerIds.has(u.userId) && !followingIds.has(u.userId)).length;
  }, [sortedAllUsers, followerIds, followingIds]);

  const { displayedUsers, isSimilarFallback } = useMemo(() => {
    if (filterMode === 'groups') {
      return { displayedUsers: [] as UserProfile[], isSimilarFallback: false };
    }
    const modeFiltered = sortedAllUsers.filter((u) => {
      if (filterMode === 'follow_back' && !(followerIds.has(u.userId) && !followingIds.has(u.userId))) {
        return false;
      }
      if (filterMode === 'added' && !followingIds.has(u.userId)) {
        return false;
      }
      return true;
    });

    if (!searchTerm.trim()) {
      return { displayedUsers: modeFiltered, isSimilarFallback: false };
    }

    const res = searchUsersWithFallback(searchTerm, modeFiltered);
    if (res.exactMatches.length > 0) {
      return { displayedUsers: res.exactMatches, isSimilarFallback: false };
    }
    if (res.similarMatches.length > 0) {
      return { displayedUsers: res.similarMatches, isSimilarFallback: true };
    }
    if (filterMode !== 'all') {
      const globalRes = searchUsersWithFallback(searchTerm, sortedAllUsers);
      const list = globalRes.exactMatches.length > 0 ? globalRes.exactMatches : globalRes.similarMatches;
      if (list.length > 0) {
        return { displayedUsers: list, isSimilarFallback: globalRes.exactMatches.length === 0 };
      }
    }
    return { displayedUsers: [], isSimilarFallback: false };
  }, [sortedAllUsers, searchTerm, filterMode, followerIds, followingIds]);

  const matchingGroups = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return allGroups;
    return allGroups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.description || '').toLowerCase().includes(q)
    );
  }, [allGroups, searchTerm]);

  const handleJoinGroup = async (group: SocialGroup) => {
    if (!currentUser || joiningGroupId) return;
    const isAlreadyMember =
      group.ownerId === currentUser.uid || (group.memberIds || []).includes(currentUser.uid);
    if (isAlreadyMember) {
      onOpenGroup?.(group);
      return;
    }
    setJoiningGroupId(group.groupId);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'groups', group.groupId), {
        memberIds: arrayUnion(currentUser.uid),
        memberCount: increment(1),
        updatedAt: now,
      });
      onOpenGroup?.({
        ...group,
        memberIds: Array.from(new Set([...(group.memberIds || []), currentUser.uid])),
        memberCount: (group.memberCount || 0) + 1,
        updatedAt: now,
      });
    } finally {
      setJoiningGroupId(null);
    }
  };

  const formatJoined = (iso?: string) => {
    if (!iso) return 'New account';
    try {
      const diffHours = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60));
      if (diffHours < 24) return 'Joined today';
      if (diffHours < 168) return `Joined ${Math.floor(diffHours / 24)}d ago`;
      return `Joined ${new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    } catch {
      return 'Member';
    }
  };

  const showGroupsSection =
    filterMode === 'groups' || (filterMode === 'all' && searchTerm.trim().length > 0 && matchingGroups.length > 0);

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
        refreshingLabel="Refreshing All Users..."
        updatedLabel="Users updated!"
      />
      {/* Online Network Status Banner */}
      <div
        onClick={() => setShowOnlineModal(true)}
        className="bg-gradient-to-r from-emerald-500/15 via-[#7560DF]/10 to-white dark:from-emerald-950/40 dark:via-[#1c1738] dark:to-[#16132b] rounded-3xl p-4 border border-emerald-500/30 dark:border-emerald-700/40 shadow-sm cursor-pointer hover:shadow-md transition-all flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/25 shrink-0">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                {onlineNetworkUsers.length} Online Now
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 truncate">
              {t('onlineAddedUsers')} · Tap to view list & profiles
            </p>
          </div>
        </div>

        <div className="flex -space-x-2 shrink-0">
          {onlineNetworkUsers.slice(0, 3).map((u) => (
            <img
              key={u.userId}
              src={u.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`}
              alt={u.displayName}
              className="w-8 h-8 rounded-full object-cover ring-2 ring-white dark:ring-[#16132b]"
            />
          ))}
        </div>
      </div>

      {/* Header + Search Input */}
      <div className="bg-white dark:bg-[#16132b] rounded-3xl p-4 border border-slate-200/80 dark:border-purple-950/40 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#7560DF]" />
            <h2 className="font-extrabold text-base text-slate-900 dark:text-white">
              {t('allUsersTitle')} ({sortedAllUsers.length})
            </h2>
          </div>
          <span className="text-[11px] font-bold text-[#7560DF] dark:text-[#A798F8] flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            Newest First
          </span>
        </div>

        <div className="relative">
          <Search className="w-4.5 h-4.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search users or groups..."
            className="w-full pl-10 pr-10 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
            >
              Clear
            </button>
          )}
        </div>

        {/* Filter Pills: All / Follow Back / Added / Groups */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all ${
              filterMode === 'all'
                ? 'bg-[#7560DF] text-white shadow-sm'
                : 'bg-slate-100 dark:bg-[#201c38] text-slate-600 dark:text-slate-300'
            }`}
          >
            All ({sortedAllUsers.length})
          </button>

          <button
            onClick={() => setFilterMode('groups')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all ${
              filterMode === 'groups'
                ? 'bg-[#7560DF] text-white shadow-sm'
                : 'bg-slate-100 dark:bg-[#201c38] text-slate-600 dark:text-slate-300'
            }`}
          >
            Groups ({allGroups.length})
          </button>

          <button
            onClick={() => setFilterMode('follow_back')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all ${
              filterMode === 'follow_back'
                ? 'bg-[#7560DF] text-white shadow-sm'
                : 'bg-slate-100 dark:bg-[#201c38] text-slate-600 dark:text-slate-300'
            }`}
          >
            {t('followBack')} ({pendingFollowBackCount})
          </button>

          <button
            onClick={() => setFilterMode('added')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all ${
              filterMode === 'added'
                ? 'bg-[#7560DF] text-white shadow-sm'
                : 'bg-slate-100 dark:bg-[#201c38] text-slate-600 dark:text-slate-300'
            }`}
          >
            {t('addedUserBtn')} ({followingIds.size})
          </button>
        </div>
      </div>

      {/* Groups Section (When Groups tab selected OR when searching matches Groups) */}
      {showGroupsSection && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-[#7560DF]" />
            <span>Groups ({matchingGroups.length})</span>
          </h3>

          {matchingGroups.length === 0 ? (
            <div className="bg-white dark:bg-[#16132b] rounded-3xl p-8 text-center text-slate-400 border border-slate-200/80 dark:border-purple-950/40 space-y-2">
              <Users className="w-8 h-8 mx-auto opacity-40 text-[#7560DF]" />
              <p className="text-sm font-semibold">No groups found</p>
              <p className="text-xs">Create a new Group from Settings to get started.</p>
            </div>
          ) : (
            matchingGroups.map((g) => {
              const isJoined = Boolean(
                currentUser && (g.ownerId === currentUser.uid || (g.memberIds || []).includes(currentUser.uid))
              );
              return (
                <div
                  key={g.groupId}
                  className="p-3.5 rounded-2xl bg-white dark:bg-[#16132b] border border-slate-200/80 dark:border-purple-950/40 flex items-center justify-between gap-3 hover:border-[#7560DF]/40 transition-colors shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => isJoined && onOpenGroup?.(g)}
                    className={`flex items-center gap-3 flex-1 min-w-0 text-left ${isJoined ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <div className="w-12 h-12 rounded-2xl overflow-hidden bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] text-white flex items-center justify-center shrink-0">
                      {g.photoURL ? (
                        <img src={g.photoURL} alt={g.name} className="w-full h-full object-cover" />
                      ) : (
                        <Users className="w-6 h-6" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {g.name}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {(g.memberCount || 1).toLocaleString()} {t('membersCount')}
                        {g.description ? ` · ${g.description}` : ''}
                      </p>
                    </div>
                  </button>

                  {isJoined ? (
                    <button
                      type="button"
                      onClick={() => onOpenGroup?.(g)}
                      className="px-3.5 py-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center gap-1 shrink-0"
                    >
                      <span>{t('joinedBadge')}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={joiningGroupId === g.groupId}
                      onClick={() => handleJoinGroup(g)}
                      className="px-4 py-2 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold flex items-center gap-1 shrink-0 shadow-sm"
                    >
                      {joiningGroupId === g.groupId ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      <span>{t('joinGroupBtn')}</span>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Users Directory List */}
      {filterMode !== 'groups' && (
        <div className="space-y-2.5">
          {isSimilarFallback && displayedUsers.length > 0 && (
            <div className="px-4 py-2.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/40 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200 font-semibold">
              <Sparkles className="w-4 h-4 shrink-0 text-amber-500" />
              <span>{t('similarAccountsFound')}</span>
            </div>
          )}

          {displayedUsers.length === 0 && !(filterMode === 'all' && matchingGroups.length > 0 && searchTerm.trim()) ? (
            <div className="bg-white dark:bg-[#16132b] rounded-3xl p-10 text-center text-slate-400 border border-slate-200/80 dark:border-purple-950/40 space-y-2">
              <Users className="w-8 h-8 mx-auto opacity-40 text-[#7560DF]" />
              <p className="text-sm font-semibold">No users found</p>
              <p className="text-xs">Try clearing your search or switching tabs above.</p>
            </div>
          ) : (
            displayedUsers.map((user: UserProfile) => {
              const isFollowing = followingIds.has(user.userId);
              const isFollowedBy = followerIds.has(user.userId);
              const online = isUserOnlineNow(user);
              const pinned = isPinnedAllUser(user);

              return (
                <div
                  key={user.userId}
                  className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 transition-colors shadow-sm ${
                    pinned
                      ? 'bg-[#7560DF]/[0.04] dark:bg-[#1d183b] border-[#7560DF]/40 dark:border-[#7560DF]/50 hover:border-[#7560DF]'
                      : 'bg-white dark:bg-[#16132b] border-slate-200/80 dark:border-purple-950/40 hover:border-[#7560DF]/40'
                  }`}
                >
                  <div
                    onClick={() => onViewProfile(user.userId)}
                    className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                  >
                    <div className="relative shrink-0">
                      <img
                        src={user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`}
                        alt={user.displayName}
                        className="w-12 h-12 rounded-full object-cover ring-2 ring-[#7560DF]/20"
                      />
                      {online && (
                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-[#16132b]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                          {user.displayName}
                        </h4>
                        <GoldVerifiedBadge userId={user.userId} size="xs" />
                        {pinned && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] text-[10px] font-extrabold shrink-0">
                            <Pin className="w-2.5 h-2.5" />
                            Pinned
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#7560DF] dark:text-[#A798F8] font-medium truncate">
                        @{user.username}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {online ? 'Online now' : formatJoined(user.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isFollowing ? (
                      <button
                        onClick={() => unfollowUser(user.userId)}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-purple-950/50 text-slate-700 dark:text-slate-300 flex items-center gap-1 hover:bg-slate-200"
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>{t('addedUserBtn')}</span>
                      </button>
                    ) : isFollowedBy ? (
                      <button
                        onClick={() => followUser(user.userId)}
                        className="px-3 py-1.5 rounded-full text-xs font-bold bg-[#7560DF] hover:bg-[#624ec7] text-white flex items-center gap-1 shadow-sm"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>{t('followBack')}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => followUser(user.userId)}
                        className="px-3 py-1.5 rounded-full text-xs font-bold bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] hover:bg-[#7560DF]/25 flex items-center gap-1"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>{t('addUserBtn')}</span>
                      </button>
                    )}

                    <button
                      onClick={() =>
                        onSelectUserToChat({
                          userId: user.userId,
                          username: user.username,
                          displayName: user.displayName,
                          photoURL: user.photoURL
                        })
                      }
                      className="p-2 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white shadow-sm transition-colors"
                      title="Open Chat"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Online Users in Your Network Modal */}
      {showOnlineModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 flex flex-col max-h-[78vh] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  {t('onlineAddedUsers')} ({onlineNetworkUsers.length})
                </h3>
              </div>
              <button
                onClick={() => setShowOnlineModal(false)}
                className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-purple-900/30"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {onlineNetworkUsers.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-xs space-y-1">
                  <p className="font-semibold text-slate-600 dark:text-slate-300">No added friends online right now</p>
                  <p>People you add or follow back will show up here when active.</p>
                </div>
              ) : (
                onlineNetworkUsers.map((u) => (
                  <button
                    key={u.userId}
                    onClick={() => {
                      setShowOnlineModal(false);
                      onViewProfile(u.userId);
                    }}
                    className="w-full p-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-[#201c38] flex items-center justify-between gap-3 text-left transition-colors border border-slate-100 dark:border-purple-950/30"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative shrink-0">
                        <img
                          src={u.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`}
                          alt={u.displayName}
                          className="w-11 h-11 rounded-full object-cover"
                        />
                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-[#16132b]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <p className="font-bold text-sm text-slate-900 dark:text-white truncate">{u.displayName}</p>
                          <GoldVerifiedBadge userId={u.userId} size="xs" />
                        </div>
                        <p className="text-xs text-[#7560DF] dark:text-[#A798F8] truncate">@{u.username}</p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold shrink-0">
                      {t('online')}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
