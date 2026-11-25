import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import { collection, query, where, onSnapshot, doc, getDocs, getDoc, getDocsFromServer, getDocFromServer } from 'firebase/firestore';
import { UserProfile, Post, ChatParticipant, FollowRecord } from '../../types';
import { isAudienceVisibleToUser, recordViewStat, isUserOnlineNow, formatLastSeen } from '../../lib/socialHelpers';
import { compressImage } from '../../lib/mediaCompression';
import { readPendingEmailChangeFlow } from '../../lib/otpFlowPersistence';
import { PostCard } from '../feed/PostCard';
import { CommentsModal } from '../feed/CommentsModal';
import { EditProfileModal } from './EditProfileModal';
import { WarningAppealModal } from './WarningAppealModal';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { PullToRefreshBanner } from '../common/PullToRefreshBanner';
import { GoldVerifiedBadge } from '../common/GoldVerifiedBadge';
import { 
  UserPlus, 
  Check, 
  MessageSquare, 
  Edit3, 
  Calendar, 
  ArrowLeft,
  Sparkles,
  Eye,
  EyeOff,
  Ban,
  Camera,
  Link as LinkIcon,
  X,
  Users,
  Loader2,
  Clock,
  Lock,
  UserCheck,
  AlertTriangle,
  Mail
} from 'lucide-react';

interface ProfileViewProps {
  userId?: string;
  onBack?: () => void;
  onStartChat: (recipient: ChatParticipant) => void;
  onViewProfile: (userId: string) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  userId,
  onBack,
  onStartChat,
  onViewProfile
}) => {
  const {
    currentUser,
    userProfile: myProfile,
    allUsers,
    followingIds,
    followerIds,
    followUser,
    unfollowUser,
    toggleHideOnlineStatus,
    updateUserProfileData,
    blockedIds,
    blockUser,
    unblockUser,
  } = useAuth();
  const { t } = useLanguage();

  const targetId = userId || currentUser?.uid;
  const isMe = !userId || userId === currentUser?.uid;

  const [profile, setProfile] = useState<UserProfile | null>(isMe ? myProfile : null);
  const [userPosts, setUserPosts] = useState<Post[]>([]);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [activeCommentsPost, setActiveCommentsPost] = useState<Post | null>(null);
  const [copyToast, setCopyToast] = useState(false);
  const [isUpdatingCover, setIsUpdatingCover] = useState(false);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);

  // Followers / Following Modal state
  const [followModalType, setFollowModalType] = useState<'followers' | 'following' | null>(null);
  const [followListUsers, setFollowListUsers] = useState<UserProfile[]>([]);
  const [loadingFollowList, setLoadingFollowList] = useState(false);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const restoredPendingUidRef = useRef<string | null>(null);
  const [listenerVersion, setListenerVersion] = useState(0);

  useEffect(() => {
    if (!isMe || !currentUser?.uid || !myProfile?.email) return;
    if (restoredPendingUidRef.current === currentUser.uid) return;
    restoredPendingUidRef.current = currentUser.uid;
    const pending = readPendingEmailChangeFlow(currentUser.uid, myProfile.email);
    if (pending) {
      setIsEditModalOpen(true);
    }
  }, [isMe, currentUser?.uid, myProfile?.email]);

  const handleRefreshProfile = useCallback(async () => {
    if (!targetId) return;
    const userRef = doc(db, 'users', targetId);
    const postsQ = query(collection(db, 'posts'), where('authorId', '==', targetId));
    const [userSnap, postsSnap] = await Promise.all([
      getDocFromServer(userRef).catch(() => getDoc(userRef)),
      getDocsFromServer(postsQ).catch(() => getDocs(postsQ)),
    ]);
    if (userSnap.exists()) {
      setProfile(userSnap.data() as UserProfile);
    }
    const freshPosts: Post[] = [];
    postsSnap.forEach((d) => {
      const p = d.data() as Post;
      if (isAudienceVisibleToUser(p, currentUser?.uid)) {
        freshPosts.push(p);
      }
    });
    freshPosts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setUserPosts(freshPosts);
    setListenerVersion((v) => v + 1);
  }, [targetId, currentUser?.uid]);

  const {
    containerRef,
    pullDistance,
    isRefreshing,
    refreshJustDone,
    pullHandlers,
  } = usePullToRefresh({
    onRefresh: handleRefreshProfile,
  });

  // Load target profile
  useEffect(() => {
    if (isMe) {
      setProfile(myProfile);
      return;
    }

    if (!targetId) return;

    const cached = allUsers.find(u => u.userId === targetId);
    if (cached) {
      setProfile(cached);
    }

    const unsub = onSnapshot(doc(db, 'users', targetId), (snap) => {
      if (snap.exists()) {
        setProfile(snap.data() as UserProfile);
      }
    });

    return () => unsub();
  }, [targetId, isMe, myProfile, allUsers, listenerVersion]);

  // Record profile view for Dashboard analytics
  useEffect(() => {
    if (!targetId || !currentUser || targetId === currentUser.uid) return;
    recordViewStat({
      targetUserId: targetId,
      viewerId: currentUser.uid,
      kind: 'profile',
      targetId,
    });
  }, [targetId, currentUser]);

  // Load posts by this user (respecting audience visibility)
  useEffect(() => {
    if (!targetId) return;

    const q = query(collection(db, 'posts'), where('authorId', '==', targetId));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: Post[] = [];
      snapshot.forEach(d => {
        const p = d.data() as Post;
        if (isAudienceVisibleToUser(p, currentUser?.uid)) {
          list.push(p);
        }
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setUserPosts(list);
    }, (err) => {
      console.warn('Profile posts error:', err);
    });

    return () => unsub();
  }, [targetId, currentUser, listenerVersion]);

  // Load followers or following list when modal opens (OWNER ONLY)
  const openFollowListModal = async (type: 'followers' | 'following') => {
    if (!targetId || !isMe) return;
    setFollowModalType(type);
    setLoadingFollowList(true);
    setFollowListUsers([]);

    try {
      const field = type === 'followers' ? 'followingId' : 'followerId';
      const q = query(collection(db, 'follows'), where(field, '==', targetId));
      const snap = await getDocs(q);
      const ids: string[] = [];
      snap.forEach((d) => {
        const rec = d.data() as FollowRecord;
        const otherId = type === 'followers' ? rec.followerId : rec.followingId;
        if (otherId && !ids.includes(otherId)) {
          ids.push(otherId);
        }
      });

      const resolved: UserProfile[] = [];
      for (const uid of ids) {
        const cached = allUsers.find((u) => u.userId === uid);
        if (cached) {
          resolved.push(cached);
        } else {
          const userSnap = await getDoc(doc(db, 'users', uid)).catch(() => null);
          if (userSnap && userSnap.exists()) {
            resolved.push(userSnap.data() as UserProfile);
          }
        }
      }
      setFollowListUsers(resolved);
    } catch (err) {
      console.warn('Failed to fetch follow list:', err);
    } finally {
      setLoadingFollowList(false);
    }
  };

  const handleQuickCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isMe) return;
    setIsUpdatingCover(true);
    try {
      const res = await compressImage(file, 1000, 480, 0.78);
      await updateUserProfileData({ coverURL: res.dataUrl });
    } catch (err) {
      console.error('Failed to update cover photo:', err);
    } finally {
      setIsUpdatingCover(false);
      e.target.value = '';
    }
  };

  const handleQuickAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isMe) return;
    setIsUpdatingAvatar(true);
    try {
      const res = await compressImage(file, 450, 450, 0.8);
      await updateUserProfileData({ photoURL: res.dataUrl });
    } catch (err) {
      console.error('Failed to update profile picture:', err);
    } finally {
      setIsUpdatingAvatar(false);
      e.target.value = '';
    }
  };

  const handleCopyProfileLink = async () => {
    if (!profile) return;
    const shareUrl = `${window.location.origin}/?profile=${encodeURIComponent(profile.userId)}`;
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
    setCopyToast(true);
    setTimeout(() => setCopyToast(false), 2200);
  };

  if (!profile) {
    return (
      <div className="max-w-xl mx-auto p-8 text-center text-slate-400">
        <div className="w-12 h-12 rounded-full border-2 border-[#7560DF] border-t-transparent animate-spin mx-auto mb-3" />
        <p className="text-sm">Loading profile...</p>
      </div>
    );
  }

  const isFollowing = targetId ? followingIds.has(targetId) : false;
  const isFollowedBy = targetId ? followerIds.has(targetId) : false;
  const isMutualFriend = !isMe && isFollowing && isFollowedBy;
  const isBlocked = targetId ? blockedIds.has(targetId) : false;
  const isOnlineHidden = Boolean(profile.hideOnlineStatus);
  const lastSeenVisibility = profile.lastSeenVisibility || 'everyone';
  const canSeeLastSeen =
    !isOnlineHidden &&
    (lastSeenVisibility === 'everyone' ||
      (lastSeenVisibility === 'followers' && (isMe || isFollowing || isFollowedBy)));
  const isProfileOnline = canSeeLastSeen && isUserOnlineNow(profile);
  const lastSeenText = canSeeLastSeen
    ? formatLastSeen(profile.lastSeenAt || profile.updatedAt)
    : null;

  const formatJoinDate = (isoString?: string) => {
    if (!isoString) return 'Joined recently';
    try {
      const d = new Date(isoString);
      return `Joined ${d.toLocaleDateString([], { month: 'short', year: 'numeric' })}`;
    } catch {
      return 'Joined recently';
    }
  };

  return (
    <div
      ref={containerRef}
      {...pullHandlers}
      className="max-w-xl mx-auto pb-24 min-h-[calc(100dvh-8rem)] overscroll-y-contain"
    >
      <PullToRefreshBanner
        pullDistance={pullDistance}
        isRefreshing={isRefreshing}
        refreshJustDone={refreshJustDone}
        refreshingLabel="Refreshing Profile..."
        updatedLabel="Profile updated!"
      />
      {/* Hidden quick inputs for own profile photo & cover */}
      <input
        type="file"
        ref={coverInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleQuickCoverChange}
      />
      <input
        type="file"
        ref={avatarInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleQuickAvatarChange}
      />

      {/* Profile Header Cover */}
      <div className="relative h-48 sm:h-56 bg-gradient-to-r from-[#503cb3] via-[#7560DF] to-[#9986fa] overflow-hidden">
        {profile.coverURL && (
          <img
            src={profile.coverURL}
            alt={`${profile.displayName} cover`}
            className="w-full h-full object-cover"
          />
        )}

        {onBack && (
          <button
            onClick={onBack}
            className="absolute top-4 left-4 z-10 p-2 rounded-full bg-black/35 hover:bg-black/55 text-white backdrop-blur-md transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}

        {!profile.coverURL && (
          <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]" />
        )}

        {/* Change Cover button for own profile */}
        {isMe && (
          <button
            onClick={() => coverInputRef.current?.click()}
            disabled={isUpdatingCover}
            className="absolute top-4 right-4 z-10 px-3 py-1.5 rounded-full bg-black/45 hover:bg-black/65 text-white backdrop-blur-md text-xs font-bold flex items-center gap-1.5 shadow transition-all"
          >
            {isUpdatingCover ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Camera className="w-3.5 h-3.5" />
            )}
            <span>{t('changeCover')}</span>
          </button>
        )}

        {/* Online / Offline Visibility Icon Switch on Own Profile */}
        {isMe ? (
          <button
            onClick={() => toggleHideOnlineStatus()}
            className={`absolute bottom-14 sm:bottom-3 right-4 px-3 py-1.5 rounded-full backdrop-blur-md text-[11px] font-bold flex items-center gap-1.5 transition-all shadow ${
              isOnlineHidden
                ? 'bg-slate-900/75 text-amber-300 border border-amber-400/40'
                : 'bg-emerald-600/80 text-white border border-white/20'
            }`}
            title="Turn ON to hide your online status from others, OFF to appear online"
          >
            {isOnlineHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{isOnlineHidden ? t('onlinePrivacyOn') : t('onlinePrivacyOff')}</span>
          </button>
        ) : (
          <div className="absolute bottom-3 right-4 px-3 py-1 rounded-full bg-black/35 backdrop-blur-md text-[11px] font-bold text-white/95">
            Ethio Chat Member 🇪🇹
          </div>
        )}
      </div>

      {/* Main Profile Info Card */}
      <div className="relative px-5 pt-0 -mt-12 bg-white dark:bg-[#16132b] rounded-t-3xl border-t border-slate-200/80 dark:border-purple-950/40 shadow-sm space-y-4">
        <div className="flex items-end justify-between pt-2 gap-2 flex-wrap">
          <div className="relative">
            <img
              src={profile.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${profile.username}`}
              alt={profile.displayName}
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover ring-4 ring-white dark:ring-[#16132b] shadow-xl bg-white"
            />
            {isMe ? (
              <button
                onClick={() => avatarInputRef.current?.click()}
                disabled={isUpdatingAvatar}
                className="absolute bottom-1 right-1 p-2 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white shadow-lg border-2 border-white dark:border-[#16132b] transition-transform active:scale-95"
                title={t('changePhoto')}
              >
                {isUpdatingAvatar ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Camera className="w-3.5 h-3.5" />
                )}
              </button>
            ) : isProfileOnline ? (
              <span className="absolute bottom-2 right-2 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white dark:border-[#16132b]" />
            ) : null}
          </div>

          <div className="flex items-center gap-2 pb-2 flex-wrap">
            {isMe ? (
              <>
                <button
                  onClick={() => setIsEditModalOpen(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-slate-100 dark:bg-purple-950/40 hover:bg-slate-200 text-slate-800 dark:text-slate-200 text-xs sm:text-sm font-bold transition-all shadow-sm"
                >
                  <Edit3 className="w-4 h-4 text-[#7560DF]" />
                  <span>{t('editProfile')}</span>
                </button>
                <button
                  onClick={handleCopyProfileLink}
                  className="relative flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-[#7560DF]/10 dark:bg-[#7560DF]/20 hover:bg-[#7560DF]/20 text-[#7560DF] dark:text-[#B09EFC] text-xs sm:text-sm font-bold transition-all"
                  title={t('copyProfileLink')}
                >
                  <LinkIcon className="w-4 h-4" />
                  <span>{copyToast ? t('linkCopied') : t('copyLink')}</span>
                </button>
                {profile.warningActive && !profile.accountSuspended && (
                  <button
                    type="button"
                    onClick={() => setShowWarningModal(true)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white text-xs sm:text-sm font-extrabold shadow-md shadow-amber-500/25 transition-all"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    <span>{t('warningBadge')}</span>
                  </button>
                )}
              </>
            ) : (
              <>
                {isFollowing ? (
                  <button
                    onClick={() => unfollowUser(profile.userId)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-slate-100 dark:bg-purple-950/40 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-bold transition-all"
                  >
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>{t('following')}</span>
                  </button>
                ) : isFollowedBy ? (
                  <button
                    onClick={() => followUser(profile.userId)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold shadow-md shadow-[#7560DF]/25 transition-all"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>{t('followBack')}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => followUser(profile.userId)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold shadow-md shadow-[#7560DF]/25 transition-all"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>{t('follow')}</span>
                  </button>
                )}

                <button
                  onClick={() => onStartChat({
                    userId: profile.userId,
                    username: profile.username,
                    displayName: profile.displayName,
                    photoURL: profile.photoURL
                  })}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-[#7560DF]/15 hover:bg-[#7560DF]/25 text-[#7560DF] dark:text-[#B09EFC] text-xs font-bold transition-all"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>{t('messageBtn')}</span>
                </button>

                <button
                  onClick={handleCopyProfileLink}
                  className="flex items-center gap-1 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-purple-950/40 text-slate-700 dark:text-slate-300 text-xs font-bold transition-all"
                  title={t('copyProfileLink')}
                >
                  <LinkIcon className="w-3.5 h-3.5 text-[#7560DF]" />
                  <span>{copyToast ? t('linkCopied') : t('copyLink')}</span>
                </button>

                <button
                  onClick={() =>
                    isBlocked
                      ? unblockUser(profile.userId)
                      : blockUser({
                          userId: profile.userId,
                          username: profile.username,
                          displayName: profile.displayName,
                          photoURL: profile.photoURL,
                        })
                  }
                  className={`flex items-center gap-1 px-3 py-2 rounded-2xl text-xs font-bold transition-all ${
                    isBlocked
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400'
                  }`}
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>{isBlocked ? t('unblockUser') : t('blockUser')}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Name, Handle & Bio */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
              <span>{profile.displayName}</span>
              <GoldVerifiedBadge userId={profile.userId} size="md" />
            </h2>
            {isMutualFriend && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#7560DF]/15 dark:bg-[#7560DF]/25 text-[#7560DF] dark:text-[#B09EFC] border border-[#7560DF]/30 text-[11px] font-extrabold">
                <UserCheck className="w-3.5 h-3.5" />
                <span>{t('friendBadge')}</span>
              </span>
            )}
            {isProfileOnline && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
                {t('online')}
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm font-semibold text-[#7560DF] dark:text-[#A798F8]">
            @{profile.username}
          </p>

          <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-1">
            {profile.bio || 'Active member of the Ethio Chat social network.'}
          </p>

          <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 pt-1">
            {isMe && profile.email && (
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300 font-medium">
                <Mail className="w-3.5 h-3.5 text-[#7560DF]" />
                <span>{profile.email}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>{formatJoinDate(profile.createdAt)}</span>
            </span>
            {lastSeenText && (
              <span
                className={`flex items-center gap-1 font-medium ${
                  isProfileOnline ? 'text-emerald-500' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>{lastSeenText}</span>
              </span>
            )}
          </div>
        </div>

        {/* Follower / Following Stats Counts — Clickable ONLY for the account owner */}
        <div className="flex items-center gap-6 py-3 border-y border-slate-100 dark:border-purple-950/40 text-sm">
          {isMe ? (
            <button
              type="button"
              onClick={() => openFollowListModal('followers')}
              className="text-left hover:bg-slate-50 dark:hover:bg-purple-950/30 px-2.5 py-1 -ml-2.5 rounded-xl transition-colors cursor-pointer"
            >
              <span className="font-extrabold text-slate-900 dark:text-white mr-1 text-base">
                {Math.max(0, profile.followersCount || 0)}
              </span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:underline">
                {t('followers')}
              </span>
            </button>
          ) : (
            <div
              className="text-left px-2.5 py-1 -ml-2.5 rounded-xl select-none"
              title={t('followListPrivate')}
            >
              <span className="font-extrabold text-slate-900 dark:text-white mr-1 text-base">
                {Math.max(0, profile.followersCount || 0)}
              </span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                {t('followers')}
                <Lock className="w-3 h-3 text-slate-400" />
              </span>
            </div>
          )}

          {isMe ? (
            <button
              type="button"
              onClick={() => openFollowListModal('following')}
              className="text-left hover:bg-slate-50 dark:hover:bg-purple-950/30 px-2.5 py-1 rounded-xl transition-colors cursor-pointer"
            >
              <span className="font-extrabold text-slate-900 dark:text-white mr-1 text-base">
                {Math.max(0, profile.followingCount || 0)}
              </span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:underline">
                {t('following')}
              </span>
            </button>
          ) : (
            <div
              className="text-left px-2.5 py-1 rounded-xl select-none"
              title={t('followListPrivate')}
            >
              <span className="font-extrabold text-slate-900 dark:text-white mr-1 text-base">
                {Math.max(0, profile.followingCount || 0)}
              </span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                {t('following')}
                <Lock className="w-3 h-3 text-slate-400" />
              </span>
            </div>
          )}

          <div>
            <span className="font-extrabold text-slate-900 dark:text-white mr-1 text-base">
              {userPosts.length}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('posts')}</span>
          </div>
        </div>

        {/* Posts Tab Title */}
        <div className="pt-2">
          <h3 className="font-bold text-sm uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#7560DF]" />
            <span>{t('posts')} · {profile.displayName}</span>
          </h3>
        </div>

        {/* User Posts Stream */}
        <div className="space-y-4 pt-1">
          {userPosts.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <Sparkles className="w-8 h-8 mx-auto opacity-40 text-[#7560DF]" />
              <p className="text-sm font-semibold">No posts yet</p>
              <p className="text-xs">Posts created by this user will appear here.</p>
            </div>
          ) : (
            userPosts.map((post) => (
              <PostCard
                key={post.postId}
                post={post}
                onOpenComments={(p) => setActiveCommentsPost(p)}
                onViewProfile={onViewProfile}
              />
            ))
          )}
        </div>
      </div>

      {/* Followers / Following Users Modal (Owner Only) */}
      {followModalType && isMe && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 flex flex-col max-h-[80vh] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-[#7560DF]" />
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  {followModalType === 'followers' ? t('followers') : t('following')} · {profile.displayName}
                </h3>
              </div>
              <button
                onClick={() => setFollowModalType(null)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/30"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {loadingFollowList ? (
                <div className="py-10 text-center text-slate-400 flex flex-col items-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#7560DF]" />
                  <span className="text-xs">Loading list...</span>
                </div>
              ) : followListUsers.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-xs">
                  {followModalType === 'followers'
                    ? 'No followers yet.'
                    : 'Not following anyone yet.'}
                </div>
              ) : (
                followListUsers.map((u) => (
                  <button
                    key={u.userId}
                    onClick={() => {
                      setFollowModalType(null);
                      onViewProfile(u.userId);
                    }}
                    className="w-full p-2.5 rounded-2xl hover:bg-slate-50 dark:hover:bg-[#201c38] flex items-center gap-3 text-left transition-colors"
                  >
                    <img
                      src={u.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`}
                      alt={u.displayName}
                      className="w-10 h-10 rounded-full object-cover ring-1 ring-slate-200 dark:ring-purple-900/50"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm text-slate-900 dark:text-white truncate flex items-center gap-1">
                        <span className="truncate">{u.displayName}</span>
                        <GoldVerifiedBadge userId={u.userId} size="xs" />
                      </p>
                      <p className="text-xs text-[#7560DF] dark:text-[#A798F8] truncate">
                        @{u.username}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      <EditProfileModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
      />

      {/* Comments Drawer */}
      <CommentsModal
        post={activeCommentsPost}
        onClose={() => setActiveCommentsPost(null)}
        onViewProfile={onViewProfile}
      />

      {/* Owner-Only Warning Appeal Modal */}
      {isMe && (
        <WarningAppealModal
          isOpen={showWarningModal}
          onClose={() => setShowWarningModal(false)}
        />
      )}
    </div>
  );
};
