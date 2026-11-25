import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider } from './context/LanguageContext';
import { Header } from './components/common/Header';
import { BottomNav, TabType } from './components/common/BottomNav';
import { FeedView } from './components/feed/FeedView';
import { VideoFeedView } from './components/video/VideoFeedView';
import { ChatListView } from './components/chat/ChatListView';
import { ChatRoomView } from './components/chat/ChatRoomView';
import { CreateGroupModal } from './components/chat/CreateGroupModal';
import { CreateTeamModal } from './components/chat/CreateTeamModal';
import { TeamRoomView } from './components/chat/TeamRoomView';
import { GroupViewModal } from './components/feed/GroupViewModal';
import { CallModal } from './components/chat/CallModal';
import { primeMediaStream } from './lib/mediaPermissions';
import { ProfileView } from './components/profile/ProfileView';
import { SettingsView } from './components/settings/SettingsView';
import { AuthModal } from './components/auth/AuthModal';
import { UserSearchModal } from './components/common/UserSearchModal';
import { AllUsersView } from './components/common/AllUsersView';
import { NotificationsModal } from './components/common/NotificationsModal';
import { SwitchAccountModal } from './components/settings/SwitchAccountModal';
import { DashboardModal } from './components/settings/DashboardModal';
import { RubGPTModal } from './components/settings/RubGPTModal';
import { BlockedUsersModal } from './components/settings/BlockedUsersModal';
import { DevicesModal } from './components/settings/DevicesModal';
import {
  LastSeenModal,
  TwoStepModal,
  AppLockConfigModal,
  PasscodeOverlay
} from './components/settings/PrivacySecurityModals';
import {
  ChatWallpaperModal,
  FontSizeModal,
  ChatBackupModal,
  FontStyleModal
} from './components/settings/ChatSettingsModals';
import { WarningAppealModal } from './components/profile/WarningAppealModal';
import { ModerationInboxModal } from './components/settings/ModerationInboxModal';
import { SubscriptionModal } from './components/settings/SubscriptionModal';
import { AdminPaymentDashboard } from './components/settings/AdminPaymentDashboard';
import { ADMIN_MODERATION_EMAIL, getFontStack, isAudienceVisibleToUser } from './lib/socialHelpers';
import { readPendingEmailChangeFlow } from './lib/otpFlowPersistence';
import {
  cleanupPushListeners,
  ForegroundPushEventDetail,
  registerAndSyncPushToken,
} from './lib/pushNotifications';
import { db } from './lib/firebase';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  setDoc,
  getDoc
} from 'firebase/firestore';
import { CallSession, ChatParticipant, ChatRoom, Post, SocialGroup, Team } from './types';
import { AlertTriangle, ShieldAlert, Mail, LogOut, Bell, X } from 'lucide-react';

type ActiveChatState =
  | { type: 'direct'; chatId: string; recipient: ChatParticipant }
  | { type: 'group'; chatId: string; groupRoom: ChatRoom }
  | { type: 'team'; teamId: string; team: Team }
  | null;

const MainAppContent: React.FC = () => {
  const {
    currentUser,
    userProfile,
    loading,
    isAddingAccount,
    closeAddAccount,
    signOut,
    followingIds,
    blockedIds,
    incomingFollowRecords,
    isOwner,
    isAdmin,
  } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [activeChat, setActiveChat] = useState<ActiveChatState>(null);
  const [activeGroup, setActiveGroup] = useState<{ groupId: string; initialGroup?: SocialGroup | null } | null>(null);
  const [viewingProfileUserId, setViewingProfileUserId] = useState<string | null>(null);
  const [focusedPostId, setFocusedPostId] = useState<string | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [foregroundPushToast, setForegroundPushToast] = useState<ForegroundPushEventDetail | null>(null);

  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
  const [isCreateTeamModalOpen, setIsCreateTeamModalOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSwitchAccountOpen, setIsSwitchAccountOpen] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [isRubGPTOpen, setIsRubGPTOpen] = useState(false);
  const [isBlockedOpen, setIsBlockedOpen] = useState(false);
  const [isDevicesOpen, setIsDevicesOpen] = useState(false);

  const [isLastSeenOpen, setIsLastSeenOpen] = useState(false);
  const [isTwoStepOpen, setIsTwoStepOpen] = useState(false);
  const [isAppLockOpen, setIsAppLockOpen] = useState(false);
  const [isChatWallpaperOpen, setIsChatWallpaperOpen] = useState(false);
  const [isFontSizeOpen, setIsFontSizeOpen] = useState(false);
  const [isFontStyleOpen, setIsFontStyleOpen] = useState(false);
  const [isChatBackupOpen, setIsChatBackupOpen] = useState(false);
  const [isWarningModalOpen, setIsWarningModalOpen] = useState(false);
  const [isModerationInboxOpen, setIsModerationInboxOpen] = useState(false);
  const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
  const [isPaymentDashboardOpen, setIsPaymentDashboardOpen] = useState(false);
  const [adminDashboardDismissed, setAdminDashboardDismissed] = useState(false);

  useEffect(() => {
    setAdminDashboardDismissed(false);
    setIsPaymentDashboardOpen(false);
  }, [currentUser?.uid]);

  const [isAppLocked, setIsAppLocked] = useState<boolean>(true);
  const [twoStepSessionTick, setTwoStepSessionTick] = useState<number>(0);

  const [activeCall, setActiveCall] = useState<CallSession | null>(null);

  // Navigation badge counters: Chat unread people, Home new following posters, Video new videos, All Users new follows
  const [unreadChatPeopleCount, setUnreadChatPeopleCount] = useState<number>(0);
  const [allPostsFeed, setAllPostsFeed] = useState<Post[]>([]);
  const [homeRefreshSignal, setHomeRefreshSignal] = useState<number>(0);
  const [videoRefreshSignal, setVideoRefreshSignal] = useState<number>(0);
  const [lastHomeSeenAt, setLastHomeSeenAt] = useState<string>('1970-01-01T00:00:00.000Z');
  const [lastVideoSeenAt, setLastVideoSeenAt] = useState<string>('1970-01-01T00:00:00.000Z');
  const [lastAllUsersSeenAt, setLastAllUsersSeenAt] = useState<string>('1970-01-01T00:00:00.000Z');
  const visitedAllUsersRef = React.useRef<boolean>(false);
  const restoredOtpTabUidRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (!currentUser?.uid || !userProfile?.email) return;
    if (restoredOtpTabUidRef.current === currentUser.uid) return;
    restoredOtpTabUidRef.current = currentUser.uid;
    const pending = readPendingEmailChangeFlow(currentUser.uid, userProfile.email);
    if (pending) {
      setViewingProfileUserId(null);
      setActiveTab('profile');
      setActiveChat(null);
    }
  }, [currentUser?.uid, userProfile?.email]);

  // Sync chosen Font Style globally across the entire app
  useEffect(() => {
    const chosen =
      userProfile?.fontStyle ||
      (() => {
        try {
          return localStorage.getItem('ethio_font_style') || undefined;
        } catch {
          return undefined;
        }
      })();
    const stack = getFontStack(chosen);
    document.documentElement.style.setProperty('--app-font', stack);
    document.body.style.fontFamily = stack;
  }, [userProfile?.fontStyle]);

  // Reset App Lock prompt cleanly on user change
  useEffect(() => {
    if (userProfile?.appLockEnabled && (userProfile?.appLockPin || userProfile?.fingerprintLockEnabled)) {
      const unlocked = sessionStorage.getItem(`ethio_applock_ok_${userProfile.userId}`) === 'true';
      setIsAppLocked(!unlocked);
    } else {
      setIsAppLocked(false);
    }
  }, [userProfile?.userId, userProfile?.appLockEnabled, userProfile?.appLockPin, userProfile?.fingerprintLockEnabled]);

  // Support deep links like ?profile=<uid> or ?post=<postId>&comment=<commentId>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedProfileId = params.get('profile');
    const sharedPostId = params.get('post');
    const sharedCommentId = params.get('comment');

    if (sharedProfileId) {
      setViewingProfileUserId(sharedProfileId);
      setActiveTab('profile');
    } else if (sharedPostId) {
      setFocusedPostId(sharedPostId);
      setFocusedCommentId(sharedCommentId || null);
      setActiveTab('home');
    }
  }, []);

  // Register FCM push token & listen for foreground/background-click post navigation
  useEffect(() => {
    if (!currentUser) {
      cleanupPushListeners();
      return;
    }
    void registerAndSyncPushToken(currentUser.uid, { requestPermission: false });

    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    const onForegroundPush = (evt: Event) => {
      const detail = (evt as CustomEvent<ForegroundPushEventDetail>).detail;
      if (!detail) return;
      setForegroundPushToast(detail);
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => setForegroundPushToast(null), 6500);
    };

    const onSwMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; postId?: string; commentId?: string } | undefined;
      if (data?.type === 'OPEN_MENTION_POST' && data.postId) {
        setActiveChat(null);
        setActiveGroup(null);
        setViewingProfileUserId(null);
        setFocusedPostId(data.postId);
        setFocusedCommentId(data.commentId || null);
        setActiveTab('home');
      }
    };

    window.addEventListener('ethio-foreground-push', onForegroundPush);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onSwMessage);
    }

    return () => {
      if (toastTimer) clearTimeout(toastTimer);
      window.removeEventListener('ethio-foreground-push', onForegroundPush);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage);
      }
    };
  }, [currentUser?.uid]);

  // Listen globally for incoming ringing audio/video calls for the logged-in user
  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'calls'),
      where('calleeId', '==', currentUser.uid),
      where('status', '==', 'ringing')
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) return;
        const incoming = snapshot.docs[0].data() as CallSession;
        setActiveCall((prev) => {
          if (prev && prev.callId === incoming.callId) return prev;
          return incoming;
        });
      },
      (err) => console.warn('Incoming call listener error:', err)
    );

    return () => unsub();
  }, [currentUser]);

  // Load persisted seen timestamps for Home new-posts badge, Video new-videos badge, and All Users follow badge
  useEffect(() => {
    if (!currentUser) {
      setLastHomeSeenAt('1970-01-01T00:00:00.000Z');
      setLastVideoSeenAt('1970-01-01T00:00:00.000Z');
      setLastAllUsersSeenAt('1970-01-01T00:00:00.000Z');
      return;
    }
    try {
      const savedHome = localStorage.getItem(`ethio_home_seen_${currentUser.uid}`);
      const savedVideo = localStorage.getItem(`ethio_video_seen_${currentUser.uid}`);
      const savedUsers = localStorage.getItem(`ethio_allusers_seen_${currentUser.uid}`);
      const fallback = userProfile?.createdAt || '1970-01-01T00:00:00.000Z';
      setLastHomeSeenAt(savedHome || fallback);
      setLastVideoSeenAt(savedVideo || fallback);
      setLastAllUsersSeenAt(savedUsers || fallback);
    } catch {
      // ignore
    }
  }, [currentUser?.uid, userProfile?.createdAt]);

  const markHomeSeen = React.useCallback(() => {
    if (!currentUser) return;
    const now = new Date().toISOString();
    setLastHomeSeenAt(now);
    try {
      localStorage.setItem(`ethio_home_seen_${currentUser.uid}`, now);
    } catch {
      // ignore
    }
  }, [currentUser]);

  const markVideoSeen = React.useCallback(() => {
    if (!currentUser) return;
    const now = new Date().toISOString();
    setLastVideoSeenAt(now);
    try {
      localStorage.setItem(`ethio_video_seen_${currentUser.uid}`, now);
    } catch {
      // ignore
    }
  }, [currentUser]);

  const markAllUsersSeen = React.useCallback(() => {
    if (!currentUser) return;
    const now = new Date().toISOString();
    setLastAllUsersSeenAt(now);
    try {
      localStorage.setItem(`ethio_allusers_seen_${currentUser.uid}`, now);
    } catch {
      // ignore
    }
  }, [currentUser]);

  // Count exact number of unique people who sent unread direct messages
  useEffect(() => {
    if (!currentUser) {
      setUnreadChatPeopleCount(0);
      return;
    }
    const q = query(
      collection(db, 'chats'),
      where('participantIds', 'array-contains', currentUser.uid)
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const unreadSenders = new Set<string>();
        snapshot.forEach((d) => {
          const room = d.data() as ChatRoom;
          if (room.isGroup) return;
          const unread = room.unreadCounts?.[currentUser.uid] || 0;
          if (unread > 0) {
            const otherId = room.participantIds.find((id) => id !== currentUser.uid);
            if (otherId && !blockedIds.has(otherId)) {
              unreadSenders.add(otherId);
            }
          }
        });
        setUnreadChatPeopleCount(unreadSenders.size);
      },
      () => {}
    );
    return () => unsub();
  }, [currentUser, blockedIds]);

  // Listen to posts to compute exact count of unique followed/added users who posted new content
  useEffect(() => {
    if (!currentUser) {
      setAllPostsFeed([]);
      return;
    }
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Post[] = [];
        snap.forEach((d) => list.push(d.data() as Post));
        setAllPostsFeed(list);
      },
      () => {}
    );
    return () => unsub();
  }, [currentUser]);

  const homeNewPostersCount = React.useMemo(() => {
    if (!currentUser) return 0;
    const seenMs = new Date(lastHomeSeenAt).getTime();
    const uniqueAuthors = new Set<string>();
    allPostsFeed.forEach((p) => {
      if (p.authorId === currentUser.uid) return;
      if (!followingIds.has(p.authorId)) return;
      if (blockedIds.has(p.authorId)) return;
      if (!isAudienceVisibleToUser(p, currentUser.uid)) return;
      if (new Date(p.createdAt).getTime() > seenMs) {
        uniqueAuthors.add(p.authorId);
      }
    });
    return uniqueAuthors.size;
  }, [allPostsFeed, currentUser, followingIds, blockedIds, lastHomeSeenAt]);

  const videoNewCount = React.useMemo(() => {
    if (!currentUser) return 0;
    const seenMs = new Date(lastVideoSeenAt).getTime();
    let count = 0;
    allPostsFeed.forEach((p) => {
      if (p.mediaType !== 'video' || !p.mediaUrl) return;
      if (p.authorId === currentUser.uid) return;
      if (blockedIds.has(p.authorId)) return;
      if (!isAudienceVisibleToUser(p, currentUser.uid)) return;
      if (new Date(p.createdAt).getTime() > seenMs) {
        count += 1;
      }
    });
    return count;
  }, [allPostsFeed, currentUser, blockedIds, lastVideoSeenAt]);

  const allUsersNewFollowCount = React.useMemo(() => {
    if (!currentUser) return 0;
    const seenMs = new Date(lastAllUsersSeenAt).getTime();
    const uniqueFollowers = new Set<string>();
    incomingFollowRecords.forEach((r) => {
      if (blockedIds.has(r.followerId)) return;
      if (new Date(r.createdAt).getTime() > seenMs) {
        uniqueFollowers.add(r.followerId);
      }
    });
    return uniqueFollowers.size;
  }, [incomingFollowRecords, currentUser, blockedIds, lastAllUsersSeenAt]);

  // Mark All Users as seen after opening & viewing, or when leaving the All Users tab
  useEffect(() => {
    if (activeTab === 'search') {
      visitedAllUsersRef.current = true;
      if (allUsersNewFollowCount > 0) {
        const timer = setTimeout(() => {
          markAllUsersSeen();
        }, 1200);
        return () => clearTimeout(timer);
      }
    } else if (visitedAllUsersRef.current) {
      visitedAllUsersRef.current = false;
      markAllUsersSeen();
    }
  }, [activeTab, allUsersNewFollowCount, markAllUsersSeen]);

  const handleStartCall = async (
    target: ChatParticipant,
    callType: 'audio' | 'video',
    chatId: string
  ) => {
    if (!currentUser || !userProfile) return;
    // Trigger browser media permission prompt synchronously inside the user click gesture
    primeMediaStream('call', {
      wantAudio: true,
      wantVideo: callType === 'video',
      facingMode: 'user',
    });
    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const session: CallSession = {
      callId,
      chatId,
      callerId: currentUser.uid,
      callerUsername: userProfile.username,
      callerDisplayName: userProfile.displayName,
      ...(userProfile.photoURL ? { callerPhotoURL: userProfile.photoURL } : {}),
      calleeId: target.userId,
      calleeUsername: target.username,
      calleeDisplayName: target.displayName,
      ...(target.photoURL ? { calleePhotoURL: target.photoURL } : {}),
      callType,
      status: 'ringing',
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, 'calls', callId), session);
    setActiveCall(session);
  };

  const handleStartChatWithUser = (recipient: ChatParticipant) => {
    if (!currentUser) return;
    const ids = [currentUser.uid, recipient.userId].sort();
    const chatId = `chat_${ids[0]}_${ids[1]}`;
    setActiveChat({ type: 'direct', chatId, recipient });
  };

  const handleOpenGroup = (group: SocialGroup) => {
    setActiveGroup({ groupId: group.groupId, initialGroup: group });
  };

  const handleOpenGroupById = (groupId: string) => {
    setActiveGroup({ groupId, initialGroup: null });
  };

  const handleSelectTeam = (team: Team) => {
    setActiveChat({ type: 'team', teamId: team.teamId, team });
  };

  const handleNavigateToChatById = async (chatId: string) => {
    try {
      const snap = await getDoc(doc(db, 'chats', chatId));
      if (snap.exists()) {
        const room = snap.data() as ChatRoom;
        if (room.isGroup) {
          setActiveTab('chats');
          setActiveChat({ type: 'group', chatId: room.chatId, groupRoom: room });
          return;
        }
      }
      const teamSnap = await getDoc(doc(db, 'teams', chatId));
      if (teamSnap.exists()) {
        const team = teamSnap.data() as Team;
        setActiveTab('chats');
        setActiveChat({ type: 'team', teamId: team.teamId, team });
        return;
      }
    } catch {
      // ignore
    }
    setActiveTab('chats');
  };

  const handleViewProfile = (userId: string) => {
    setViewingProfileUserId(userId);
    setActiveTab('profile');
    setActiveChat(null);
  };

  const handleClearFocusedPost = () => {
    setFocusedPostId(null);
    setFocusedCommentId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('post');
    url.searchParams.delete('comment');
    window.history.replaceState({}, '', url.toString());
  };

  const handleClearFocusedComment = () => {
    setFocusedCommentId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('comment');
    window.history.replaceState({}, '', url.toString());
  };

  const handleNavigateToPost = (postId: string, commentId?: string) => {
    setActiveChat(null);
    setActiveGroup(null);
    setViewingProfileUserId(null);
    setFocusedPostId(postId);
    setFocusedCommentId(commentId || null);
    setActiveTab('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderCurrentView = () => {
    if (activeChat) {
      if (activeChat.type === 'team') {
        return (
          <TeamRoomView
            team={activeChat.team}
            onBack={() => setActiveChat(null)}
            onViewProfile={handleViewProfile}
          />
        );
      }

      return (
        <ChatRoomView
          chatId={activeChat.chatId}
          recipient={activeChat.type === 'direct' ? activeChat.recipient : undefined}
          groupRoom={activeChat.type === 'group' ? activeChat.groupRoom : undefined}
          onBack={() => setActiveChat(null)}
          onViewProfile={handleViewProfile}
          onStartCall={handleStartCall}
          onOpenSharedPost={(postId) => {
            setFocusedPostId(postId);
            setActiveTab('home');
            setActiveChat(null);
          }}
        />
      );
    }

    switch (activeTab) {
      case 'home':
        return (
          <FeedView
            onViewProfile={handleViewProfile}
            onOpenGroup={handleOpenGroupById}
            focusedPostId={focusedPostId}
            focusedCommentId={focusedCommentId}
            onClearFocusedPost={handleClearFocusedPost}
            onClearFocusedComment={handleClearFocusedComment}
            newFollowingPostsCount={homeNewPostersCount}
            onMarkHomeSeen={markHomeSeen}
            externalRefreshSignal={homeRefreshSignal}
          />
        );
      case 'video':
        return (
          <VideoFeedView
            onViewProfile={handleViewProfile}
            newVideosCount={videoNewCount}
            onMarkVideoSeen={markVideoSeen}
            externalRefreshSignal={videoRefreshSignal}
          />
        );
      case 'chats':
        return (
          <ChatListView
            onSelectChat={(chatId, recipient) => setActiveChat({ type: 'direct', chatId, recipient })}
            onSelectTeam={handleSelectTeam}
            onOpenUserSearch={() => setIsSearchModalOpen(true)}
            onOpenCreateTeam={() => setIsCreateTeamModalOpen(true)}
          />
        );
      case 'search':
        return (
          <AllUsersView
            onSelectUserToChat={(recipient) => handleStartChatWithUser(recipient)}
            onViewProfile={handleViewProfile}
            onOpenGroup={handleOpenGroup}
          />
        );
      case 'profile':
        return (
          <ProfileView
            userId={viewingProfileUserId || undefined}
            onBack={() => {
              if (viewingProfileUserId) {
                setViewingProfileUserId(null);
                setActiveTab('home');
              } else {
                setActiveTab('settings');
              }
            }}
            onStartChat={handleStartChatWithUser}
            onViewProfile={handleViewProfile}
          />
        );
      case 'settings':
        return (
          <SettingsView
            onNavigateToProfile={() => {
              setViewingProfileUserId(null);
              setActiveTab('profile');
            }}
            onOpenSubscription={() => setIsSubscriptionOpen(true)}
            onOpenCreateGroup={() => setIsCreateGroupModalOpen(true)}
            onOpenSwitchAccount={() => setIsSwitchAccountOpen(true)}
            onOpenDashboard={() => setIsDashboardOpen(true)}
            onOpenRubGPT={() => setIsRubGPTOpen(true)}
            onOpenBlocked={() => setIsBlockedOpen(true)}
            onOpenDevices={() => setIsDevicesOpen(true)}
            onOpenLastSeen={() => setIsLastSeenOpen(true)}
            onOpenTwoStep={() => setIsTwoStepOpen(true)}
            onOpenAppLock={() => setIsAppLockOpen(true)}
            onOpenChatWallpaper={() => setIsChatWallpaperOpen(true)}
            onOpenFontSize={() => setIsFontSizeOpen(true)}
            onOpenFontStyle={() => setIsFontStyleOpen(true)}
            onOpenChatBackup={() => setIsChatBackupOpen(true)}
            onOpenModerationInbox={() => setIsModerationInboxOpen(true)}
            onOpenPaymentDashboard={() => setIsPaymentDashboardOpen(true)}
          />
        );
      default:
        return (
          <FeedView
            onViewProfile={handleViewProfile}
            onOpenGroup={handleOpenGroupById}
            focusedPostId={focusedPostId}
            focusedCommentId={focusedCommentId}
            onClearFocusedPost={handleClearFocusedPost}
            onClearFocusedComment={handleClearFocusedComment}
            newFollowingPostsCount={homeNewPostersCount}
            onMarkHomeSeen={markHomeSeen}
            externalRefreshSignal={homeRefreshSignal}
          />
        );
    }
  };

  // Admin accounts open Payment Management by default, with Back button to main Settings page
  if (currentUser && isAdmin && !isOwner && !isAddingAccount && !adminDashboardDismissed) {
    return (
      <>
        <AdminPaymentDashboard
          isOpen={true}
          standalone={true}
          onClose={() => {
            setAdminDashboardDismissed(true);
            setActiveTab('settings');
            setActiveChat(null);
          }}
        />
        <AuthModal isOpen={false} />
      </>
    );
  }

  return (
    <div className="min-h-[100dvh] w-full bg-white dark:bg-[#090714] text-slate-900 dark:text-slate-100 transition-colors flex flex-col items-center">
      {/* Main Responsive App Shell (automatically adapts to every phone & screen size) */}
      <div className="w-full max-w-2xl flex-1 flex flex-col bg-white dark:bg-[#0f0d1a] min-h-[100dvh] shadow-sm">
        <Header
          onOpenSearch={() => setIsSearchModalOpen(true)}
          onOpenNotifications={() => setIsNotificationsOpen(true)}
        />

        {/* Owner-Only Account Warning Bar (visible strictly to the warned account owner) */}
        {currentUser && userProfile?.warningActive && !userProfile?.accountSuspended && (
          <button
            type="button"
            onClick={() => setIsWarningModalOpen(true)}
            className="w-full px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Warning · Account kee irratti report {userProfile.reportsCount || 250}+ jira — Tuqii
              falmadhu
            </span>
          </button>
        )}

        {/* Foreground FCM Push Notification Toast */}
        {foregroundPushToast && (
          <div className="px-4 pt-3">
            <div className="rounded-2xl bg-[#7560DF] text-white px-4 py-3 shadow-lg flex items-center justify-between gap-3 animate-in fade-in">
              <button
                type="button"
                onClick={() => {
                  const pId = foregroundPushToast.postId;
                  const cId = foregroundPushToast.commentId;
                  setForegroundPushToast(null);
                  if (pId) {
                    handleNavigateToPost(pId, cId);
                  } else {
                    setIsNotificationsOpen(true);
                  }
                }}
                className="flex items-center gap-2.5 text-left flex-1 min-w-0"
              >
                <Bell className="w-4 h-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-extrabold truncate">{foregroundPushToast.title}</p>
                  <p className="text-xs opacity-95 truncate">{foregroundPushToast.body}</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setForegroundPushToast(null)}
                className="p-1 rounded-full hover:bg-white/15 shrink-0"
                aria-label="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-x-hidden bg-white dark:bg-[#0f0d1a]">
          {renderCurrentView()}
        </main>

        {!activeChat && (
          <BottomNav
            activeTab={activeTab}
            homeBadge={homeNewPostersCount}
            videoBadge={videoNewCount}
            unreadCount={unreadChatPeopleCount}
            allUsersBadge={allUsersNewFollowCount}
            onSelectTab={(tab) => {
              if (tab === 'home' && homeNewPostersCount > 0) {
                setHomeRefreshSignal((c) => c + 1);
                markHomeSeen();
              }
              if (tab === 'video') {
                if (videoNewCount > 0 || activeTab === 'video') {
                  setVideoRefreshSignal((c) => c + 1);
                }
                markVideoSeen();
              }
              setActiveTab(tab);
              if (tab !== 'profile') {
                setViewingProfileUserId(null);
              }
              setActiveChat(null);
            }}
          />
        )}
      </div>

      {/* Auth Screen Modal (login OR adding an account) */}
      <AuthModal
        isOpen={(!loading && !currentUser) || isAddingAccount}
        onClose={isAddingAccount ? closeAddAccount : undefined}
      />

      {/* Common Notifications Modal */}
      <NotificationsModal
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        onNavigateToProfile={handleViewProfile}
        onNavigateToChat={handleNavigateToChatById}
        onNavigateToPost={handleNavigateToPost}
      />

      {/* Search Modal */}
      <UserSearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        onSelectUserToChat={(recipient) => handleStartChatWithUser(recipient)}
        onViewProfile={handleViewProfile}
        onSelectPost={(postId) => {
          setFocusedPostId(postId);
          setActiveTab('home');
          setActiveChat(null);
        }}
        onOpenGroup={handleOpenGroup}
      />

      {/* Create / Join / Manage Groups Modal (opened from Settings) */}
      <CreateGroupModal
        isOpen={isCreateGroupModalOpen}
        onClose={() => setIsCreateGroupModalOpen(false)}
        onOpenGroup={(group) => {
          setIsCreateGroupModalOpen(false);
          handleOpenGroup(group);
        }}
      />

      {/* Post-Only Group View Modal (posts appear on Home) */}
      <GroupViewModal
        groupId={activeGroup?.groupId || null}
        initialGroup={activeGroup?.initialGroup}
        onClose={() => setActiveGroup(null)}
        onViewProfile={handleViewProfile}
      />

      {/* Create Team Modal */}
      <CreateTeamModal
        isOpen={isCreateTeamModalOpen}
        onClose={() => setIsCreateTeamModalOpen(false)}
        onTeamCreated={(team) => {
          setIsCreateTeamModalOpen(false);
          setActiveTab('chats');
          setActiveChat({ type: 'team', teamId: team.teamId, team });
        }}
      />

      {/* Settings Modals */}
      <SwitchAccountModal
        isOpen={isSwitchAccountOpen}
        onClose={() => setIsSwitchAccountOpen(false)}
      />

      <DashboardModal
        isOpen={isDashboardOpen}
        onClose={() => setIsDashboardOpen(false)}
      />

      <RubGPTModal
        isOpen={isRubGPTOpen}
        onClose={() => setIsRubGPTOpen(false)}
      />

      <BlockedUsersModal
        isOpen={isBlockedOpen}
        onClose={() => setIsBlockedOpen(false)}
      />

      <DevicesModal
        isOpen={isDevicesOpen}
        onClose={() => setIsDevicesOpen(false)}
      />

      <LastSeenModal
        isOpen={isLastSeenOpen}
        onClose={() => setIsLastSeenOpen(false)}
      />

      <TwoStepModal
        isOpen={isTwoStepOpen}
        onClose={() => setIsTwoStepOpen(false)}
      />

      <AppLockConfigModal
        isOpen={isAppLockOpen}
        onClose={() => setIsAppLockOpen(false)}
        onLockNow={() => {
          if (userProfile) {
            sessionStorage.removeItem(`ethio_applock_ok_${userProfile.userId}`);
          }
          setIsAppLocked(true);
        }}
      />

      <ChatWallpaperModal
        isOpen={isChatWallpaperOpen}
        onClose={() => setIsChatWallpaperOpen(false)}
      />

      <FontSizeModal
        isOpen={isFontSizeOpen}
        onClose={() => setIsFontSizeOpen(false)}
      />

      <FontStyleModal
        isOpen={isFontStyleOpen}
        onClose={() => setIsFontStyleOpen(false)}
      />

      <ChatBackupModal
        isOpen={isChatBackupOpen}
        onClose={() => setIsChatBackupOpen(false)}
      />

      {/* Active WebRTC Audio/Video Call Modal */}
      {activeCall && currentUser && (
        <CallModal
          call={activeCall}
          currentUserId={currentUser.uid}
          onClose={() => setActiveCall(null)}
        />
      )}

      {/* Two-Step Verification / App Lock / Fingerprint Security Enforcement */}
      {currentUser && userProfile && (() => {
        void twoStepSessionTick;
        const twoFaOk = sessionStorage.getItem(`ethio_2fa_ok_${currentUser.uid}`) === 'true';
        if (userProfile.twoStepEnabled && userProfile.twoStepPin && !twoFaOk) {
          return (
            <PasscodeOverlay
              mode="2fa"
              expectedPin={userProfile.twoStepPin}
              onUnlock={() => {
                sessionStorage.setItem(`ethio_2fa_ok_${currentUser.uid}`, 'true');
                setTwoStepSessionTick((c) => c + 1);
              }}
              onSignOut={() => signOut()}
            />
          );
        }
        if (
          userProfile.appLockEnabled &&
          (userProfile.appLockPin || userProfile.fingerprintLockEnabled) &&
          isAppLocked
        ) {
          return (
            <PasscodeOverlay
              mode="applock"
              expectedPin={userProfile.appLockPin}
              fingerprintEnabled={Boolean(userProfile.fingerprintLockEnabled)}
              fingerprintCredentialId={userProfile.fingerprintCredentialId}
              onUnlock={() => {
                sessionStorage.setItem(`ethio_applock_ok_${currentUser.uid}`, 'true');
                setIsAppLocked(false);
              }}
              onSignOut={() => signOut()}
            />
          );
        }
        return null;
      })()}

      {/* Owner-Only Warning Appeal Modal & Admin Moderation Inbox */}
      <WarningAppealModal
        isOpen={isWarningModalOpen}
        onClose={() => setIsWarningModalOpen(false)}
      />

      <ModerationInboxModal
        isOpen={isModerationInboxOpen && isOwner}
        onClose={() => setIsModerationInboxOpen(false)}
      />

      {/* Subscription & Gold Verified Payment Flow */}
      <SubscriptionModal
        isOpen={isSubscriptionOpen}
        onClose={() => setIsSubscriptionOpen(false)}
      />

      {/* Owner & Admin Premium Payment Management Dashboard */}
      {(isOwner || isAdmin) && (
        <AdminPaymentDashboard
          isOpen={isPaymentDashboardOpen}
          onClose={() => {
            setIsPaymentDashboardOpen(false);
            setActiveTab('settings');
          }}
        />
      )}

      {/* Account Closed / Suspended Overlay (Triggered at 2,500+ unique reports) */}
      {currentUser && userProfile?.accountSuspended && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl p-6 shadow-2xl border border-rose-200 dark:border-rose-900/60 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/15 text-rose-500 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-9 h-9" />
            </div>
            <div className="space-y-1.5">
              <h2 className="font-extrabold text-xl text-slate-900 dark:text-white">
                Account kee cufameera
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Account kee irratti namoonni adda addaa {userProfile.reportsCount || 2500}+ ol
                report waan godhaniif ofiin cufameera.
              </p>
            </div>
            <div className="space-y-2 pt-2">
              <a
                href={`mailto:${ADMIN_MODERATION_EMAIL}?subject=${encodeURIComponent(
                  `Account Suspension Appeal (@${userProfile.username})`
                )}`}
                className="w-full py-3 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-[#7560DF]/25"
              >
                <Mail className="w-4 h-4" />
                <span>Appeal to {ADMIN_MODERATION_EMAIL}</span>
              </a>
              <button
                type="button"
                onClick={() => signOut()}
                className="w-full py-3 rounded-2xl bg-slate-100 dark:bg-[#201c38] hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-bold text-sm flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <MainAppContent />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
