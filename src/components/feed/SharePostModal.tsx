import React, { useState, useEffect, useMemo } from 'react';
import { Post, Team, TeamMember, TeamMessage, UserProfile, ChatMessage } from '../../types';
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
  getDoc,
  setDoc,
  updateDoc,
  increment
} from 'firebase/firestore';
import { createAppNotification, getCurrentMonthKey } from '../../lib/socialHelpers';
import { isOnline, queueOfflineMessage } from '../../lib/offlineSync';
import { GoldVerifiedBadge } from '../common/GoldVerifiedBadge';
import {
  X,
  Search,
  Send,
  Layers,
  Check,
  Loader2,
  Share2,
  Video as VideoIcon
} from 'lucide-react';

interface SharePostModalProps {
  post: Post | null;
  isOpen: boolean;
  onClose: () => void;
  onShared?: (countAdded: number) => void;
}

type TargetSelection =
  | { kind: 'user'; id: string; user: UserProfile }
  | { kind: 'team'; id: string; team: Team };

export const SharePostModal: React.FC<SharePostModalProps> = ({
  post,
  isOpen,
  onClose,
  onShared,
}) => {
  const { currentUser, userProfile, allUsers, blockedIds } = useAuth();
  const { t } = useLanguage();

  const [joinedTeamIds, setJoinedTeamIds] = useState<string[]>([]);
  const [teamsMap, setTeamsMap] = useState<Record<string, Team>>({});
  const [tab, setTab] = useState<'all' | 'users' | 'teams'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sentDone, setSentDone] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedKeys(new Set());
    setNote('');
    setSearchQuery('');
    setErrMsg(null);
    setSentDone(false);
  }, [isOpen, post?.postId]);

  // Listen to Teams the user belongs to
  useEffect(() => {
    if (!isOpen || !currentUser) {
      setJoinedTeamIds([]);
      setTeamsMap({});
      return;
    }

    const q = query(
      collectionGroup(db, 'members'),
      where('userId', '==', currentUser.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const ids: string[] = [];
        snap.forEach((d) => {
          const data = d.data() as TeamMember;
          if (data.teamId) ids.push(data.teamId);
        });
        setJoinedTeamIds(Array.from(new Set(ids)));
      },
      (err) => console.warn('SharePostModal team membership error:', err)
    );
    return () => unsub();
  }, [isOpen, currentUser]);

  useEffect(() => {
    if (!isOpen || joinedTeamIds.length === 0) {
      setTeamsMap({});
      return;
    }

    const unsubs = joinedTeamIds.map((teamId) =>
      onSnapshot(
        doc(db, 'teams', teamId),
        (snap) => {
          setTeamsMap((prev) => {
            if (!snap.exists()) {
              const copy = { ...prev };
              delete copy[teamId];
              return copy;
            }
            return { ...prev, [teamId]: snap.data() as Team };
          });
        },
        () => {}
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [isOpen, joinedTeamIds]);

  const teams = useMemo(() => {
    return Object.values(teamsMap).sort(
      (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
    );
  }, [teamsMap]);

  const registeredUsers = useMemo(() => {
    if (!currentUser) return [];
    return allUsers.filter(
      (u) => u.userId !== currentUser.uid && !blockedIds.has(u.userId)
    );
  }, [allUsers, currentUser, blockedIds]);

  const filteredTargets = useMemo<TargetSelection[]>(() => {
    const q = searchQuery.trim().toLowerCase().replace(/^@/, '');
    const results: TargetSelection[] = [];

    if (tab === 'all' || tab === 'teams') {
      teams.forEach((tm) => {
        const name = (tm.name || '').toLowerCase();
        const uname = (tm.teamUsername || '').toLowerCase();
        if (!q || name.includes(q) || uname.includes(q)) {
          results.push({ kind: 'team', id: `team:${tm.teamId}`, team: tm });
        }
      });
    }

    if (tab === 'all' || tab === 'users') {
      registeredUsers.forEach((u) => {
        const match =
          !q ||
          u.displayName.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q);
        if (match) {
          results.push({ kind: 'user', id: `user:${u.userId}`, user: u });
        }
      });
    }

    return results;
  }, [tab, searchQuery, teams, registeredUsers]);

  if (!isOpen || !post || !currentUser || !userProfile) return null;

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSendShares = async () => {
    if (selectedKeys.size === 0 || isSending) return;
    setIsSending(true);
    setErrMsg(null);

    try {
      const allMap = new Map<string, TargetSelection>();
      teams.forEach((tm) => allMap.set(`team:${tm.teamId}`, { kind: 'team', id: `team:${tm.teamId}`, team: tm }));
      registeredUsers.forEach((u) => allMap.set(`user:${u.userId}`, { kind: 'user', id: `user:${u.userId}`, user: u }));

      const chosenTargets = Array.from(selectedKeys)
        .map((k) => allMap.get(k))
        .filter((x): x is TargetSelection => Boolean(x));

      const includeMediaUrl =
        Boolean(post.mediaUrl) &&
        post.mediaType !== 'none' &&
        (post.mediaUrl?.length || 0) <= 450000;
      const includeAuthorPhoto =
        Boolean(post.authorPhotoURL) && (post.authorPhotoURL?.length || 0) <= 120000;

      const summarySnippet = `📌 Shared post by ${post.authorDisplayName}`;
      const now = new Date().toISOString();

      for (const target of chosenTargets) {
        if (target.kind === 'team') {
          const messageId = `tmsg_share_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const postUrl = `${window.location.origin}/?post=${encodeURIComponent(post.postId)}`;
          const sharedBody = [
            note.trim() ? note.trim() : null,
            `📌 ${post.authorDisplayName} (@${post.authorUsername})`,
            post.content ? post.content.slice(0, 400) : null,
            postUrl,
          ]
            .filter(Boolean)
            .join('\n');

          const useImageType =
            post.mediaType === 'image' &&
            Boolean(post.mediaUrl) &&
            (post.mediaUrl?.length || 0) <= 850000;

          const teamPayload: TeamMessage = {
            messageId,
            teamId: target.team.teamId,
            senderId: userProfile.userId,
            senderUsername: userProfile.username,
            senderDisplayName: userProfile.displayName,
            ...(userProfile.photoURL && userProfile.photoURL.length <= 120000
              ? { senderPhotoURL: userProfile.photoURL }
              : {}),
            type: useImageType ? 'image' : 'text',
            text: sharedBody.slice(0, 1900),
            ...(useImageType && post.mediaUrl ? { mediaUrl: post.mediaUrl } : {}),
            createdAt: now,
          };

          await setDoc(
            doc(db, 'teams', target.team.teamId, 'messages', messageId),
            teamPayload
          );
          await updateDoc(doc(db, 'teams', target.team.teamId), {
            lastMessage: summarySnippet,
            lastMessageTime: now,
            lastSenderId: userProfile.userId,
            updatedAt: now,
          }).catch(() => {});
          continue;
        }

        // Direct User-to-User Share
        const targetChatId = `chat_${[currentUser.uid, target.user.userId].sort().join('_')}`;
        const receiverId = target.user.userId;
        const messageId = `msg_share_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        const basePayload: ChatMessage = {
          messageId,
          chatId: targetChatId,
          senderId: userProfile.userId,
          senderUsername: userProfile.username,
          senderDisplayName: userProfile.displayName,
          ...(userProfile.photoURL && userProfile.photoURL.length <= 120000
            ? { senderPhotoURL: userProfile.photoURL }
            : {}),
          receiverId,
          type: 'post',
          text: note.trim() || post.content?.slice(0, 120) || 'Shared a post',
          sharedPostId: post.postId,
          sharedPostAuthorId: post.authorId,
          sharedPostAuthorName: post.authorDisplayName,
          sharedPostAuthorUsername: post.authorUsername,
          ...(includeAuthorPhoto ? { sharedPostAuthorPhoto: post.authorPhotoURL } : {}),
          sharedPostContent: (post.content || '').slice(0, 500),
          sharedPostMediaType: post.mediaType,
          ...(includeMediaUrl ? { sharedPostMediaUrl: post.mediaUrl } : {}),
          status: 'sent',
          createdAt: now,
        };

        if (!isOnline()) {
          queueOfflineMessage({
            localId: messageId,
            chatId: targetChatId,
            senderId: basePayload.senderId,
            senderUsername: basePayload.senderUsername,
            senderDisplayName: basePayload.senderDisplayName,
            senderPhotoURL: basePayload.senderPhotoURL,
            receiverId,
            type: 'post',
            text: basePayload.text,
            sharedPostId: basePayload.sharedPostId,
            sharedPostAuthorId: basePayload.sharedPostAuthorId,
            sharedPostAuthorName: basePayload.sharedPostAuthorName,
            sharedPostAuthorUsername: basePayload.sharedPostAuthorUsername,
            sharedPostAuthorPhoto: basePayload.sharedPostAuthorPhoto,
            sharedPostContent: basePayload.sharedPostContent,
            sharedPostMediaUrl: basePayload.sharedPostMediaUrl,
            sharedPostMediaType: basePayload.sharedPostMediaType,
          });
        } else {
          await setDoc(doc(db, 'chats', targetChatId, 'messages', messageId), basePayload);

          await setDoc(
            doc(db, 'chats', targetChatId),
            {
              chatId: targetChatId,
              participantIds: [userProfile.userId, target.user.userId],
              lastMessage: summarySnippet,
              lastMessageTime: now,
              lastSenderId: userProfile.userId,
              unreadCounts: {
                [target.user.userId]: increment(1),
              },
              updatedAt: now,
            },
            { merge: true }
          );

          await createAppNotification({
            recipientId: target.user.userId,
            actor: userProfile,
            type: 'share',
            postId: post.postId,
            chatId: targetChatId,
            text: note.trim() || post.content?.slice(0, 80) || summarySnippet,
          });
        }
      }

      const added = chosenTargets.length;
      if (added > 0) {
        const postDocRef = doc(db, 'posts', post.postId);
        await updateDoc(postDocRef, {
          sharesCount: increment(added),
        }).catch(async () => {
          await setDoc(
            postDocRef,
            { ...post, sharesCount: (post.sharesCount || 0) + added },
            { merge: true }
          );
        });

        try {
          const monthKey = getCurrentMonthKey();
          const authorSnap = await getDoc(doc(db, 'users', post.authorId));
          if (authorSnap.exists()) {
            const authorData = authorSnap.data() as UserProfile;
            const currentMonthCount =
              authorData.monthlySharesMonth === monthKey ? authorData.monthlySharesCount || 0 : 0;
            const nextMonthlyCount = currentMonthCount + added;
            const updatePayload: Record<string, any> = {
              monthlySharesMonth: monthKey,
              monthlySharesCount: nextMonthlyCount,
            };
            if (nextMonthlyCount >= 400000 && authorData.warningActive) {
              updatePayload.warningActive = false;
              updatePayload.warningClearedReason = '400k_monthly_shares';
            }
            await updateDoc(doc(db, 'users', post.authorId), updatePayload);
          }
        } catch {
          // non-blocking
        }

        onShared?.(added);
      }

      setSentDone(true);
      setTimeout(() => {
        onClose();
      }, 650);
    } catch (error: any) {
      setErrMsg(error?.message || 'Failed to share post.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/65 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 flex flex-col max-h-[88vh] overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#7560DF]/15 text-[#7560DF] flex items-center justify-center">
              <Share2 className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                {t('shareToEthioChat')}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('shareToUsersAndGroups')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Post Mini Preview */}
        <div className="px-5 py-3 bg-slate-50/70 dark:bg-[#1c1836] border-b border-slate-100 dark:border-purple-950/40 flex items-center gap-3">
          {post.mediaUrl && post.mediaType === 'image' ? (
            <img
              src={post.mediaUrl}
              alt="Post preview"
              className="w-11 h-11 rounded-xl object-cover shrink-0 border border-slate-200 dark:border-purple-900/50"
            />
          ) : post.mediaUrl && post.mediaType === 'video' ? (
            <div className="w-11 h-11 rounded-xl bg-[#7560DF]/15 text-[#7560DF] flex items-center justify-center shrink-0">
              <VideoIcon className="w-5 h-5" />
            </div>
          ) : (
            <img
              src={post.authorPhotoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${post.authorUsername}`}
              alt={post.authorDisplayName}
              className="w-11 h-11 rounded-full object-cover shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
              {post.authorDisplayName}{' '}
              <span className="font-normal text-[#7560DF] dark:text-[#A798F8]">
                @{post.authorUsername}
              </span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {post.content || (post.mediaType === 'video' ? 'Video post' : 'Photo post')}
            </p>
          </div>
        </div>

        {/* Search & Filter Tabs */}
        <div className="px-4 pt-3 pb-2 space-y-2.5 border-b border-slate-100 dark:border-purple-950/30">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Ethio Chat users or teams..."
              className="w-full pl-9 pr-4 py-2 rounded-2xl bg-slate-100 dark:bg-[#201c38] text-xs sm:text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-[#7560DF]"
            />
          </div>

          <div className="flex gap-1.5">
            {(['all', 'users', 'teams'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={`px-3 py-1 rounded-full text-xs font-bold capitalize transition-colors ${
                  tab === item
                    ? 'bg-[#7560DF] text-white'
                    : 'bg-slate-100 dark:bg-[#201c38] text-slate-600 dark:text-slate-300'
                }`}
              >
                {item === 'all'
                  ? `All (${registeredUsers.length + teams.length})`
                  : item === 'users'
                  ? `Users (${registeredUsers.length})`
                  : `Teams (${teams.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Targets List */}
        <div className="p-3 overflow-y-auto flex-1 space-y-1.5">
          {filteredTargets.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              No Ethio Chat users or teams match your search.
            </div>
          ) : (
            filteredTargets.map((target) => {
              const selected = selectedKeys.has(target.id);
              if (target.kind === 'team') {
                return (
                  <button
                    key={target.id}
                    type="button"
                    onClick={() => toggleKey(target.id)}
                    className={`w-full p-2.5 rounded-2xl flex items-center gap-3 text-left transition-all ${
                      selected
                        ? 'bg-[#7560DF]/12 border border-[#7560DF]/40'
                        : 'hover:bg-slate-50 dark:hover:bg-[#201c38] border border-transparent'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-2xl overflow-hidden bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] text-white flex items-center justify-center shrink-0">
                      {target.team.photoURL ? (
                        <img src={target.team.photoURL} alt={target.team.name} className="w-full h-full object-cover" />
                      ) : (
                        <Layers className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {target.team.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Team · {(target.team.memberCount || 1).toLocaleString()} members
                      </p>
                    </div>
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center border shrink-0 ${
                        selected
                          ? 'bg-[#7560DF] border-[#7560DF] text-white'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {selected && <Check className="w-3.5 h-3.5" />}
                    </div>
                  </button>
                );
              }

              return (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => toggleKey(target.id)}
                  className={`w-full p-2.5 rounded-2xl flex items-center gap-3 text-left transition-all ${
                    selected
                      ? 'bg-[#7560DF]/12 border border-[#7560DF]/40'
                      : 'hover:bg-slate-50 dark:hover:bg-[#201c38] border border-transparent'
                  }`}
                >
                  <img
                    src={
                      target.user.photoURL ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${target.user.username}`
                    }
                    alt={target.user.displayName}
                    className="w-10 h-10 rounded-full object-cover shrink-0 ring-1 ring-slate-200 dark:ring-purple-900/50"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 min-w-0">
                      <p className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {target.user.displayName}
                      </p>
                      <GoldVerifiedBadge userId={target.user.userId} size="xs" />
                    </div>
                    <p className="text-xs text-[#7560DF] dark:text-[#A798F8] truncate">
                      @{target.user.username}
                    </p>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center border shrink-0 ${
                      selected
                        ? 'bg-[#7560DF] border-[#7560DF] text-white'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {selected && <Check className="w-3.5 h-3.5" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Optional Note & Send Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-purple-950/40 bg-slate-50/70 dark:bg-[#120f24] space-y-2.5 safe-bottom">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
            placeholder="Write an optional message..."
            className="w-full px-4 py-2 rounded-2xl bg-white dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
          />

          {errMsg && <p className="text-xs font-semibold text-rose-500">{errMsg}</p>}

          <button
            type="button"
            disabled={selectedKeys.size === 0 || isSending || sentDone}
            onClick={handleSendShares}
            className="w-full py-3 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] disabled:opacity-50 text-white font-bold text-sm shadow-md shadow-[#7560DF]/25 flex items-center justify-center gap-2 transition-all"
          >
            {sentDone ? (
              <>
                <Check className="w-4 h-4" />
                <span>Shared to {selectedKeys.size}!</span>
              </>
            ) : isSending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Sharing...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>
                  {t('share')} {selectedKeys.size > 0 ? `(${selectedKeys.size})` : ''}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
