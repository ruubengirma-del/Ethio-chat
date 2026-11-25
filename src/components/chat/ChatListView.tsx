import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import {
  collection,
  collectionGroup,
  query,
  where,
  onSnapshot,
  doc,
  getDocs,
  getDocsFromServer
} from 'firebase/firestore';
import { ChatRoom, ChatParticipant, Team, TeamMember } from '../../types';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { PullToRefreshBanner } from '../common/PullToRefreshBanner';
import { GoldVerifiedBadge } from '../common/GoldVerifiedBadge';
import {
  MessageSquare,
  Search,
  UserPlus,
  Plus,
  Globe,
  ArrowRight,
  Layers,
  Radio,
  Lock
} from 'lucide-react';

interface ChatListViewProps {
  onSelectChat: (chatId: string, recipient: ChatParticipant) => void;
  onSelectTeam: (team: Team) => void;
  onOpenUserSearch: () => void;
  onOpenCreateTeam: () => void;
}

export const ChatListView: React.FC<ChatListViewProps> = ({
  onSelectChat,
  onSelectTeam,
  onOpenUserSearch,
  onOpenCreateTeam
}) => {
  const { currentUser, allUsers, blockedIds, refreshDirectory } = useAuth();
  const { t } = useLanguage();
  const [myChats, setMyChats] = useState<ChatRoom[]>([]);
  const [joinedTeamIds, setJoinedTeamIds] = useState<string[]>([]);
  const [myTeamsMap, setMyTeamsMap] = useState<Record<string, Team>>({});
  const [publicTeams, setPublicTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [listenerVersion, setListenerVersion] = useState(0);

  const handleRefreshChats = useCallback(async () => {
    if (!currentUser) return;
    const chatsQ = query(collection(db, 'chats'), where('participantIds', 'array-contains', currentUser.uid));
    const membersQ = query(collectionGroup(db, 'members'), where('userId', '==', currentUser.uid));
    const publicTeamsQ = query(collection(db, 'teams'), where('isPublic', '==', true));

    const [, chatsSnap, membersSnap, publicTeamsSnap] = await Promise.all([
      refreshDirectory(),
      getDocsFromServer(chatsQ).catch(() => getDocs(chatsQ)),
      getDocsFromServer(membersQ).catch(() => getDocs(membersQ)),
      getDocsFromServer(publicTeamsQ).catch(() => getDocs(publicTeamsQ)),
    ]);

    const chatList: ChatRoom[] = [];
    chatsSnap.forEach((d) => {
      const data = d.data() as ChatRoom;
      if (!data.isGroup) chatList.push(data);
    });
    chatList.sort(
      (a, b) =>
        new Date(b.lastMessageTime || b.updatedAt || 0).getTime() -
        new Date(a.lastMessageTime || a.updatedAt || 0).getTime()
    );
    setMyChats(chatList);

    const teamIds: string[] = [];
    membersSnap.forEach((d) => {
      const data = d.data() as TeamMember;
      if (data.teamId) teamIds.push(data.teamId);
    });
    setJoinedTeamIds(Array.from(new Set(teamIds)));

    const pubList: Team[] = [];
    publicTeamsSnap.forEach((d) => pubList.push(d.data() as Team));
    setPublicTeams(pubList);
    setListenerVersion((v) => v + 1);
  }, [currentUser, refreshDirectory]);

  const {
    containerRef,
    pullDistance,
    isRefreshing,
    refreshJustDone,
    pullHandlers,
  } = usePullToRefresh({
    onRefresh: handleRefreshChats,
  });

  // Listen strictly to 1-on-1 user chats involving current user
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'chats'),
      where('participantIds', 'array-contains', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: ChatRoom[] = [];
      snapshot.forEach((d) => {
        const data = d.data() as ChatRoom;
        if (!data.isGroup) {
          list.push(data);
        }
      });
      list.sort(
        (a, b) =>
          new Date(b.lastMessageTime || b.updatedAt || 0).getTime() -
          new Date(a.lastMessageTime || a.updatedAt || 0).getTime()
      );
      setMyChats(list);
      setLoading(false);
    }, (error) => {
      console.warn('Chats listener notice:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, listenerVersion]);

  // Listen to Teams the user belongs to via scalable members collectionGroup
  useEffect(() => {
    if (!currentUser) {
      setJoinedTeamIds([]);
      setMyTeamsMap({});
      return;
    }

    const qMembers = query(
      collectionGroup(db, 'members'),
      where('userId', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(
      qMembers,
      (snapshot) => {
        const ids: string[] = [];
        snapshot.forEach((d) => {
          const data = d.data() as TeamMember;
          if (data.teamId) ids.push(data.teamId);
        });
        setJoinedTeamIds(Array.from(new Set(ids)));
      },
      (err) => console.warn('Team memberships listener notice:', err)
    );

    return () => unsubscribe();
  }, [currentUser, listenerVersion]);

  // Subscribe in real time to each joined team doc so live stage & lastMessage stay current
  useEffect(() => {
    if (joinedTeamIds.length === 0) {
      setMyTeamsMap({});
      return;
    }

    const activeIds = new Set(joinedTeamIds);
    setMyTeamsMap((prev) => {
      const next: Record<string, Team> = {};
      Object.keys(prev).forEach((id) => {
        if (activeIds.has(id)) next[id] = prev[id];
      });
      return next;
    });

    const unsubs = joinedTeamIds.map((teamId) =>
      onSnapshot(
        doc(db, 'teams', teamId),
        (snap) => {
          setMyTeamsMap((prev) => {
            if (!snap.exists()) {
              const copy = { ...prev };
              delete copy[teamId];
              return copy;
            }
            return { ...prev, [teamId]: snap.data() as Team };
          });
        },
        (err) => console.warn('Team doc listener notice:', err)
      )
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [joinedTeamIds]);

  // Listen to Public Teams for search/discovery
  useEffect(() => {
    if (!currentUser) return;

    const qPublicTeams = query(
      collection(db, 'teams'),
      where('isPublic', '==', true)
    );

    const unsubscribe = onSnapshot(
      qPublicTeams,
      (snapshot) => {
        const list: Team[] = [];
        snapshot.forEach((d) => {
          list.push(d.data() as Team);
        });
        setPublicTeams(list);
      },
      (err) => console.warn('Public teams listener notice:', err)
    );

    return () => unsubscribe();
  }, [currentUser, listenerVersion]);

  const myTeams = useMemo(() => {
    return Object.values(myTeamsMap).sort(
      (a, b) =>
        new Date(b.lastMessageTime || b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.lastMessageTime || a.updatedAt || a.createdAt || 0).getTime()
    );
  }, [myTeamsMap]);

  const discoverableTeams = useMemo(() => {
    const joinedSet = new Set(joinedTeamIds);
    const q = searchFilter.trim().toLowerCase().replace(/^@/, '');
    return publicTeams
      .filter((team) => !joinedSet.has(team.teamId))
      .filter((team) => {
        if (!q) return true;
        return (
          team.name.toLowerCase().includes(q) ||
          (team.teamUsername || '').toLowerCase().includes(q) ||
          (team.description || '').toLowerCase().includes(q)
        );
      });
  }, [publicTeams, joinedTeamIds, searchFilter]);

  const filteredMyTeams = useMemo(() => {
    const q = searchFilter.trim().toLowerCase().replace(/^@/, '');
    if (!q) return myTeams;
    return myTeams.filter(
      (team) =>
        team.name.toLowerCase().includes(q) ||
        (team.teamUsername || '').toLowerCase().includes(q) ||
        (team.lastMessage || '').toLowerCase().includes(q)
    );
  }, [myTeams, searchFilter]);

  // Find recipient participant details for a 1-on-1 chat
  const getRecipientInfo = (chat: ChatRoom): ChatParticipant & { hideOnlineStatus?: boolean } => {
    const otherId = chat.participantIds.find((id) => id !== currentUser?.uid) || '';
    const user = allUsers.find((u) => u.userId === otherId);
    if (user) {
      return {
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        photoURL: user.photoURL,
        hideOnlineStatus: user.hideOnlineStatus,
      };
    }
    return {
      userId: otherId,
      username: `user_${otherId.slice(0, 5)}`,
      displayName: 'Ethio Friend',
      photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${otherId}`
    };
  };

  const visiblePeople = useMemo(
    () => allUsers.filter((u) => u.userId !== currentUser?.uid && !blockedIds.has(u.userId)),
    [allUsers, currentUser, blockedIds]
  );

  const filteredChats = useMemo(() => {
    const base = myChats.filter((chat) => {
      if (chat.isGroup) return false;
      const otherId = chat.participantIds.find((id) => id !== currentUser?.uid) || '';
      if (blockedIds.has(otherId)) return false;

      const q = searchFilter.trim().toLowerCase();
      if (!q) return true;
      const recipient = getRecipientInfo(chat);
      return (
        recipient.username.toLowerCase().includes(q) ||
        recipient.displayName.toLowerCase().includes(q) ||
        (chat.lastMessage || '').toLowerCase().includes(q)
      );
    });

    return [...base].sort(
      (a, b) =>
        new Date(b.lastMessageTime || b.updatedAt || 0).getTime() -
        new Date(a.lastMessageTime || a.updatedAt || 0).getTime()
    );
  }, [myChats, blockedIds, currentUser, searchFilter, allUsers]);

  const formatChatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <div
      ref={containerRef}
      {...pullHandlers}
      className="max-w-xl mx-auto px-4 py-4 space-y-4 pb-24 min-h-[calc(100dvh-8rem)] overscroll-y-contain"
    >
      <PullToRefreshBanner
        pullDistance={pullDistance}
        isRefreshing={isRefreshing}
        refreshJustDone={refreshJustDone}
        refreshingLabel="Refreshing Chats..."
        updatedLabel="Chats updated!"
      />
      {/* Compact Top Header Row with Create Team Button ONLY */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight truncate">
            {t('messagesAndGroups')}
          </h2>
        </div>

        <button
          type="button"
          onClick={onOpenCreateTeam}
          className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#7560DF] to-[#8F7BF5] hover:opacity-95 text-white text-xs font-bold shadow-sm shadow-[#7560DF]/25 flex items-center gap-1.5 transition-all shrink-0"
          title={t('createTeam')}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>{t('createTeam')}</span>
        </button>
      </div>

      {/* Messenger Style Search Bar (Users & Teams only) */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4.5 h-4.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search user chats, teams, or @username..."
            className="w-full pl-10 pr-10 py-2.5 rounded-2xl bg-white dark:bg-[#16132b] border border-slate-200/80 dark:border-purple-950/40 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF] shadow-sm"
          />
          {searchFilter && (
            <button
              onClick={() => setSearchFilter('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Quick Start Direct Chat with Community Members */}
      <div className="bg-white dark:bg-[#16132b] rounded-3xl p-4 border border-slate-200/80 dark:border-purple-950/40 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            People on Ethio Chat
          </span>
          <button
            onClick={onOpenUserSearch}
            className="text-xs font-bold text-[#7560DF] dark:text-[#A798F8] hover:underline flex items-center gap-1"
          >
            <Search className="w-3.5 h-3.5" />
            <span>{t('searchUsers')}</span>
          </button>
        </div>

        {visiblePeople.length === 0 ? (
          <p className="text-xs text-slate-400 py-2">
            Invite friends to join Ethio Chat or create a Team to connect in real time!
          </p>
        ) : (
          <div className="flex items-center gap-3 overflow-x-auto pb-1 no-scrollbar">
            {visiblePeople.slice(0, 12).map((user) => {
              const participant: ChatParticipant = {
                userId: user.userId,
                username: user.username,
                displayName: user.displayName,
                photoURL: user.photoURL
              };
              const ids = [currentUser?.uid || '', user.userId].sort();
              const chatId = `chat_${ids[0]}_${ids[1]}`;

              return (
                <div
                  key={user.userId}
                  onClick={() => onSelectChat(chatId, participant)}
                  className="flex flex-col items-center gap-1.5 cursor-pointer shrink-0 group p-2 rounded-2xl hover:bg-slate-50 dark:hover:bg-purple-950/30 transition-colors"
                >
                  <div className="relative w-12 h-12 rounded-full p-0.5 bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] group-hover:scale-105 transition-transform">
                    <img
                      src={user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`}
                      alt={user.displayName}
                      className="w-full h-full rounded-full object-cover border-2 border-white dark:border-[#16132b]"
                    />
                    {!user.hideOnlineStatus && (
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-[#16132b]" />
                    )}
                  </div>
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 max-w-[74px] flex items-center justify-center gap-0.5">
                    <span className="truncate">{user.displayName.split(' ')[0]}</span>
                    <GoldVerifiedBadge userId={user.userId} size="xs" />
                  </span>
                  <span className="text-[10px] text-slate-400 truncate w-16 text-center">
                    @{user.username}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Your Teams (Strictly Visible to Team Members Only) */}
      {filteredMyTeams.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#7560DF]" />
              <span>{t('yourTeams')}</span>
            </h3>
            <span className="text-[11px] font-bold text-[#7560DF] dark:text-[#A798F8]">
              {filteredMyTeams.length}
            </span>
          </div>

          <div className="space-y-2">
            {filteredMyTeams.map((team) => (
              <div
                key={team.teamId}
                onClick={() => onSelectTeam(team)}
                className="bg-white dark:bg-[#16132b] rounded-2xl p-3.5 border border-slate-200/80 dark:border-purple-950/40 hover:border-[#7560DF]/40 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center justify-between gap-3 group"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="relative w-12 h-12 rounded-2xl overflow-hidden bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] text-white flex items-center justify-center shrink-0 shadow-sm">
                    {team.photoURL ? (
                      <img src={team.photoURL} alt={team.name} className="w-full h-full object-cover" />
                    ) : (
                      <Layers className="w-6 h-6" />
                    )}
                    {team.liveRoom?.active && (
                      <span className="absolute -bottom-0.5 -right-0.5 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-extrabold border-2 border-white dark:border-[#16132b] flex items-center gap-0.5">
                        <Radio className="w-2.5 h-2.5 animate-pulse" />
                        LIVE
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5 gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors truncate">
                          {team.name}
                        </h4>
                        {team.isPublic ? (
                          <Globe className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 shrink-0">
                        {team.lastMessageTime ? formatChatTime(team.lastMessageTime) : ''}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 truncate">
                      <span className="px-1.5 py-0.5 rounded-md bg-[#7560DF]/10 text-[#7560DF] dark:text-[#B09EFC] text-[10px] font-bold shrink-0">
                        {(team.memberCount || 1).toLocaleString()} {t('membersCount')}
                      </span>
                      {team.teamUsername && (
                        <span className="text-[10px] font-semibold text-slate-400 shrink-0">
                          @{team.teamUsername}
                        </span>
                      )}
                      <p className="truncate">{team.lastMessage || team.description || 'Team channel'}</p>
                    </div>
                  </div>
                </div>

                <ArrowRight className="w-4 h-4 text-slate-300 dark:text-purple-900 group-hover:text-[#7560DF] group-hover:translate-x-0.5 transition-all shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Discover Public Teams */}
      {discoverableTeams.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-[#7560DF]" />
              <span>{t('discoverPublicTeams')}</span>
            </h3>
          </div>

          <div className="space-y-2">
            {discoverableTeams.map((team) => (
              <div
                key={team.teamId}
                onClick={() => onSelectTeam(team)}
                className="bg-white dark:bg-[#16132b] rounded-2xl p-3.5 border border-slate-200/80 dark:border-purple-950/40 hover:border-[#7560DF]/40 shadow-sm flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-2xl overflow-hidden bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] text-white flex items-center justify-center shrink-0">
                    {team.photoURL ? (
                      <img src={team.photoURL} alt={team.name} className="w-full h-full object-cover" />
                    ) : (
                      <Layers className="w-5 h-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {team.name}
                      </h4>
                      {team.teamUsername && (
                        <span className="text-[11px] font-bold text-[#7560DF] dark:text-[#A798F8] shrink-0">
                          @{team.teamUsername}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {(team.memberCount || 1).toLocaleString()} {t('membersCount')}
                      {team.description ? ` · ${team.description}` : ''}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTeam(team);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold shrink-0 transition-colors flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('joinTeam')}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Direct User Conversations List (Sorted strictly newest message first, unread count badge on right) */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1">
          Direct Chats
        </h3>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="bg-white dark:bg-[#16132b] rounded-2xl p-4 border border-slate-100 dark:border-purple-950/30 animate-pulse flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-purple-900/40" />
                <div className="space-y-2 flex-1">
                  <div className="w-28 h-4 bg-slate-200 dark:bg-purple-900/40 rounded" />
                  <div className="w-48 h-3 bg-slate-100 dark:bg-purple-900/20 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="bg-white dark:bg-[#16132b] rounded-3xl p-8 border border-slate-200/80 dark:border-purple-950/40 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-[#7560DF]/10 text-[#7560DF] flex items-center justify-center mx-auto">
              <MessageSquare className="w-7 h-7" />
            </div>
            <h4 className="font-bold text-base text-slate-900 dark:text-white">
              {t('noConversations')}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
              Search for any user by @username or launch a Team to chat in real time!
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <button
                onClick={onOpenUserSearch}
                className="px-4 py-2.5 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-xs shadow-md shadow-[#7560DF]/25 transition-all inline-flex items-center gap-1.5"
              >
                <UserPlus className="w-4 h-4" />
                <span>{t('searchUsers')}</span>
              </button>
              <button
                onClick={onOpenCreateTeam}
                className="px-4 py-2.5 rounded-full bg-slate-900 dark:bg-[#221d42] hover:opacity-90 text-white font-bold text-xs transition-all inline-flex items-center gap-1.5"
              >
                <Layers className="w-4 h-4" />
                <span>{t('createTeam')}</span>
              </button>
            </div>
          </div>
        ) : (
          filteredChats.map((chat) => {
            const isLastFromMe = chat.lastSenderId === currentUser?.uid;
            const unreadCount = currentUser ? Number(chat.unreadCounts?.[currentUser.uid] || 0) : 0;
            const recipient = getRecipientInfo(chat);

            return (
              <div
                key={chat.chatId}
                onClick={() => onSelectChat(chat.chatId, recipient)}
                className="bg-white dark:bg-[#16132b] rounded-2xl p-3.5 border border-slate-200/80 dark:border-purple-950/40 hover:border-[#7560DF]/40 dark:hover:border-[#7560DF]/40 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center justify-between gap-3 group"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="relative shrink-0">
                    <img
                      src={recipient.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${recipient.username}`}
                      alt={recipient.displayName}
                      className="w-12 h-12 rounded-full object-cover ring-2 ring-slate-100 dark:ring-purple-900/30 group-hover:ring-[#7560DF] transition-all"
                    />
                    {!recipient.hideOnlineStatus && (
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-[#16132b]" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5 gap-2">
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors flex items-center gap-1 min-w-0">
                        <span className="truncate">{recipient.displayName}</span>
                        <GoldVerifiedBadge userId={recipient.userId} size="xs" />
                      </h4>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {unreadCount > 0 && (
                          <span
                            aria-label={`${unreadCount} unread messages`}
                            className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#7560DF] text-white text-[11px] font-extrabold flex items-center justify-center shadow-sm shadow-[#7560DF]/30"
                          >
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400">
                          {chat.lastMessageTime ? formatChatTime(chat.lastMessageTime) : ''}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                      {isLastFromMe && (
                        <span className="text-[#7560DF] font-medium">You:</span>
                      )}
                      <p className={`truncate ${unreadCount > 0 ? 'font-bold text-slate-800 dark:text-slate-100' : ''}`}>
                        {chat.lastMessage || 'Started a conversation'}
                      </p>
                    </div>
                  </div>
                </div>

                <ArrowRight className="w-4 h-4 text-slate-300 dark:text-purple-900 group-hover:text-[#7560DF] group-hover:translate-x-0.5 transition-all shrink-0" />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
