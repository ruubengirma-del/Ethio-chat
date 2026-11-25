import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  arrayUnion,
  increment
} from 'firebase/firestore';
import {
  isAudienceVisibleToUser,
  isPinnedAllUser,
  searchUsersWithFallback,
  searchPostsWithFallback,
  sortUsersWithPinnedFirst
} from '../../lib/socialHelpers';
import { Post, UserProfile, ChatParticipant, SocialGroup } from '../../types';
import { GoldVerifiedBadge } from './GoldVerifiedBadge';
import {
  Search,
  X,
  MessageSquare,
  UserPlus,
  Check,
  Sparkles,
  FileText,
  Users,
  Video as VideoIcon,
  Image as ImageIcon,
  Plus,
  Loader2,
  ArrowRight,
  Pin
} from 'lucide-react';

interface UserSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUserToChat: (recipient: ChatParticipant) => void;
  onViewProfile: (userId: string) => void;
  onSelectPost?: (postId: string) => void;
  onOpenGroup?: (group: SocialGroup) => void;
}

export const UserSearchModal: React.FC<UserSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectUserToChat,
  onViewProfile,
  onSelectPost,
  onOpenGroup
}) => {
  const {
    allUsers,
    currentUser,
    followingIds,
    followerIds,
    blockedIds,
    followUser,
    unfollowUser
  } = useAuth();
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'posts' | 'accounts' | 'groups'>('all');
  const [allPosts, setAllPosts] = useState<Post[]>([]);
  const [allGroups, setAllGroups] = useState<SocialGroup[]>([]);
  const [joiningGroupId, setJoiningGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Post[] = [];
        snap.forEach((d) => list.push(d.data() as Post));
        setAllPosts(list);
      },
      () => {}
    );
    return () => unsub();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

  const searchableUsers = useMemo(() => {
    return sortUsersWithPinnedFirst(
      allUsers.filter((u) => u.userId !== currentUser?.uid && !blockedIds.has(u.userId))
    );
  }, [allUsers, currentUser?.uid, blockedIds]);

  const visiblePosts = useMemo(() => {
    return allPosts.filter(
      (p) => !blockedIds.has(p.authorId) && isAudienceVisibleToUser(p, currentUser?.uid)
    );
  }, [allPosts, blockedIds, currentUser?.uid]);

  const userSearchResult = useMemo(() => {
    return searchUsersWithFallback(searchTerm, searchableUsers);
  }, [searchTerm, searchableUsers]);

  const postSearchResult = useMemo(() => {
    if (!searchTerm.trim()) {
      return { exactMatches: visiblePosts.slice(0, 6), similarMatches: [] as Post[] };
    }
    return searchPostsWithFallback(searchTerm, visiblePosts);
  }, [searchTerm, visiblePosts]);

  const matchingGroups = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return allGroups.slice(0, 8);
    const exact = allGroups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.description || '').toLowerCase().includes(q)
    );
    if (exact.length > 0) return exact;
    const tokens = q.split(/\s+/).filter(Boolean);
    return allGroups.filter((g) => {
      const hay = `${g.name} ${g.description || ''}`.toLowerCase();
      return tokens.some((tok) => hay.includes(tok));
    });
  }, [allGroups, searchTerm]);

  if (!isOpen) return null;

  const handleJoinGroup = async (g: SocialGroup) => {
    if (!currentUser || joiningGroupId) return;
    const isMember = g.ownerId === currentUser.uid || (g.memberIds || []).includes(currentUser.uid);
    if (isMember) {
      onOpenGroup?.(g);
      onClose();
      return;
    }
    setJoiningGroupId(g.groupId);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'groups', g.groupId), {
        memberIds: arrayUnion(currentUser.uid),
        memberCount: increment(1),
        updatedAt: now,
      });
      onOpenGroup?.({
        ...g,
        memberIds: Array.from(new Set([...(g.memberIds || []), currentUser.uid])),
        memberCount: (g.memberCount || 0) + 1,
        updatedAt: now,
      });
      onClose();
    } finally {
      setJoiningGroupId(null);
    }
  };

  const hasQuery = searchTerm.trim().length > 0;
  const usersToShow =
    userSearchResult.exactMatches.length > 0
      ? userSearchResult.exactMatches
      : userSearchResult.similarMatches;
  const postsToShow =
    postSearchResult.exactMatches.length > 0
      ? postSearchResult.exactMatches
      : postSearchResult.similarMatches;

  const showingSimilarFallback =
    hasQuery &&
    userSearchResult.exactMatches.length === 0 &&
    postSearchResult.exactMatches.length === 0 &&
    matchingGroups.length === 0 &&
    (userSearchResult.similarMatches.length > 0 || postSearchResult.similarMatches.length > 0);

  const showGroupsSection =
    (activeFilter === 'all' || activeFilter === 'groups') &&
    matchingGroups.length > 0 &&
    (hasQuery || activeFilter === 'groups');
  const showAccountsSection =
    (activeFilter === 'all' || activeFilter === 'accounts') && usersToShow.length > 0;
  const showPostsSection =
    (activeFilter === 'all' || activeFilter === 'posts') &&
    postsToShow.length > 0 &&
    (hasQuery || activeFilter === 'posts');

  const nothingFound =
    (activeFilter === 'all' &&
      usersToShow.length === 0 &&
      postsToShow.length === 0 &&
      matchingGroups.length === 0) ||
    (activeFilter === 'accounts' && usersToShow.length === 0) ||
    (activeFilter === 'posts' && postsToShow.length === 0) ||
    (activeFilter === 'groups' && matchingGroups.length === 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-lg rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 flex flex-col max-h-[86vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-[#7560DF]" />
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              Search Posts, Accounts & Groups
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Input + Category Filter */}
        <div className="p-4 border-b border-slate-100 dark:border-purple-950/30 bg-slate-50/50 dark:bg-[#120f24]/50 space-y-2.5">
          <div className="relative">
            <Search className="w-4.5 h-4.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('homeSearchPlaceholder')}
              className="w-full pl-10 pr-12 py-2.5 rounded-2xl bg-white dark:bg-[#1a1633] border border-slate-200 dark:border-purple-900/50 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {(['all', 'posts', 'accounts', 'groups'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveFilter(tab)}
                className={`px-3 py-1 rounded-full text-xs font-bold shrink-0 transition-all ${
                  activeFilter === tab
                    ? 'bg-[#7560DF] text-white shadow-sm'
                    : 'bg-white dark:bg-[#1a1633] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-purple-900/40'
                }`}
              >
                {tab === 'all'
                  ? 'All'
                  : tab === 'posts'
                  ? `${t('matchingPosts')} (${postsToShow.length})`
                  : tab === 'accounts'
                  ? `${t('matchingAccounts')} (${usersToShow.length})`
                  : `Groups (${matchingGroups.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Results List */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          {showingSimilarFallback && (
            <div className="px-3.5 py-2.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/40 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200 font-semibold">
              <Sparkles className="w-4 h-4 shrink-0 text-amber-500" />
              <span>{t('noExactMatchShowingSimilar')}</span>
            </div>
          )}

          {nothingFound ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <Search className="w-8 h-8 mx-auto opacity-40 text-[#7560DF]" />
              <p className="text-sm font-semibold">
                {hasQuery ? `No results found for "${searchTerm}"` : 'Type to search posts, accounts, or groups'}
              </p>
              <p className="text-xs">
                Try searching by post words, topic, @username, or group name.
              </p>
            </div>
          ) : (
            <>
              {/* Matching Groups (with Join -> Open Group) */}
              {showGroupsSection && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1">
                    <Users className="w-3.5 h-3.5 text-[#7560DF]" />
                    <span>Groups ({matchingGroups.length})</span>
                  </div>

                  {matchingGroups.map((g) => {
                    const isMember = Boolean(
                      currentUser &&
                        (g.ownerId === currentUser.uid || (g.memberIds || []).includes(currentUser.uid))
                    );
                    return (
                      <div
                        key={g.groupId}
                        className="p-3 rounded-2xl bg-slate-50 dark:bg-[#1a1633] border border-slate-100 dark:border-purple-950/40 flex items-center justify-between gap-3 hover:border-[#7560DF]/40 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (isMember) {
                              onOpenGroup?.(g);
                              onClose();
                            }
                          }}
                          className={`flex items-center gap-3 flex-1 min-w-0 text-left ${isMember ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          <div className="w-11 h-11 rounded-2xl overflow-hidden bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] text-white flex items-center justify-center shrink-0">
                            {g.photoURL ? (
                              <img src={g.photoURL} alt={g.name} className="w-full h-full object-cover" />
                            ) : (
                              <Users className="w-5 h-5" />
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

                        {isMember ? (
                          <button
                            type="button"
                            onClick={() => {
                              onOpenGroup?.(g);
                              onClose();
                            }}
                            className="px-3 py-1.5 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center gap-1 shrink-0"
                          >
                            <span>{t('joinedBadge')}</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={joiningGroupId === g.groupId}
                            onClick={() => handleJoinGroup(g)}
                            className="px-3.5 py-2 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold flex items-center gap-1 shrink-0"
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
                  })}
                </div>
              )}

              {/* Matching / Similar Posts */}
              {showPostsSection && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1">
                    <FileText className="w-3.5 h-3.5 text-[#7560DF]" />
                    <span>
                      {t('matchingPosts')} ({postsToShow.length})
                    </span>
                    {hasQuery && postSearchResult.exactMatches.length === 0 && (
                      <span className="ml-auto text-[10px] font-bold text-amber-600 dark:text-amber-400 normal-case">
                        Similar match
                      </span>
                    )}
                  </div>

                  {postsToShow.map((post) => (
                    <div
                      key={post.postId}
                      onClick={() => {
                        if (onSelectPost) {
                          onSelectPost(post.postId);
                        } else {
                          onViewProfile(post.authorId);
                        }
                        onClose();
                      }}
                      className="p-3 rounded-2xl bg-slate-50 dark:bg-[#1a1633] border border-slate-100 dark:border-purple-950/40 hover:border-[#7560DF]/50 cursor-pointer transition-colors space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <img
                            src={
                              post.authorPhotoURL ||
                              `https://api.dicebear.com/7.x/bottts/svg?seed=${post.authorUsername}`
                            }
                            alt={post.authorDisplayName}
                            className="w-8 h-8 rounded-full object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="font-bold text-xs text-slate-900 dark:text-white truncate">
                              {post.authorDisplayName}
                            </p>
                            <p className="text-[11px] text-[#7560DF] dark:text-[#A798F8] truncate">
                              @{post.authorUsername}
                            </p>
                          </div>
                        </div>

                        {post.mediaType !== 'none' && (
                          <span className="px-2 py-0.5 rounded-full bg-[#7560DF]/10 text-[#7560DF] dark:text-[#B09EFC] text-[10px] font-bold inline-flex items-center gap-1 shrink-0">
                            {post.mediaType === 'video' ? (
                              <VideoIcon className="w-3 h-3" />
                            ) : (
                              <ImageIcon className="w-3 h-3" />
                            )}
                            <span>{post.mediaType}</span>
                          </span>
                        )}
                      </div>

                      {post.content && (
                        <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-2 leading-relaxed">
                          {post.content}
                        </p>
                      )}

                      {post.mediaUrl && post.mediaType === 'image' && (
                        <img
                          src={post.mediaUrl}
                          alt="Post media preview"
                          className="w-full h-28 object-cover rounded-xl"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Matching / Similar Accounts */}
              {showAccountsSection && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1">
                    <Users className="w-3.5 h-3.5 text-[#7560DF]" />
                    <span>
                      {t('matchingAccounts')} ({usersToShow.length})
                    </span>
                    {hasQuery && userSearchResult.exactMatches.length === 0 && (
                      <span className="ml-auto text-[10px] font-bold text-amber-600 dark:text-amber-400 normal-case">
                        Similar match
                      </span>
                    )}
                  </div>

                  {usersToShow.map((user: UserProfile) => {
                    const isFollowing = followingIds.has(user.userId);
                    const isFollowedBy = followerIds.has(user.userId);
                    const pinned = isPinnedAllUser(user);

                    return (
                      <div
                        key={user.userId}
                        className={`p-3 rounded-2xl border flex items-center justify-between gap-3 transition-colors ${
                          pinned
                            ? 'bg-[#7560DF]/[0.05] dark:bg-[#1d183b] border-[#7560DF]/40 dark:border-[#7560DF]/50 hover:border-[#7560DF]'
                            : 'bg-slate-50 dark:bg-[#1a1633] border-slate-100 dark:border-purple-950/40 hover:border-[#7560DF]/40'
                        }`}
                      >
                        <div
                          onClick={() => {
                            onViewProfile(user.userId);
                            onClose();
                          }}
                          className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                        >
                          <img
                            src={
                              user.photoURL ||
                              `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                            }
                            alt={user.displayName}
                            className="w-11 h-11 rounded-full object-cover ring-2 ring-[#7560DF]/20 shrink-0"
                          />
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
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                              @{user.username}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isFollowing ? (
                            <button
                              onClick={() => unfollowUser(user.userId)}
                              className="px-2.5 py-1.5 rounded-full text-xs font-semibold bg-slate-200 dark:bg-purple-950/60 text-slate-700 dark:text-slate-300 flex items-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>{t('following')}</span>
                            </button>
                          ) : isFollowedBy ? (
                            <button
                              onClick={() => followUser(user.userId)}
                              className="px-2.5 py-1.5 rounded-full text-xs font-bold bg-[#7560DF] text-white flex items-center gap-1 shadow-sm"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              <span>{t('followBack')}</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => followUser(user.userId)}
                              className="px-2.5 py-1.5 rounded-full text-xs font-semibold bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] hover:bg-[#7560DF]/25 flex items-center gap-1"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              <span>{t('follow')}</span>
                            </button>
                          )}

                          <button
                            onClick={() => {
                              onSelectUserToChat({
                                userId: user.userId,
                                username: user.username,
                                displayName: user.displayName,
                                photoURL: user.photoURL
                              });
                              onClose();
                            }}
                            className="p-2 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white shadow-sm transition-colors"
                            title="Open Chat"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
