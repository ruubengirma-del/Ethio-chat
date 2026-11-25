import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { AppNotification } from '../../types';
import { toNotificationMillis } from '../../lib/socialHelpers';
import { isPushEnvironmentSupported, registerAndSyncPushToken } from '../../lib/pushNotifications';
import { GoldVerifiedBadge } from './GoldVerifiedBadge';
import {
  X,
  Bell,
  BellRing,
  Heart,
  MessageCircle,
  AtSign,
  UserPlus,
  Users,
  CheckCheck,
  Share2,
  Crown
} from 'lucide-react';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToProfile: (userId: string) => void;
  onNavigateToChat: (chatId: string) => void;
  onNavigateToPost: (postId: string, commentId?: string) => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  onNavigateToProfile,
  onNavigateToChat,
  onNavigateToPost,
}) => {
  const {
    currentUser,
    allUsers,
    notifications,
    unreadNotificationsCount,
    markNotificationRead,
    markAllNotificationsRead,
  } = useAuth();
  const { t } = useLanguage();
  const [canRequestPush, setCanRequestPush] = useState(false);

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    isPushEnvironmentSupported().then((supported) => {
      if (supported && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        setCanRequestPush(true);
      } else {
        setCanRequestPush(false);
      }
    });
  }, [isOpen, currentUser]);

  if (!isOpen) return null;

  const getIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'like':
        return <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />;
      case 'comment':
        return <MessageCircle className="w-4 h-4 text-[#7560DF]" />;
      case 'mention':
        return <AtSign className="w-4 h-4 text-amber-500" />;
      case 'follow':
      case 'follow_back':
        return <UserPlus className="w-4 h-4 text-emerald-500" />;
      case 'group':
        return <Users className="w-4 h-4 text-blue-500" />;
      case 'share':
        return <Share2 className="w-4 h-4 text-[#7560DF]" />;
      case 'subscription':
        return <Crown className="w-4 h-4 text-amber-500" />;
      default:
        return <Bell className="w-4 h-4 text-[#7560DF]" />;
    }
  };

  const getLabel = (n: AppNotification) => {
    switch (n.type) {
      case 'like':
        return 'liked your post';
      case 'comment':
        return 'commented on your post';
      case 'mention':
        return n.commentId ? 'mentioned you in a comment' : 'mentioned you in a post';
      case 'follow':
        return 'added / followed you';
      case 'follow_back':
        return 'followed you back';
      case 'group':
        return 'group activity';
      case 'share':
        return 'shared a post with you';
      case 'subscription':
        return 'subscription update';
      default:
        return 'sent an update';
    }
  };

  const formatTime = (createdAt: AppNotification['createdAt']) => {
    try {
      const ms = toNotificationMillis(createdAt);
      if (!ms) return '';
      const diff = Math.max(0, Math.floor((Date.now() - ms) / 1000));
      if (diff < 60) return 'Just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    } catch {
      return '';
    }
  };

  const handleEnablePush = async () => {
    if (!currentUser) return;
    await registerAndSyncPushToken(currentUser.uid, { requestPermission: true });
    if (typeof Notification !== 'undefined' && Notification.permission !== 'default') {
      setCanRequestPush(false);
    }
  };

  const handleTap = async (n: AppNotification) => {
    if (!n.read) {
      await markNotificationRead(n.notificationId);
    }
    if (n.postId) {
      onClose();
      onNavigateToPost(n.postId, n.commentId);
      return;
    }
    if ((n.type === 'group' || n.type === 'share') && n.chatId) {
      onClose();
      onNavigateToChat(n.chatId);
      return;
    }
    onClose();
    onNavigateToProfile(n.actorId || n.fromUserId || '');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200/80 dark:border-purple-950/60 flex flex-col h-[82vh] sm:h-[620px] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#7560DF]/15 text-[#7560DF] flex items-center justify-center">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                {t('notifications')}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {unreadNotificationsCount} unread
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {canRequestPush && (
              <button
                type="button"
                onClick={handleEnablePush}
                className="px-2.5 py-1.5 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300 text-xs font-bold flex items-center gap-1 hover:bg-amber-500/25"
                title="Enable Push Notifications"
              >
                <BellRing className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Push</span>
              </button>
            )}
            {unreadNotificationsCount > 0 && (
              <button
                onClick={() => markAllNotificationsRead()}
                className="px-2.5 py-1.5 rounded-xl bg-[#7560DF]/10 text-[#7560DF] dark:text-[#B09EFC] text-xs font-bold flex items-center gap-1 hover:bg-[#7560DF]/20"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>{t('markAllRead')}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 p-4 overflow-y-auto space-y-2.5">
          {notifications.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 space-y-2 p-6">
              <Bell className="w-10 h-10 opacity-30 text-[#7560DF]" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                {t('noNotifications')}
              </p>
              <p className="text-xs max-w-xs">
                Likes, comments, @mentions, friend requests, follow backs, and group updates will appear here in real time.
              </p>
            </div>
          ) : (
            notifications.map((n) => {
              const resolvedActorId = n.actorId || n.fromUserId || '';
              const matchedActor = allUsers.find((u) => u.userId === resolvedActorId);
              const actorUsername = n.fromUsername || n.actorUsername || matchedActor?.username || 'member';
              const actorDisplayName = n.actorDisplayName || matchedActor?.displayName || actorUsername;
              const actorPhoto =
                n.actorPhotoURL ||
                matchedActor?.photoURL ||
                `https://api.dicebear.com/7.x/bottts/svg?seed=${actorUsername}`;

              return (
                <button
                  key={n.notificationId}
                  onClick={() => handleTap(n)}
                  className={`w-full p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all ${
                    n.read
                      ? 'border-slate-200/70 dark:border-purple-950/40 bg-white dark:bg-[#1a1633] hover:bg-slate-50 dark:hover:bg-[#201c38]'
                      : 'border-[#7560DF]/50 bg-[#7560DF]/10 dark:bg-[#7560DF]/20 shadow-sm hover:bg-[#7560DF]/15'
                  }`}
                >
                  <div className="relative shrink-0">
                    <img
                      src={actorPhoto}
                      alt={actorDisplayName}
                      className={`w-10 h-10 rounded-full object-cover ${
                        !n.read ? 'ring-2 ring-[#7560DF]' : ''
                      }`}
                    />
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white dark:bg-[#16132b] flex items-center justify-center shadow">
                      {getIcon(n.type)}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-100 leading-snug">
                      <span className="font-bold inline-flex items-center gap-1 align-middle">
                        <span>{actorDisplayName}</span>
                        {resolvedActorId && <GoldVerifiedBadge userId={resolvedActorId} size="xs" />}
                      </span>{' '}
                      <span className="text-slate-500 dark:text-slate-400">(@{actorUsername})</span>{' '}
                      <span className={!n.read ? 'font-semibold text-slate-900 dark:text-white' : ''}>
                        {getLabel(n)}
                      </span>
                    </p>
                    {n.text && (
                      <p
                        className={`text-xs mt-1 line-clamp-2 ${
                          n.type === 'mention'
                            ? 'text-[#624ec7] dark:text-[#B09EFC] font-semibold'
                            : 'text-slate-600 dark:text-slate-300 italic'
                        }`}
                      >
                        {n.type === 'mention' ? n.text : `"${n.text}"`}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-1">{formatTime(n.createdAt)}</p>
                  </div>

                  {!n.read && (
                    <span
                      className="w-2.5 h-2.5 rounded-full bg-[#7560DF] shrink-0 mt-1.5 ring-2 ring-[#7560DF]/30"
                      title="Unread"
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

