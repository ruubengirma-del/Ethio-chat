import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  arrayUnion,
  arrayRemove,
  increment,
  onSnapshot, 
  query, 
  orderBy 
} from 'firebase/firestore';
import { 
  ChatMessage, 
  ChatParticipant, 
  ChatRoom,
  OfflineQueuedMessage 
} from '../../types';
import { 
  isOnline, 
  queueOfflineMessage, 
  subscribeToOfflineQueue, 
  syncPendingMessages 
} from '../../lib/offlineSync';
import { compressImage, processChatVideoFile } from '../../lib/mediaCompression';
import { createAppNotification, CHAT_WALLPAPERS, isUserOnlineNow, formatLastSeen, saveMediaToDevice, saveTextToDevice } from '../../lib/socialHelpers';
import { dispatchPushNotification } from '../../lib/pushNotifications';
import { AudioRecorder } from './AudioRecorder';
import { MediaLightboxModal } from '../common/MediaLightboxModal';
import { GoldVerifiedBadge } from '../common/GoldVerifiedBadge';
import { useBackHandler } from '../../lib/backNavigation';
import { 
  ArrowLeft, 
  Send, 
  Image as ImageIcon, 
  Mic, 
  Clock, 
  CheckCheck, 
  AlertCircle, 
  Play, 
  Pause, 
  WifiOff,
  UserPlus,
  Check,
  RefreshCw,
  Users,
  X,
  Plus,
  Phone,
  Video,
  Ban,
  Trash2,
  Edit3,
  Download,
  Film,
  Paperclip,
  FileText,
  ExternalLink,
  ShieldAlert,
  Lock,
  Unlock,
  Copy,
  Crown,
  Shield,
  Loader2,
  ZoomIn,
  Maximize2,
  Eye
} from 'lucide-react';

interface ChatRoomViewProps {
  chatId: string;
  recipient?: ChatParticipant;
  groupRoom?: ChatRoom;
  onBack: () => void;
  onViewProfile: (userId: string) => void;
  onStartCall: (target: ChatParticipant, callType: 'audio' | 'video', chatId: string) => void;
  onOpenSharedPost?: (postId: string) => void;
}

export const ChatRoomView: React.FC<ChatRoomViewProps> = ({
  chatId,
  recipient,
  groupRoom,
  onBack,
  onViewProfile,
  onStartCall,
  onOpenSharedPost,
}) => {
  const {
    userProfile,
    allUsers,
    followingIds,
    followerIds,
    followUser,
    unfollowUser,
    blockedIds,
    blockUser,
    unblockUser,
  } = useAuth();
  const { t } = useLanguage();
  const [liveGroupRoom, setLiveGroupRoom] = useState<ChatRoom | undefined>(groupRoom);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueuedMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [currentlyPlayingAudio, setCurrentlyPlayingAudio] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<number>(0);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [videoUploadPct, setVideoUploadPct] = useState<number | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [showGroupMembers, setShowGroupMembers] = useState(false);

  // Long-press Message Action Menu, Edit, Auto-download & Pre-send Protected Media preview
  const [selectedMessage, setSelectedMessage] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [locallyHiddenIds, setLocallyHiddenIds] = useState<Set<string>>(new Set());
  const [loadedMediaIds, setLoadedMediaIds] = useState<Set<string>>(new Set());
  const [pendingMediaDraft, setPendingMediaDraft] = useState<{
    type: 'image' | 'video';
    mediaUrl: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    preventDownload: boolean;
    expires30s: boolean;
  } | null>(null);
  const [lightboxMedia, setLightboxMedia] = useState<{
    messageId: string;
    type: 'image' | 'video';
    mediaUrl: string;
    fileName?: string;
    mimeType?: string;
    protectedMode: boolean;
    expiresAt?: string;
  } | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [inlineShieldActive, setInlineShieldActive] = useState<boolean>(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);

  useBackHandler(showGroupMembers, () => setShowGroupMembers(false));
  useBackHandler(Boolean(selectedMessage), () => setSelectedMessage(null));
  useBackHandler(Boolean(pendingMediaDraft), () => setPendingMediaDraft(null));

  const deletedExpiredIdsRef = useRef<Set<string>>(new Set());
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markedReadIdsRef = useRef<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const anyFileInputRef = useRef<HTMLInputElement>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const isGroup = Boolean(liveGroupRoom?.isGroup || groupRoom?.isGroup);
  const targetReceiverId = isGroup ? chatId : (recipient?.userId || chatId);

  const recipientFullProfile = !isGroup && recipient ? allUsers.find((u) => u.userId === recipient.userId) : undefined;
  const showRecipientOnline = isUserOnlineNow(recipientFullProfile);
  const canSeeRecipientLastSeen =
    !recipientFullProfile?.hideOnlineStatus &&
    (recipientFullProfile?.lastSeenVisibility || 'everyone') !== 'nobody';
  const recipientStatusText = showRecipientOnline
    ? t('online')
    : canSeeRecipientLastSeen && recipientFullProfile?.lastSeenAt
    ? formatLastSeen(recipientFullProfile.lastSeenAt)
    : recipient
    ? `@${recipient.username}`
    : '';

  const myReadReceiptsOn = userProfile?.readReceiptsEnabled !== false;
  const reactionsEnabled = userProfile?.messageReactionsEnabled !== false;
  const autoDownloadOn = userProfile?.autoDownloadMedia !== false;
  const fontSizeClass =
    userProfile?.chatFontSize === 'small'
      ? 'text-xs'
      : userProfile?.chatFontSize === 'large'
      ? 'text-base sm:text-lg'
      : 'text-sm';

  const wallpaperSetting = userProfile?.chatWallpaper || 'default';
  const isCustomWallpaper = wallpaperSetting.startsWith('data:image') || wallpaperSetting.startsWith('http');
  const presetWallpaperClass =
    CHAT_WALLPAPERS.find((w) => w.id === wallpaperSetting)?.className || 'bg-slate-50/40 dark:bg-[#0f0d1a]';

  const isFollowing = !isGroup && recipient ? followingIds.has(recipient.userId) : false;
  const isFollowedBy = !isGroup && recipient ? followerIds.has(recipient.userId) : false;
  const isBlocked = !isGroup && recipient ? blockedIds.has(recipient.userId) : false;

  // Listen to live group room metadata if group
  useEffect(() => {
    if (!isGroup) return;
    const unsub = onSnapshot(doc(db, 'chats', chatId), (snap) => {
      if (snap.exists()) {
        setLiveGroupRoom(snap.data() as ChatRoom);
      }
    }, (err) => {
      console.warn('Group metadata listener notice:', err);
    });
    return () => unsub();
  }, [chatId, isGroup]);

  // Subscribe to offline queue
  useEffect(() => {
    return subscribeToOfflineQueue((queue) => {
      setOfflineQueue(queue.filter((q) => q.chatId === chatId));
    });
  }, [chatId]);

  // Real-time Firestore snapshot listener for messages in this chat
  useEffect(() => {
    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: ChatMessage[] = [];
      snapshot.forEach((d) => {
        list.push(d.data() as ChatMessage);
      });
      setMessages(list);
    }, (err) => {
      console.warn('Chat messages listener offline or restricted:', err);
    });

    return () => unsubscribe();
  }, [chatId]);

  // Cleanup long-press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, offlineQueue.length]);

  // Mark incoming messages as read when chat room is open & Read Receipts are enabled
  useEffect(() => {
    if (!userProfile || !myReadReceiptsOn || messages.length === 0) return;
    const unreadIncoming = messages.filter(
      (m) =>
        m.senderId !== userProfile.userId &&
        m.status !== 'pending' &&
        !markedReadIdsRef.current.has(m.messageId) &&
        (!Array.isArray(m.readBy) || !m.readBy.includes(userProfile.userId))
    );
    if (unreadIncoming.length === 0) return;

    const now = new Date().toISOString();
    unreadIncoming.forEach((m) => {
      markedReadIdsRef.current.add(m.messageId);
      updateDoc(doc(db, 'chats', chatId, 'messages', m.messageId), {
        readBy: arrayUnion(userProfile.userId),
        readAt: now,
      }).catch(() => {
        markedReadIdsRef.current.delete(m.messageId);
      });
    });
  }, [messages, userProfile, myReadReceiptsOn, chatId]);

  // Always clear current user's unread message count while this conversation is open
  useEffect(() => {
    if (!userProfile || !chatId) return;
    updateDoc(doc(db, 'chats', chatId), {
      [`unreadCounts.${userProfile.userId}`]: 0,
    }).catch(() => {});
  }, [chatId, userProfile?.userId, messages.length]);

  // Live tick for 30sec ephemeral media countdowns
  useEffect(() => {
    const hasExpiring = messages.some((m) => Boolean(m.expiresAt));
    if (!hasExpiring) return;
    setNowTick(Date.now());
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 500);
    return () => clearInterval(interval);
  }, [messages]);

  // Auto-delete expired ephemeral messages from Firestore once timer hits 0
  useEffect(() => {
    messages.forEach((m) => {
      if (!m.expiresAt) return;
      const expMs = new Date(m.expiresAt).getTime();
      if (expMs <= nowTick && !deletedExpiredIdsRef.current.has(m.messageId)) {
        deletedExpiredIdsRef.current.add(m.messageId);
        if (lightboxMedia?.messageId === m.messageId) {
          setLightboxMedia(null);
        }
        deleteDoc(doc(db, 'chats', chatId, 'messages', m.messageId)).catch(() => {});
      }
    });
  }, [messages, nowTick, chatId, lightboxMedia]);

  // Merge live Firestore messages with pending locally-queued offline messages & filter deletedFor / expired
  const combinedMessages: ChatMessage[] = React.useMemo(() => {
    const map = new Map<string, ChatMessage>();

    messages.forEach((m) => map.set(m.messageId, m));

    offlineQueue.forEach((q) => {
      if (!map.has(q.localId)) {
        map.set(q.localId, {
          messageId: q.localId,
          chatId: q.chatId,
          senderId: q.senderId,
          senderUsername: q.senderUsername,
          senderDisplayName: q.senderDisplayName,
          senderPhotoURL: q.senderPhotoURL,
          receiverId: q.receiverId,
          type: q.type,
          text: q.text,
          mediaUrl: q.mediaUrl,
          audioDuration: q.audioDuration,
          fileName: q.fileName,
          fileSize: q.fileSize,
          mimeType: q.mimeType,
          preventDownload: q.preventDownload,
          expiresAfterSeconds: q.expiresAfterSeconds,
          sharedPostId: q.sharedPostId,
          sharedPostAuthorId: q.sharedPostAuthorId,
          sharedPostAuthorName: q.sharedPostAuthorName,
          sharedPostAuthorUsername: q.sharedPostAuthorUsername,
          sharedPostAuthorPhoto: q.sharedPostAuthorPhoto,
          sharedPostContent: q.sharedPostContent,
          sharedPostMediaUrl: q.sharedPostMediaUrl,
          sharedPostMediaType: q.sharedPostMediaType,
          status: 'pending',
          createdAt: new Date(q.timestamp).toISOString(),
          localId: q.localId
        });
      }
    });

    const myUid = userProfile?.userId;
    return Array.from(map.values())
      .filter((m) => {
        if (locallyHiddenIds.has(m.messageId)) return false;
        if (myUid && Array.isArray(m.deletedFor) && m.deletedFor.includes(myUid)) return false;
        if (m.expiresAt && new Date(m.expiresAt).getTime() <= nowTick) return false;
        return true;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [messages, offlineQueue, userProfile?.userId, locallyHiddenIds, nowTick]);

  // Inline screenshot & screen-recording deterrence while un-downloadable media from others is visible in chat
  const hasVisibleProtectedMedia = React.useMemo(
    () =>
      combinedMessages.some(
        (m) =>
          Boolean(m.preventDownload) &&
          m.senderId !== userProfile?.userId &&
          (m.type === 'image' || m.type === 'video')
      ),
    [combinedMessages, userProfile?.userId]
  );

  useEffect(() => {
    if (!hasVisibleProtectedMedia || lightboxMedia) {
      if (!hasVisibleProtectedMedia) setInlineShieldActive(false);
      return;
    }

    const triggerShield = () => {
      setInlineShieldActive(true);
      try {
        navigator.clipboard?.writeText('').catch(() => {});
      } catch {}
    };

    const handleKeyGuard = (e: KeyboardEvent) => {
      const k = (e.key || '').toLowerCase();
      const isPrintScreen = e.key === 'PrintScreen' || e.code === 'PrintScreen';
      const isMacShot = e.metaKey && e.shiftKey && ['3', '4', '5', '6', 's'].includes(k);
      const isWinSnip = (e.ctrlKey || e.metaKey) && e.shiftKey && k === 's';
      const isPrint = (e.ctrlKey || e.metaKey) && k === 'p';
      if (isPrintScreen || isMacShot || isWinSnip || isPrint) {
        e.preventDefault();
        e.stopPropagation();
        triggerShield();
      }
    };

    const handleVisibility = () => {
      if (document.hidden) triggerShield();
    };

    window.addEventListener('keydown', handleKeyGuard, true);
    window.addEventListener('keyup', handleKeyGuard, true);
    window.addEventListener('blur', triggerShield);
    window.addEventListener('beforeprint', triggerShield);
    document.addEventListener('visibilitychange', handleVisibility);

    let origGetDisplayMedia: MediaDevices['getDisplayMedia'] | null = null;
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (md && typeof md.getDisplayMedia === 'function') {
      origGetDisplayMedia = md.getDisplayMedia.bind(md);
      md.getDisplayMedia = async () => {
        triggerShield();
        throw new DOMException('Protected media cannot be screen recorded.', 'NotAllowedError');
      };
    }

    return () => {
      window.removeEventListener('keydown', handleKeyGuard, true);
      window.removeEventListener('keyup', handleKeyGuard, true);
      window.removeEventListener('blur', triggerShield);
      window.removeEventListener('beforeprint', triggerShield);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (md && origGetDisplayMedia) {
        md.getDisplayMedia = origGetDisplayMedia;
      }
    };
  }, [hasVisibleProtectedMedia, lightboxMedia]);

  // Long-press triggers ONLY when pressing and holding (~450ms)
  const startLongPress = (msg: ChatMessage) => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setSelectedMessage(msg);
    }, 450);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // Update parent chat metadata safely for either 1-on-1 or Group chat
  const updateParentChatDoc = async (lastMessageText: string, skipNotify = false) => {
    if (!userProfile) return;
    const now = new Date().toISOString();
    if (isGroup) {
      const members = liveGroupRoom?.participantIds || [];
      const unreadPatch: Record<string, any> = {};
      if (!skipNotify) {
        members
          .filter((mid) => mid !== userProfile.userId)
          .forEach((mid) => {
            unreadPatch[`unreadCounts.${mid}`] = increment(1);
          });
      }

      await updateDoc(doc(db, 'chats', chatId), {
        lastMessage: lastMessageText,
        lastMessageTime: now,
        lastSenderId: userProfile.userId,
        ...unreadPatch,
        updatedAt: now
      }).catch(() => {});

      if (!skipNotify) {
        const groupName = liveGroupRoom?.groupName || 'Group';
        await Promise.all(
          members
            .filter((mid) => mid !== userProfile.userId)
            .map(async (mid) => {
              await createAppNotification({
                recipientId: mid,
                actor: userProfile,
                type: 'group',
                chatId,
                text: `${groupName}: ${lastMessageText}`,
              });
              void dispatchPushNotification({
                type: 'message',
                toUserId: mid,
                fromUsername: userProfile.username,
                title: `${groupName} · ${userProfile.displayName}`,
                text: lastMessageText,
                chatId,
              });
            })
        );
      }
    } else if (recipient) {
      await setDoc(doc(db, 'chats', chatId), {
        chatId,
        participantIds: [userProfile.userId, recipient.userId],
        lastMessage: lastMessageText,
        lastMessageTime: now,
        lastSenderId: userProfile.userId,
        ...(skipNotify ? {} : { unreadCounts: { [recipient.userId]: increment(1) } }),
        updatedAt: now
      }, { merge: true });

      if (!skipNotify) {
        void dispatchPushNotification({
          type: 'message',
          toUserId: recipient.userId,
          fromUsername: userProfile.username,
          title: userProfile.displayName,
          text: lastMessageText,
          chatId,
        });
      }
    }
  };

  // A. Delete for me (only hidden/deleted on current user's side)
  const handleDeleteForMe = async (msg: ChatMessage) => {
    setSelectedMessage(null);
    if (!userProfile) return;
    setLocallyHiddenIds((prev) => new Set(prev).add(msg.messageId));

    if (msg.status !== 'pending') {
      await updateDoc(doc(db, 'chats', chatId, 'messages', msg.messageId), {
        deletedFor: arrayUnion(userProfile.userId)
      }).catch(() => {});
    }
  };

  // B. Delete for everyone (ONLY allowed for messages sent by currentUser)
  const handleDeleteForEveryone = async (msg: ChatMessage) => {
    setSelectedMessage(null);
    if (!userProfile || msg.senderId !== userProfile.userId) return;

    try {
      await deleteDoc(doc(db, 'chats', chatId, 'messages', msg.messageId));

      // Update chat snippet if this was the latest message
      const remaining = combinedMessages.filter((m) => m.messageId !== msg.messageId);
      const lastRemaining = remaining[remaining.length - 1];
      const nextPreview = lastRemaining
        ? lastRemaining.type === 'text'
          ? lastRemaining.text
          : lastRemaining.type === 'image'
          ? '📷 Photo'
          : lastRemaining.type === 'video'
          ? '🎬 Video'
          : lastRemaining.type === 'file'
          ? `📎 ${lastRemaining.fileName || 'File'}`
          : lastRemaining.type === 'post'
          ? '📌 Shared post'
          : '🎤 Voice message'
        : 'Message deleted';
      await updateParentChatDoc(nextPreview, true);
    } catch (err) {
      console.error('Failed to delete message for everyone:', err);
    }
  };

  // Start editing own sent text message
  const handleStartEditMessage = (msg: ChatMessage) => {
    if (!userProfile || msg.senderId !== userProfile.userId || msg.type !== 'text') return;
    setSelectedMessage(null);
    setEditingMessage(msg);
    setInputText(msg.text);
    setTimeout(() => textInputRef.current?.focus(), 60);
  };

  // Toggle emoji reaction on any message
  const handleToggleReaction = async (msg: ChatMessage, emoji: string) => {
    if (!userProfile || !reactionsEnabled || msg.status === 'pending') return;
    setSelectedMessage(null);
    const currentReactions = { ...(msg.reactions || {}) };
    const existingUids = Array.isArray(currentReactions[emoji]) ? [...currentReactions[emoji]] : [];
    const alreadyReacted = existingUids.includes(userProfile.userId);

    const updatedUids = alreadyReacted
      ? existingUids.filter((id) => id !== userProfile.userId)
      : [...existingUids, userProfile.userId];

    if (updatedUids.length === 0) {
      delete currentReactions[emoji];
    } else {
      currentReactions[emoji] = updatedUids;
    }

    await updateDoc(doc(db, 'chats', chatId, 'messages', msg.messageId), {
      reactions: currentReactions,
    }).catch((err) => console.warn('Failed to toggle reaction:', err));
  };

  // Add a user to the group (Owner & Admin ONLY)
  const handleAddMemberToGroup = async (userId: string) => {
    if (!userProfile || !isGroupAdmin) return;
    try {
      await updateDoc(doc(db, 'chats', chatId), {
        participantIds: arrayUnion(userId),
        updatedAt: new Date().toISOString()
      });
      await createAppNotification({
        recipientId: userId,
        actor: userProfile,
        type: 'group',
        chatId,
        text: `added you to ${liveGroupRoom?.groupName || 'a group'}`,
      });
    } catch (err) {
      console.error('Failed to add member to group:', err);
    }
  };

  // Owner-only Group controls: Lock/Unlock Posting, Assign/Revoke Admin, Delete Group
  const isGroupOwner = Boolean(isGroup && userProfile && liveGroupRoom?.createdBy === userProfile.userId);
  const groupAdminIds = liveGroupRoom?.adminIds || (liveGroupRoom?.createdBy ? [liveGroupRoom.createdBy] : []);
  const isGroupAdmin = Boolean(isGroup && userProfile && (isGroupOwner || groupAdminIds.includes(userProfile.userId)));
  const isGroupPostingLocked = Boolean(isGroup && liveGroupRoom?.postingLocked);
  const canPostInRoom = !isGroup || !isGroupPostingLocked || isGroupAdmin;

  const handleToggleGroupPostingLock = async () => {
    if (!isGroupOwner) return;
    await updateDoc(doc(db, 'chats', chatId), {
      postingLocked: !isGroupPostingLocked,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  };

  const handleToggleGroupMemberAdmin = async (memberId: string) => {
    if (!isGroupOwner || memberId === userProfile?.userId) return;
    const currentlyAdmin = groupAdminIds.includes(memberId);
    await updateDoc(doc(db, 'chats', chatId), {
      adminIds: currentlyAdmin ? arrayRemove(memberId) : arrayUnion(memberId),
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  };

  const handleDeleteGroup = async () => {
    if (!isGroupOwner || deletingGroup) return;
    setDeletingGroup(true);
    try {
      await deleteDoc(doc(db, 'chats', chatId));
      onBack();
    } catch (err) {
      console.error('Failed to delete group:', err);
      setDeletingGroup(false);
    }
  };

  // Send or Save Edited Message (Text)
  const handleSendTextMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !userProfile || isBlocked || !canPostInRoom) return;

    const text = inputText.trim();

    // If editing an existing own sent message
    if (editingMessage) {
      const targetMsg = editingMessage;
      setEditingMessage(null);
      setInputText('');
      try {
        const editedAt = new Date().toISOString();
        await updateDoc(doc(db, 'chats', chatId, 'messages', targetMsg.messageId), {
          text,
          editedAt
        });
        const latestMsg = combinedMessages[combinedMessages.length - 1];
        if (latestMsg?.messageId === targetMsg.messageId) {
          await updateParentChatDoc(text, true);
        }
      } catch (err) {
        console.error('Failed to edit message:', err);
      }
      return;
    }

    setInputText('');
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (!isOnline()) {
      queueOfflineMessage({
        localId: messageId,
        chatId,
        senderId: userProfile.userId,
        senderUsername: userProfile.username,
        senderDisplayName: userProfile.displayName,
        senderPhotoURL: userProfile.photoURL,
        receiverId: targetReceiverId,
        type: 'text',
        text
      });
      return;
    }

    try {
      const msgData: ChatMessage = {
        messageId,
        chatId,
        senderId: userProfile.userId,
        senderUsername: userProfile.username,
        senderDisplayName: userProfile.displayName,
        senderPhotoURL: userProfile.photoURL,
        receiverId: targetReceiverId,
        type: 'text',
        text,
        status: 'sent',
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'chats', chatId, 'messages', messageId), msgData);
      await updateParentChatDoc(text);
    } catch (error) {
      console.warn('Network send failed, queuing offline:', error);
      queueOfflineMessage({
        localId: messageId,
        chatId,
        senderId: userProfile.userId,
        senderUsername: userProfile.username,
        senderDisplayName: userProfile.displayName,
        senderPhotoURL: userProfile.photoURL,
        receiverId: targetReceiverId,
        type: 'text',
        text
      });
    }
  };

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    });
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };

  const triggerSaveToast = (msg: string) => {
    setSaveToast(msg);
    setTimeout(() => setSaveToast(null), 2200);
  };

  const handleSaveChatMessageAsset = async (msg: ChatMessage) => {
    const isMine = msg.senderId === userProfile?.userId;
    if (msg.preventDownload && !isMine && (msg.type === 'image' || msg.type === 'video')) {
      return;
    }
    if (msg.type === 'text') {
      saveTextToDevice(msg.text, `ethio_chat_${msg.messageId}.txt`);
      triggerSaveToast(t('saveTextFile'));
      return;
    }
    if (!msg.mediaUrl) return;
    const ext =
      msg.type === 'image'
        ? 'jpg'
        : msg.type === 'video'
        ? 'mp4'
        : msg.type === 'audio'
        ? 'webm'
        : 'bin';
    const filename = msg.fileName || `ethio_chat_${msg.type}_${msg.messageId}.${ext}`;
    await saveMediaToDevice(msg.mediaUrl, filename, msg.mimeType);
    triggerSaveToast(t('saveToGallery'));
  };

  const handleTogglePreventDownloadOnSent = async (msg: ChatMessage) => {
    if (!userProfile || msg.senderId !== userProfile.userId) return;
    if (msg.type !== 'image' && msg.type !== 'video') return;
    const nextVal = !Boolean(msg.preventDownload);
    setSelectedMessage(null);
    await updateDoc(doc(db, 'chats', chatId, 'messages', msg.messageId), {
      preventDownload: nextVal,
    }).catch(() => {});
  };

  // Send Image attachment (opens pre-send preview so sender can choose Prevent Download or allow Gallery save)
  const handleSelectImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !userProfile || isBlocked) return;

    setMediaError(null);
    setIsUploadingMedia(true);
    try {
      const res = await compressImage(file, 900, 900, 0.75);
      setPendingMediaDraft({
        type: 'image',
        mediaUrl: res.dataUrl,
        fileName: file.name,
        fileSize: res.sizeBytes,
        mimeType: 'image/jpeg',
        preventDownload: false,
        expires30s: false,
      });
    } catch (err: any) {
      setMediaError(err?.message || 'Image upload failed.');
    } finally {
      setIsUploadingMedia(false);
    }
  };

  // Send Video attachment up to 50 MB (opens pre-send preview so sender can choose Prevent Download or allow Gallery save)
  const handleSelectVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !userProfile || isBlocked) return;

    setMediaError(null);
    if (file.size > 50 * 1024 * 1024) {
      setMediaError('Video must be 50 MB or smaller for chat.');
      return;
    }

    if (!isOnline() && file.size > 650 * 1024) {
      setMediaError('Offline mode supports videos under 650 KB. Connect to send videos up to 50 MB.');
      return;
    }

    setIsUploadingMedia(true);
    setVideoUploadPct(!isOnline() ? null : 0);
    try {
      let mediaUrl: string;
      let fileSize = file.size;
      let mimeType = file.type || 'video/mp4';

      if (!isOnline()) {
        mediaUrl = await readFileAsDataUrl(file);
      } else {
        const uploaded = await processChatVideoFile(file, (pct) => setVideoUploadPct(pct));
        mediaUrl = uploaded.url;
        fileSize = uploaded.sizeBytes;
        mimeType = uploaded.mimeType;
      }

      setPendingMediaDraft({
        type: 'video',
        mediaUrl,
        fileName: file.name,
        fileSize,
        mimeType,
        preventDownload: false,
        expires30s: false,
      });
    } catch (err: any) {
      setMediaError(err?.message || 'Video upload failed.');
    } finally {
      setIsUploadingMedia(false);
      setVideoUploadPct(null);
    }
  };

  const handleConfirmSendPendingMedia = async () => {
    if (!pendingMediaDraft || !userProfile || isBlocked) return;
    const draft = pendingMediaDraft;
    setPendingMediaDraft(null);
    setIsUploadingMedia(true);
    setMediaError(null);

    try {
      const isImg = draft.type === 'image';
      const messageId = `${isImg ? 'msg_img' : 'msg_vid'}_${Date.now()}`;
      const expiresAt = draft.expires30s
        ? new Date(Date.now() + 30000).toISOString()
        : undefined;

      if (!isOnline()) {
        queueOfflineMessage({
          localId: messageId,
          chatId,
          senderId: userProfile.userId,
          senderUsername: userProfile.username,
          senderDisplayName: userProfile.displayName,
          senderPhotoURL: userProfile.photoURL,
          receiverId: targetReceiverId,
          type: draft.type,
          text: isImg ? 'Photo' : draft.fileName || 'Video',
          mediaUrl: draft.mediaUrl,
          ...(draft.fileName ? { fileName: draft.fileName } : {}),
          ...(draft.fileSize !== undefined ? { fileSize: draft.fileSize } : {}),
          ...(draft.mimeType ? { mimeType: draft.mimeType } : {}),
          preventDownload: draft.preventDownload,
          ...(draft.expires30s ? { expiresAfterSeconds: 30 } : {}),
        });
      } else {
        const msgData: ChatMessage = {
          messageId,
          chatId,
          senderId: userProfile.userId,
          senderUsername: userProfile.username,
          senderDisplayName: userProfile.displayName,
          senderPhotoURL: userProfile.photoURL,
          receiverId: targetReceiverId,
          type: draft.type,
          text: isImg ? 'Photo' : draft.fileName || 'Video',
          mediaUrl: draft.mediaUrl,
          ...(draft.fileName ? { fileName: draft.fileName } : {}),
          ...(draft.fileSize !== undefined ? { fileSize: draft.fileSize } : {}),
          ...(draft.mimeType ? { mimeType: draft.mimeType } : {}),
          preventDownload: draft.preventDownload,
          ...(draft.expires30s && expiresAt ? { expiresAfterSeconds: 30, expiresAt } : {}),
          status: 'sent',
          createdAt: new Date().toISOString(),
        };
        await setDoc(doc(db, 'chats', chatId, 'messages', messageId), msgData);
        await updateParentChatDoc(isImg ? '📷 Photo' : '🎬 Video');
      }
    } catch (err: any) {
      setMediaError(err?.message || 'Media send failed.');
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const openMsgInLightbox = (msg: ChatMessage) => {
    if (!msg.mediaUrl || (msg.type !== 'image' && msg.type !== 'video')) return;
    const isMine = msg.senderId === userProfile?.userId;
    setLightboxMedia({
      messageId: msg.messageId,
      type: msg.type,
      mediaUrl: msg.mediaUrl,
      fileName: msg.fileName,
      mimeType: msg.mimeType,
      protectedMode: Boolean(msg.preventDownload && !isMine),
      expiresAt: msg.expiresAt,
    });
  };

  // Send Other File attachment (PDF, Docs, Audio, ZIP, etc.)
  const handleSelectAnyFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !userProfile || isBlocked) return;

    setMediaError(null);
    if (file.size > 700 * 1024) {
      setMediaError('File must be under 700 KB for instant chat delivery.');
      return;
    }

    setIsUploadingMedia(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl.length > 940000) {
        setMediaError('Encoded file exceeds 700 KB chat limit.');
        return;
      }

      const messageId = `msg_file_${Date.now()}`;
      if (!isOnline()) {
        queueOfflineMessage({
          localId: messageId,
          chatId,
          senderId: userProfile.userId,
          senderUsername: userProfile.username,
          senderDisplayName: userProfile.displayName,
          senderPhotoURL: userProfile.photoURL,
          receiverId: targetReceiverId,
          type: 'file',
          text: file.name || 'Attachment',
          mediaUrl: dataUrl,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/octet-stream',
        });
      } else {
        const msgData: ChatMessage = {
          messageId,
          chatId,
          senderId: userProfile.userId,
          senderUsername: userProfile.username,
          senderDisplayName: userProfile.displayName,
          senderPhotoURL: userProfile.photoURL,
          receiverId: targetReceiverId,
          type: 'file',
          text: file.name || 'Attachment',
          mediaUrl: dataUrl,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/octet-stream',
          status: 'sent',
          createdAt: new Date().toISOString()
        };
        await setDoc(doc(db, 'chats', chatId, 'messages', messageId), msgData);
        await updateParentChatDoc(`📎 ${file.name || 'File'}`);
      }
    } catch (err: any) {
      setMediaError(err?.message || 'File upload failed.');
    } finally {
      setIsUploadingMedia(false);
    }
  };

  // Send Voice Note
  const handleSendVoiceNote = async (audioDataUrl: string, durationSeconds: number) => {
    if (!userProfile || isBlocked) return;
    setIsRecordingAudio(false);
    const messageId = `msg_voice_${Date.now()}`;

    if (!isOnline()) {
      queueOfflineMessage({
        localId: messageId,
        chatId,
        senderId: userProfile.userId,
        senderUsername: userProfile.username,
        senderDisplayName: userProfile.displayName,
        senderPhotoURL: userProfile.photoURL,
        receiverId: targetReceiverId,
        type: 'audio',
        text: 'Voice note',
        mediaUrl: audioDataUrl,
        audioDuration: durationSeconds
      });
    } else {
      try {
        const msgData: ChatMessage = {
          messageId,
          chatId,
          senderId: userProfile.userId,
          senderUsername: userProfile.username,
          senderDisplayName: userProfile.displayName,
          senderPhotoURL: userProfile.photoURL,
          receiverId: targetReceiverId,
          type: 'audio',
          text: 'Voice note',
          mediaUrl: audioDataUrl,
          audioDuration: durationSeconds,
          status: 'sent',
          createdAt: new Date().toISOString()
        };
        await setDoc(doc(db, 'chats', chatId, 'messages', messageId), msgData);
        await updateParentChatDoc('🎤 Voice message');
      } catch (err) {
        queueOfflineMessage({
          localId: messageId,
          chatId,
          senderId: userProfile.userId,
          senderUsername: userProfile.username,
          senderDisplayName: userProfile.displayName,
          senderPhotoURL: userProfile.photoURL,
          receiverId: targetReceiverId,
          type: 'audio',
          text: 'Voice note',
          mediaUrl: audioDataUrl,
          audioDuration: durationSeconds
        });
      }
    }
  };

  // Play audio voice note
  const togglePlayAudio = (messageId: string, url?: string) => {
    if (!url) return;

    if (currentlyPlayingAudio === messageId) {
      audioElementRef.current?.pause();
      setCurrentlyPlayingAudio(null);
      return;
    }

    if (audioElementRef.current) {
      audioElementRef.current.pause();
    }

    const audio = new Audio(url);
    audioElementRef.current = audio;
    setCurrentlyPlayingAudio(messageId);
    setAudioProgress(0);

    audio.ontimeupdate = () => {
      if (audio.duration) {
        setAudioProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    audio.onended = () => {
      setCurrentlyPlayingAudio(null);
      setAudioProgress(0);
    };

    audio.play().catch(console.error);
  };

  const formatMsgTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const groupParticipantIds = liveGroupRoom?.participantIds || [];
  const groupMemberProfiles = groupParticipantIds.map((pid) => {
    const found = allUsers.find((u) => u.userId === pid);
    if (found) return found;
    const p = liveGroupRoom?.participants?.[pid];
    return {
      userId: pid,
      username: p?.username || 'member',
      displayName: p?.displayName || 'Ethio Member',
      photoURL: p?.photoURL
    };
  });
  const usersNotInGroup = allUsers.filter((u) => !groupParticipantIds.includes(u.userId));

  const isSelectedMessageMine = selectedMessage?.senderId === userProfile?.userId;

  return (
    <div className="flex flex-col h-[calc(100dvh-56px)] sm:h-[calc(100dvh-64px)] max-w-2xl mx-auto bg-white dark:bg-[#0f0d1a] border-x border-slate-200/80 dark:border-purple-950/40 relative">
      {/* Chat Room Top Bar */}
      <div className="px-3 sm:px-4 py-3 bg-white dark:bg-[#16132b] border-b border-slate-200/80 dark:border-purple-950/40 flex items-center justify-between gap-2 shadow-sm z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onBack}
            className="p-1.5 -ml-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {isGroup ? (
            <div
              onClick={() => setShowGroupMembers(!showGroupMembers)}
              className="flex items-center gap-2.5 cursor-pointer group min-w-0"
            >
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] text-white flex items-center justify-center shrink-0 shadow-sm">
                <Users className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors leading-tight truncate">
                  {liveGroupRoom?.groupName || 'Group Chat'}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {groupParticipantIds.length} member(s)
                </p>
              </div>
            </div>
          ) : recipient ? (
            <div
              onClick={() => onViewProfile(recipient.userId)}
              className="flex items-center gap-2.5 cursor-pointer group min-w-0"
            >
              <div className="relative shrink-0">
                <img
                  src={recipient.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${recipient.username}`}
                  alt={recipient.displayName}
                  className="w-10 h-10 rounded-full object-cover ring-2 ring-slate-100 dark:ring-purple-900/40 group-hover:ring-[#7560DF]"
                />
                {showRecipientOnline && (
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white dark:border-[#16132b]" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1 min-w-0">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors leading-tight truncate">
                    {recipient.displayName}
                  </h3>
                  <GoldVerifiedBadge userId={recipient.userId} size="xs" />
                </div>
                <p className={`text-[11px] truncate ${showRecipientOnline ? 'text-emerald-500 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
                  {recipientStatusText}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right Controls: Calls + Block + Follow / Members */}
        {isGroup ? (
          <button
            onClick={() => setShowGroupMembers(!showGroupMembers)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#7560DF]/10 dark:bg-[#7560DF]/25 text-[#7560DF] dark:text-[#B09EFC] hover:bg-[#7560DF]/20 shrink-0"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Members</span>
          </button>
        ) : recipient ? (
          <div className="flex items-center gap-1 shrink-0">
            {!isBlocked && (
              <button
                onClick={() => onStartCall(recipient, 'audio', chatId)}
                className="p-2 rounded-full text-[#7560DF] hover:bg-[#7560DF]/10 transition-colors"
                title={t('audioCall')}
              >
                <Phone className="w-4.5 h-4.5" />
              </button>
            )}

            {!isBlocked && (
              <button
                onClick={() => onStartCall(recipient, 'video', chatId)}
                className="p-2 rounded-full text-[#7560DF] hover:bg-[#7560DF]/10 transition-colors"
                title={t('videoCall')}
              >
                <Video className="w-4.5 h-4.5" />
              </button>
            )}

            <button
              onClick={() =>
                isBlocked
                  ? unblockUser(recipient.userId)
                  : blockUser({
                      userId: recipient.userId,
                      username: recipient.username,
                      displayName: recipient.displayName,
                      photoURL: recipient.photoURL,
                    })
              }
              className={`p-2 rounded-full transition-colors ${
                isBlocked
                  ? 'bg-rose-500/15 text-rose-500'
                  : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30'
              }`}
              title={isBlocked ? t('unblockUser') : t('blockUser')}
            >
              <Ban className="w-4 h-4" />
            </button>

            {isFollowing ? (
              <button
                onClick={() => unfollowUser(recipient.userId)}
                className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-purple-950/40 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{t('following')}</span>
              </button>
            ) : isFollowedBy ? (
              <button
                onClick={() => followUser(recipient.userId)}
                className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-bold bg-[#7560DF] hover:bg-[#624ec7] text-white"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{t('followBack')}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Expandable Group Members, Admin Roles & Owner Controls Drawer */}
      {isGroup && showGroupMembers && (
        <div className="bg-white dark:bg-[#1a1633] border-b border-slate-200/80 dark:border-purple-950/50 p-4 space-y-3 max-h-96 overflow-y-auto shadow-md z-10">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Group Members ({groupMemberProfiles.length}) · Public
            </h4>
            <button
              onClick={() => setShowGroupMembers(false)}
              className="p-1 rounded-full text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {liveGroupRoom?.groupDescription && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {liveGroupRoom.groupDescription}
            </p>
          )}

          {/* Owner Controls: Lock/Unlock Posting & Delete Group */}
          {isGroupOwner && (
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-[#241f42] border border-slate-200/80 dark:border-purple-900/50 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleGroupPostingLock}
                  className={`flex-1 min-w-[160px] px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                    isGroupPostingLocked
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                      : 'bg-amber-500 hover:bg-amber-600 text-white'
                  }`}
                >
                  {isGroupPostingLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  <span>{isGroupPostingLocked ? t('unlockPosting') : t('lockPosting')}</span>
                </button>

                {!confirmDeleteGroup ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteGroup(true)}
                    className="px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t('deleteGroup')}</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={deletingGroup}
                      onClick={handleDeleteGroup}
                      className="px-3 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold"
                    >
                      {t('yesBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteGroup(false)}
                      className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold"
                    >
                      {t('noBtn')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Members List with Owner / Admin Badges & Role Assignment */}
          <div className="space-y-1.5">
            {groupMemberProfiles.map((m) => {
              const memberIsOwner = m.userId === liveGroupRoom?.createdBy;
              const memberIsAdmin = !memberIsOwner && groupAdminIds.includes(m.userId);
              return (
                <div
                  key={m.userId}
                  className="flex items-center justify-between gap-2 p-2 rounded-2xl bg-slate-50 dark:bg-[#241f42]"
                >
                  <button
                    type="button"
                    onClick={() => onViewProfile(m.userId)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                  >
                    <img
                      src={m.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${m.username}`}
                      alt={m.displayName}
                      className="w-7 h-7 rounded-full object-cover shrink-0"
                    />
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                      {m.displayName}
                    </span>
                    <GoldVerifiedBadge userId={m.userId} size="xs" />
                    {memberIsOwner && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-300 text-[10px] font-extrabold shrink-0">
                        <Crown className="w-2.5 h-2.5" />
                        <span>{t('ownerBadge')}</span>
                      </span>
                    )}
                    {memberIsAdmin && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] text-[10px] font-extrabold shrink-0">
                        <Shield className="w-2.5 h-2.5" />
                        <span>{t('adminBadge')}</span>
                      </span>
                    )}
                  </button>

                  {isGroupOwner && !memberIsOwner && (
                    <button
                      type="button"
                      onClick={() => handleToggleGroupMemberAdmin(m.userId)}
                      className={`px-2.5 py-1 rounded-xl text-[11px] font-bold shrink-0 transition-colors ${
                        memberIsAdmin
                          ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-rose-500/20 hover:text-rose-500'
                          : 'bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] hover:bg-[#7560DF]/25'
                      }`}
                    >
                      {memberIsAdmin ? t('removeAdmin') : t('makeAdmin')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {isGroupAdmin && usersNotInGroup.length > 0 && (
            <div className="pt-2 border-t border-slate-100 dark:border-purple-950/40 space-y-2">
              <p className="text-[11px] font-bold text-[#7560DF] dark:text-[#A798F8]">
                Add more people to this group:
              </p>
              <div className="flex flex-wrap gap-2">
                {usersNotInGroup.slice(0, 8).map((u) => (
                  <button
                    key={u.userId}
                    onClick={() => handleAddMemberToGroup(u.userId)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#7560DF]/30 bg-[#7560DF]/10 text-[#7560DF] dark:text-[#B09EFC] text-xs font-semibold hover:bg-[#7560DF]/20"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{u.displayName}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Offline Status Alert Banner */}
      {(!isOnline() || offlineQueue.length > 0) && (
        <div className="px-4 py-2 bg-amber-500/10 dark:bg-amber-500/20 border-b border-amber-500/30 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              {!isOnline()
                ? "Offline mode active: Text messages will save locally and auto-sync when online."
                : `${offlineQueue.length} message(s) syncing...`}
            </span>
          </div>
          {isOnline() && (
            <button
              onClick={() => syncPendingMessages()}
              className="px-2 py-0.5 rounded font-bold bg-amber-600 text-white hover:bg-amber-700 flex items-center gap-1 text-[11px]"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Sync Now</span>
            </button>
          )}
        </div>
      )}

      {/* Messages Scroll Area (supports preset & custom Chat Wallpapers) */}
      <div
        className={`flex-1 p-4 overflow-y-auto space-y-3 ${isCustomWallpaper ? '' : presetWallpaperClass}`}
        style={
          isCustomWallpaper
            ? {
                backgroundImage: `linear-gradient(rgba(15, 13, 26, 0.25), rgba(15, 13, 26, 0.25)), url(${wallpaperSetting})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : undefined
        }
      >
        {combinedMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <div className="w-16 h-16 rounded-full bg-[#7560DF]/10 text-[#7560DF] flex items-center justify-center mb-3">
              {isGroup ? <Users className="w-7 h-7" /> : <Send className="w-7 h-7" />}
            </div>
            <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200">
              {isGroup ? `Welcome to ${liveGroupRoom?.groupName || 'Group Chat'}` : 'Start a 1-on-1 Conversation'}
            </h4>
            <p className="text-xs max-w-xs mt-1">
              {isGroup
                ? 'Send a text, photo, or voice note to everyone in this group!'
                : `Send a greeting, photo, voice note, or start an Audio/Video call with ${recipient?.displayName || 'your friend'}.`}
            </p>
          </div>
        ) : (
          combinedMessages.map((msg) => {
            const isMine = msg.senderId === userProfile?.userId;
            const isPending = msg.status === 'pending';
            const senderLabel = msg.senderDisplayName || `@${msg.senderUsername}`;
            const recipientCanShowRead = isGroup || recipientFullProfile?.readReceiptsEnabled !== false;
            const isReadByOther =
              isMine &&
              myReadReceiptsOn &&
              recipientCanShowRead &&
              Array.isArray(msg.readBy) &&
              msg.readBy.some((uid) => uid !== userProfile?.userId);
            const reactionEntries = Object.entries(msg.reactions || {}).filter(
              ([, uids]) => Array.isArray(uids) && uids.length > 0
            );
            const shouldGateImage =
              !isMine &&
              msg.type === 'image' &&
              Boolean(msg.mediaUrl) &&
              !autoDownloadOn &&
              !loadedMediaIds.has(msg.messageId);
            const shouldGateVideo =
              !isMine &&
              msg.type === 'video' &&
              Boolean(msg.mediaUrl) &&
              !autoDownloadOn &&
              !loadedMediaIds.has(msg.messageId);

            return (
              <div
                key={msg.messageId}
                className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
              >
                {isGroup && !isMine && (
                  <button
                    onClick={() => onViewProfile(msg.senderId)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#7560DF] dark:text-[#A798F8] mb-0.5 ml-1 hover:underline"
                  >
                    <span>{senderLabel}</span>
                    <GoldVerifiedBadge userId={msg.senderId} size="xs" />
                  </button>
                )}

                <div
                  onPointerDown={() => startLongPress(msg)}
                  onPointerUp={cancelLongPress}
                  onPointerMove={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSelectedMessage(msg);
                  }}
                  className={`select-none max-w-[78%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 ${fontSizeClass} shadow-sm cursor-pointer active:scale-[0.99] transition-transform ${
                    isMine
                      ? 'bg-[#7560DF] text-white rounded-br-sm'
                      : 'bg-white dark:bg-[#1f1b38] text-slate-900 dark:text-slate-100 border border-slate-200/80 dark:border-purple-950/40 rounded-bl-sm'
                  }`}
                >
                  {msg.type === 'text' && (
                    <div className="space-y-1">
                      <p className="leading-relaxed whitespace-pre-wrap break-words">
                        {msg.text}
                      </p>
                    </div>
                  )}

                  {msg.type === 'image' && msg.mediaUrl && (
                    shouldGateImage ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLoadedMediaIds((prev) => new Set(prev).add(msg.messageId));
                        }}
                        className="my-1 px-4 py-3 rounded-xl bg-slate-100 dark:bg-[#2a244b] border border-dashed border-[#7560DF]/40 flex items-center gap-2 text-xs font-bold text-[#7560DF] dark:text-[#B09EFC] hover:bg-[#7560DF]/10 transition-colors"
                      >
                        <Download className="w-4 h-4 shrink-0" />
                        <span>Tap to load photo</span>
                      </button>
                    ) : (() => {
                      const lockedForViewer = Boolean(msg.preventDownload && !isMine);
                      const remainingSec = msg.expiresAt
                        ? Math.max(1, Math.ceil((new Date(msg.expiresAt).getTime() - nowTick) / 1000))
                        : null;
                      return (
                        <div
                          className={`relative rounded-xl overflow-hidden my-1 bg-black/10 ${
                            lockedForViewer ? 'protected-media-guard no-touch-callout' : ''
                          }`}
                          onContextMenu={(e) => {
                            if (lockedForViewer) e.preventDefault();
                          }}
                        >
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              if (lockedForViewer && inlineShieldActive) return;
                              openMsgInLightbox(msg);
                            }}
                            className="relative cursor-zoom-in group"
                          >
                            <img
                              src={msg.mediaUrl}
                              alt="Shared in chat"
                              draggable={!lockedForViewer}
                              className="max-h-60 w-full object-cover rounded-xl select-none"
                            />
                            {lockedForViewer && !inlineShieldActive && (
                              <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-25 rotate-[-18deg] select-none overflow-hidden">
                                <span className="text-[10px] font-black tracking-widest uppercase text-white drop-shadow">
                                  @{userProfile?.username || 'protected'}
                                </span>
                              </div>
                            )}
                            {lockedForViewer && inlineShieldActive && (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setInlineShieldActive(false);
                                }}
                                className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center p-3 text-center gap-1.5 rounded-xl"
                              >
                                <ShieldAlert className="w-6 h-6 text-amber-400" />
                                <p className="text-[10px] font-bold text-white leading-tight">
                                  {t('protectedShieldTitle')}
                                </p>
                                <span className="px-2.5 py-1 rounded-full bg-[#7560DF] text-white text-[10px] font-bold inline-flex items-center gap-1">
                                  <Eye className="w-3 h-3" /> {t('resumeViewingBtn')}
                                </span>
                              </div>
                            )}
                            <span className="absolute top-2 right-2 p-1.5 rounded-full bg-black/55 text-white opacity-90 group-hover:scale-110 transition-transform">
                              <ZoomIn className="w-3.5 h-3.5" />
                            </span>
                            {remainingSec !== null && (
                              <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-rose-600/95 text-white text-[10px] font-black flex items-center gap-1 shadow">
                                <Clock className="w-3 h-3" />
                                <span>{remainingSec}s</span>
                              </span>
                            )}
                          </div>
                          {lockedForViewer ? (
                            <div className="mt-1 px-2 py-1 rounded-lg bg-slate-900/75 text-amber-200 text-[10px] font-bold flex items-center gap-1 w-fit">
                              <Lock className="w-3 h-3 shrink-0" />
                              <span>{t('mediaProtected')}</span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2 pt-1.5">
                              {msg.preventDownload && isMine && (
                                <span className="text-[10px] font-bold text-amber-200 flex items-center gap-1">
                                  <Lock className="w-3 h-3" /> Protected for receiver
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSaveChatMessageAsset(msg);
                                }}
                                className={`ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                                  isMine
                                    ? 'bg-white/20 hover:bg-white/30 text-white'
                                    : 'bg-[#7560DF]/15 hover:bg-[#7560DF]/25 text-[#7560DF] dark:text-[#B09EFC]'
                                }`}
                              >
                                <Download className="w-3 h-3" />
                                <span>{t('saveToGallery')}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  )}

                  {msg.type === 'video' && msg.mediaUrl && (
                    shouldGateVideo ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLoadedMediaIds((prev) => new Set(prev).add(msg.messageId));
                        }}
                        className="my-1 px-4 py-3 rounded-xl bg-slate-100 dark:bg-[#2a244b] border border-dashed border-[#7560DF]/40 flex items-center gap-2 text-xs font-bold text-[#7560DF] dark:text-[#B09EFC] hover:bg-[#7560DF]/10 transition-colors"
                      >
                        <Download className="w-4 h-4 shrink-0" />
                        <span>Tap to load video</span>
                      </button>
                    ) : (() => {
                      const lockedForViewer = Boolean(msg.preventDownload && !isMine);
                      const remainingSec = msg.expiresAt
                        ? Math.max(1, Math.ceil((new Date(msg.expiresAt).getTime() - nowTick) / 1000))
                        : null;
                      return (
                        <div
                          className={`space-y-1.5 my-1 ${
                            lockedForViewer ? 'protected-media-guard no-touch-callout' : ''
                          }`}
                          onClick={(e) => e.stopPropagation()}
                          onContextMenu={(e) => {
                            if (lockedForViewer) e.preventDefault();
                          }}
                        >
                          <div className="relative rounded-xl overflow-hidden bg-black">
                            <video
                              src={msg.mediaUrl}
                              controls={!lockedForViewer || !inlineShieldActive}
                              playsInline
                              preload="metadata"
                              controlsList={lockedForViewer ? 'nodownload noremoteplayback' : undefined}
                              disablePictureInPicture={lockedForViewer}
                              className="max-h-64 w-full rounded-xl bg-black"
                            />
                            {lockedForViewer && !inlineShieldActive && (
                              <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-20 rotate-[-18deg] select-none overflow-hidden">
                                <span className="text-[10px] font-black tracking-widest uppercase text-white drop-shadow">
                                  @{userProfile?.username || 'protected'}
                                </span>
                              </div>
                            )}
                            {lockedForViewer && inlineShieldActive && (
                              <div
                                onClick={() => setInlineShieldActive(false)}
                                className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center p-3 text-center gap-1.5 rounded-xl cursor-pointer"
                              >
                                <ShieldAlert className="w-6 h-6 text-amber-400" />
                                <p className="text-[10px] font-bold text-white leading-tight">
                                  {t('protectedShieldTitle')}
                                </p>
                                <span className="px-2.5 py-1 rounded-full bg-[#7560DF] text-white text-[10px] font-bold inline-flex items-center gap-1">
                                  <Eye className="w-3 h-3" /> {t('resumeViewingBtn')}
                                </span>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => openMsgInLightbox(msg)}
                              className="absolute top-2 right-2 p-1.5 rounded-full bg-black/65 hover:bg-black/85 text-white shadow transition-colors"
                              title="Open Fullscreen"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                            {remainingSec !== null && (
                              <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-rose-600/95 text-white text-[10px] font-black flex items-center gap-1 shadow">
                                <Clock className="w-3 h-3" />
                                <span>{remainingSec}s</span>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] opacity-90">
                            <button
                              type="button"
                              onClick={() => openMsgInLightbox(msg)}
                              className="truncate font-semibold hover:underline text-left"
                            >
                              {msg.fileName || 'Video'} {msg.fileSize ? `(${formatBytes(msg.fileSize)})` : ''}
                            </button>
                            {lockedForViewer ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900/75 text-amber-200 text-[10px] font-bold shrink-0">
                                <Lock className="w-3 h-3" />
                                <span>{t('mediaProtected')}</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSaveChatMessageAsset(msg)}
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold shrink-0 ${
                                  isMine ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-[#7560DF]/15 hover:bg-[#7560DF]/25 text-[#7560DF] dark:text-[#B09EFC]'
                                }`}
                              >
                                <Download className="w-3 h-3" />
                                <span>{t('saveToGallery')}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  )}

                  {msg.type === 'file' && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className={`my-1 p-2.5 rounded-xl flex items-center gap-3 min-w-[210px] ${
                        isMine
                          ? 'bg-white/15 border border-white/20'
                          : 'bg-slate-100 dark:bg-[#2a244b] border border-slate-200 dark:border-purple-900/40'
                      }`}
                    >
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isMine ? 'bg-white/20 text-white' : 'bg-[#7560DF]/15 text-[#7560DF]'
                        }`}
                      >
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold truncate">
                          {msg.fileName || msg.text || 'Attachment'}
                        </p>
                        <p className={`text-[10px] ${isMine ? 'text-white/75' : 'text-slate-500 dark:text-slate-400'}`}>
                          {formatBytes(msg.fileSize) || msg.mimeType || 'File'}
                        </p>
                      </div>
                      {msg.mediaUrl && (
                        <a
                          href={msg.mediaUrl}
                          download={msg.fileName || `ethio_chat_file_${msg.messageId}`}
                          className={`p-2 rounded-xl transition-colors shrink-0 ${
                            isMine
                              ? 'bg-white/20 hover:bg-white/30 text-white'
                              : 'bg-[#7560DF] hover:bg-[#624ec7] text-white'
                          }`}
                          title={t('downloadImage')}
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  )}

                  {msg.type === 'post' && (
                    <div className="space-y-2 my-0.5">
                      {msg.text && msg.text !== (msg.sharedPostContent || '').slice(0, 120) && (
                        <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (msg.sharedPostId && onOpenSharedPost) {
                            onOpenSharedPost(msg.sharedPostId);
                          }
                        }}
                        className={`w-full text-left rounded-xl p-2.5 border transition-colors space-y-1.5 ${
                          isMine
                            ? 'bg-white/15 border-white/25 hover:bg-white/20 text-white'
                            : 'bg-slate-50 dark:bg-[#2a244b] border-slate-200 dark:border-purple-900/50 hover:bg-slate-100 dark:hover:bg-[#332c5a]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide opacity-80">
                          <span>📌 {t('sharedPostLabel')}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </div>
                        <div className="flex items-center gap-2">
                          <img
                            src={
                              msg.sharedPostAuthorPhoto ||
                              `https://api.dicebear.com/7.x/bottts/svg?seed=${msg.sharedPostAuthorUsername || 'member'}`
                            }
                            alt={msg.sharedPostAuthorName || 'Author'}
                            className="w-6 h-6 rounded-full object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-bold truncate">
                              {msg.sharedPostAuthorName || 'Ethio Chat User'}
                            </p>
                            {msg.sharedPostAuthorUsername && (
                              <p className="text-[10px] opacity-80 truncate">
                                @{msg.sharedPostAuthorUsername}
                              </p>
                            )}
                          </div>
                        </div>
                        {msg.sharedPostContent && (
                          <p className="text-xs line-clamp-3 opacity-95 leading-snug">
                            {msg.sharedPostContent}
                          </p>
                        )}
                        {msg.sharedPostMediaUrl && msg.sharedPostMediaType === 'image' && (
                          <img
                            src={msg.sharedPostMediaUrl}
                            alt="Shared post media"
                            className="w-full max-h-36 object-cover rounded-lg mt-1"
                          />
                        )}
                        {msg.sharedPostMediaType === 'video' && (
                          <div className="text-[11px] font-semibold opacity-90 flex items-center gap-1 pt-0.5">
                            <Film className="w-3.5 h-3.5" />
                            <span>Video post attached</span>
                          </div>
                        )}
                      </button>
                    </div>
                  )}

                  {msg.type === 'audio' && (
                    <div className="flex items-center gap-2.5 py-1 min-w-[220px]">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePlayAudio(msg.messageId, msg.mediaUrl);
                        }}
                        className={`p-2.5 rounded-full ${
                          isMine
                            ? 'bg-white/20 hover:bg-white/30 text-white'
                            : 'bg-[#7560DF] hover:bg-[#624ec7] text-white'
                        } transition-colors shrink-0`}
                      >
                        {currentlyPlayingAudio === msg.messageId ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4 ml-0.5" />
                        )}
                      </button>

                      <div className="flex-1 space-y-1">
                        <div className="h-1.5 bg-black/20 dark:bg-white/20 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${isMine ? 'bg-white' : 'bg-[#7560DF]'}`}
                            style={{
                              width: currentlyPlayingAudio === msg.messageId ? `${audioProgress}%` : '0%'
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] opacity-80 font-mono">
                          <span>Voice note</span>
                          <span>{msg.audioDuration ? `${msg.audioDuration}s` : '0:05'}</span>
                        </div>
                      </div>

                      {msg.mediaUrl && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveChatMessageAsset(msg);
                          }}
                          className={`p-2 rounded-full transition-colors shrink-0 ${
                            isMine
                              ? 'bg-white/15 hover:bg-white/30 text-white'
                              : 'bg-[#7560DF]/15 hover:bg-[#7560DF]/25 text-[#7560DF] dark:text-[#B09EFC]'
                          }`}
                          title={t('saveToGallery')}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  <div
                    className={`flex items-center justify-end gap-1.5 text-[10px] mt-1 ${
                      isMine ? 'text-white/75' : 'text-slate-400'
                    }`}
                  >
                    {msg.editedAt && (
                      <span className="italic opacity-90">({t('editedLabel')})</span>
                    )}
                    <span>{formatMsgTime(msg.createdAt)}</span>
                    {isMine && (
                      <>
                        {isPending ? (
                          <span title="Pending - Saved locally offline" className="flex items-center text-amber-200">
                            <Clock className="w-3 h-3 animate-spin" />
                          </span>
                        ) : isReadByOther ? (
                          <span title={t('seenLabel')} className="flex items-center gap-0.5 text-sky-300 font-bold">
                            <CheckCheck className="w-3.5 h-3.5" />
                            <span>{t('seenLabel')}</span>
                          </span>
                        ) : msg.status === 'sent' ? (
                          <span title="Sent" className="text-white/80">
                            <CheckCheck className="w-3.5 h-3.5" />
                          </span>
                        ) : (
                          <span title="Error sending" className="text-rose-300">
                            <AlertCircle className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Reaction Pills */}
                {reactionsEnabled && reactionEntries.length > 0 && (
                  <div className={`flex items-center gap-1 mt-1 flex-wrap ${isMine ? 'justify-end' : 'justify-start'}`}>
                    {reactionEntries.map(([emoji, uids]) => {
                      const reactedByMe = userProfile ? uids.includes(userProfile.userId) : false;
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleToggleReaction(msg, emoji)}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 border shadow-xs transition-transform active:scale-95 ${
                            reactedByMe
                              ? 'bg-[#7560DF]/20 border-[#7560DF] text-[#7560DF] dark:text-[#B09EFC]'
                              : 'bg-white dark:bg-[#1f1b38] border-slate-200 dark:border-purple-900/50 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <span>{emoji}</span>
                          {uids.length > 1 && <span>{uids.length}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Long-Press Message Context Action Sheet (ONLY appears on Press & Hold) */}
      {selectedMessage && (
        <div
          onClick={() => setSelectedMessage(null)}
          className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-[#1a1633] rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-slate-100 dark:border-purple-900/50 space-y-2.5"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-purple-950/40">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 truncate max-w-[230px]">
                {selectedMessage.type === 'text'
                  ? selectedMessage.text
                  : selectedMessage.type === 'image'
                  ? '📷 Photo'
                  : selectedMessage.type === 'video'
                  ? `🎬 ${selectedMessage.fileName || 'Video'}`
                  : selectedMessage.type === 'file'
                  ? `📎 ${selectedMessage.fileName || 'File'}`
                  : selectedMessage.type === 'post'
                  ? `📌 ${t('sharedPostLabel')}`
                  : '🎤 Voice note'}
              </p>
              <button
                type="button"
                onClick={() => setSelectedMessage(null)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Emoji Reaction Bar */}
            {reactionsEnabled && selectedMessage.status !== 'pending' && (
              <div className="flex items-center justify-around py-1.5 bg-slate-50 dark:bg-[#241f42] rounded-2xl">
                {['❤️', '😂', '😮', '😢', '👍', '🙏'].map((emoji) => {
                  const reacted = userProfile && selectedMessage.reactions?.[emoji]?.includes(userProfile.userId);
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleToggleReaction(selectedMessage, emoji)}
                      className={`text-xl p-1.5 rounded-xl transition-transform hover:scale-125 ${
                        reacted ? 'bg-[#7560DF]/20 ring-1 ring-[#7560DF]' : ''
                      }`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Save / Download action (respects sender preventDownload lock for photos & videos) */}
            {(selectedMessage.type === 'text' ||
              selectedMessage.type === 'audio' ||
              selectedMessage.type === 'file' ||
              ((selectedMessage.type === 'image' || selectedMessage.type === 'video') &&
                (!selectedMessage.preventDownload || isSelectedMessageMine))) && (
              <button
                type="button"
                onClick={() => {
                  const target = selectedMessage;
                  setSelectedMessage(null);
                  handleSaveChatMessageAsset(target);
                }}
                className="w-full px-4 py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-bold text-sm flex items-center gap-3 transition-colors text-left"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>
                  {selectedMessage.type === 'text' ? t('saveTextFile') : t('saveToGallery')}
                </span>
              </button>
            )}

            {selectedMessage.type === 'text' && (
              <button
                type="button"
                onClick={async () => {
                  const txt = selectedMessage.text;
                  setSelectedMessage(null);
                  try {
                    await navigator.clipboard.writeText(txt);
                  } catch {
                    // ignore
                  }
                  triggerSaveToast('Copied!');
                }}
                className="w-full px-4 py-3 rounded-2xl bg-slate-100 dark:bg-[#241f42] hover:bg-slate-200 dark:hover:bg-[#2d2752] text-slate-800 dark:text-slate-100 font-bold text-sm flex items-center gap-3 transition-colors text-left"
              >
                <Copy className="w-4 h-4 text-[#7560DF] shrink-0" />
                <span>Copy Text</span>
              </button>
            )}

            {/* Sender toggle to Prevent/Allow recipient download on sent Photo or Video */}
            {isSelectedMessageMine &&
              (selectedMessage.type === 'image' || selectedMessage.type === 'video') &&
              selectedMessage.status !== 'pending' && (
                <button
                  type="button"
                  onClick={() => handleTogglePreventDownloadOnSent(selectedMessage)}
                  className="w-full px-4 py-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 text-amber-700 dark:text-amber-300 font-bold text-sm flex items-center gap-3 transition-colors text-left"
                >
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>
                    {selectedMessage.preventDownload
                      ? 'Allow receiver to save media'
                      : t('preventDownloadLabel')}
                  </span>
                </button>
              )}

            {/* A. Delete for me (Always available for both sent and received messages) */}
            <button
              type="button"
              onClick={() => handleDeleteForMe(selectedMessage)}
              className="w-full px-4 py-3 rounded-2xl bg-slate-100 dark:bg-[#241f42] hover:bg-slate-200 dark:hover:bg-[#2d2752] text-slate-800 dark:text-slate-100 font-bold text-sm flex items-center gap-3 transition-colors text-left"
            >
              <Trash2 className="w-4 h-4 text-amber-500 shrink-0" />
              <span>{t('deleteForMe')}</span>
            </button>

            {/* B. Delete for everyone & Edit ONLY for own sent messages */}
            {isSelectedMessageMine && (
              <>
                <button
                  type="button"
                  onClick={() => handleDeleteForEveryone(selectedMessage)}
                  className="w-full px-4 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-bold text-sm flex items-center gap-3 transition-colors text-left"
                >
                  <Trash2 className="w-4 h-4 shrink-0" />
                  <span>{t('deleteForEveryone')}</span>
                </button>

                {selectedMessage.type === 'text' && (
                  <button
                    type="button"
                    onClick={() => handleStartEditMessage(selectedMessage)}
                    className="w-full px-4 py-3 rounded-2xl bg-[#7560DF]/10 dark:bg-[#7560DF]/20 hover:bg-[#7560DF]/20 text-[#7560DF] dark:text-[#B09EFC] font-bold text-sm flex items-center gap-3 transition-colors text-left"
                  >
                    <Edit3 className="w-4 h-4 shrink-0" />
                    <span>{t('editMessage')}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Pre-Send Photo / Video Preview with "Prevent Recipient Download" Toggle */}
      {pendingMediaDraft && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-purple-900/60 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                {pendingMediaDraft.type === 'image' ? 'Send Photo' : 'Send Video'}
              </h3>
              <button
                type="button"
                onClick={() => setPendingMediaDraft(null)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto">
              <div className="rounded-2xl overflow-hidden bg-black/90 border border-slate-200 dark:border-purple-900/40">
                {pendingMediaDraft.type === 'image' ? (
                  <img
                    src={pendingMediaDraft.mediaUrl}
                    alt="Preview"
                    className="w-full max-h-72 object-contain mx-auto"
                  />
                ) : (
                  <video
                    src={pendingMediaDraft.mediaUrl}
                    controls
                    className="w-full max-h-72 object-contain mx-auto"
                  />
                )}
              </div>

              <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/40 flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>{t('preventDownloadLabel')}</span>
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                    {t('preventDownloadDesc')}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setPendingMediaDraft((prev) =>
                      prev ? { ...prev, preventDownload: !prev.preventDownload } : null
                    )
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    pendingMediaDraft.preventDownload ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      pendingMediaDraft.preventDownload ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* 30sec Self-Destruct Ephemeral Media Toggle */}
              <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/25 border border-rose-200 dark:border-rose-900/40 flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span>{t('ephemeral30sLabel')}</span>
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                    {t('ephemeral30sDesc')}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setPendingMediaDraft((prev) =>
                      prev ? { ...prev, expires30s: !prev.expires30s } : null
                    )
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    pendingMediaDraft.expires30s ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      pendingMediaDraft.expires30s ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 dark:border-purple-950/40 flex items-center gap-2.5 safe-bottom">
              <button
                type="button"
                onClick={() => setPendingMediaDraft(null)}
                className="px-4 py-2.5 rounded-2xl bg-slate-100 dark:bg-[#241f42] text-slate-700 dark:text-slate-200 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSendPendingMedia}
                className="flex-1 py-2.5 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-[#7560DF]/25"
              >
                <Send className="w-4 h-4" />
                <span>
                  Send {pendingMediaDraft.preventDownload ? '(Protected)' : ''}
                  {pendingMediaDraft.expires30s ? ' · 30s' : ''}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {saveToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-slate-900 dark:bg-[#7560DF] text-white text-xs font-bold shadow-lg animate-in fade-in">
          {saveToast}
        </div>
      )}

      {/* Blocked Banner, Group Lock Banner, or Input Bar */}
      {isBlocked && recipient ? (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border-t border-rose-200/60 dark:border-rose-900/40 flex items-center justify-between text-xs text-rose-700 dark:text-rose-300 safe-bottom">
          <span>You blocked {recipient.displayName}. Unblock to send messages or call.</span>
          <button
            onClick={() => unblockUser(recipient.userId)}
            className="px-3 py-1.5 rounded-xl bg-[#7560DF] text-white font-bold"
          >
            {t('unblockUser')}
          </button>
        </div>
      ) : !canPostInRoom ? (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200/70 dark:border-amber-900/40 flex items-center justify-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-300 safe-bottom">
          <Lock className="w-4 h-4 shrink-0" />
          <span>{t('groupPostingLockedBanner')}</span>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#16132b] border-t border-slate-200/80 dark:border-purple-950/40 safe-bottom">
          {isUploadingMedia && (
            <div className="px-4 py-2 bg-[#7560DF]/10 border-b border-[#7560DF]/20 space-y-1.5 text-xs text-[#7560DF] dark:text-[#B09EFC] font-semibold">
              <div className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>
                  {videoUploadPct !== null ? `Uploading chat video... ${videoUploadPct}%` : 'Preparing media...'}
                </span>
              </div>
              {videoUploadPct !== null && (
                <div className="w-full h-1.5 rounded-full bg-[#7560DF]/20 overflow-hidden">
                  <div
                    className="h-full bg-[#7560DF] transition-all duration-200"
                    style={{ width: `${videoUploadPct}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {mediaError && (
            <div className="px-4 py-2 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200/70 dark:border-rose-900/40 flex items-center justify-between gap-2 text-xs text-rose-600 dark:text-rose-300 font-semibold">
              <div className="flex items-center gap-1.5 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="truncate">{mediaError}</span>
              </div>
              <button
                type="button"
                onClick={() => setMediaError(null)}
                className="p-0.5 rounded-full hover:bg-rose-200/50 dark:hover:bg-rose-900/40 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {editingMessage && (
            <div className="px-4 py-2 bg-[#7560DF]/10 border-b border-[#7560DF]/20 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-[#7560DF] dark:text-[#B09EFC] font-bold truncate">
                <Edit3 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t('editingMessage')}: "{editingMessage.text}"</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingMessage(null);
                  setInputText('');
                }}
                className="p-1 rounded-full text-slate-400 hover:text-rose-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="p-2.5 sm:p-3">
            {isRecordingAudio ? (
              <AudioRecorder
                onSendVoiceNote={handleSendVoiceNote}
                onCancel={() => setIsRecordingAudio(false)}
              />
            ) : (
              <form
                onSubmit={handleSendTextMessage}
                className="flex items-center gap-1 sm:gap-1.5"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={handleSelectImage}
                />
                <input
                  type="file"
                  ref={videoInputRef}
                  accept="video/*"
                  className="hidden"
                  onChange={handleSelectVideo}
                />
                <input
                  type="file"
                  ref={anyFileInputRef}
                  accept="*/*"
                  className="hidden"
                  onChange={handleSelectAnyFile}
                />
                {!editingMessage && (
                  <>
                    <button
                      type="button"
                      disabled={isUploadingMedia}
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 rounded-full text-slate-500 hover:text-[#7560DF] hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors shrink-0"
                      title={t('photo')}
                    >
                      <ImageIcon className="w-4.5 h-4.5" />
                    </button>

                    <button
                      type="button"
                      disabled={isUploadingMedia}
                      onClick={() => videoInputRef.current?.click()}
                      className="p-2 rounded-full text-slate-500 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors shrink-0"
                      title={t('sendVideo')}
                    >
                      <Film className="w-4.5 h-4.5" />
                    </button>

                    <button
                      type="button"
                      disabled={isUploadingMedia}
                      onClick={() => anyFileInputRef.current?.click()}
                      className="p-2 rounded-full text-slate-500 hover:text-emerald-500 hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors shrink-0"
                      title={t('sendFile')}
                    >
                      <Paperclip className="w-4.5 h-4.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsRecordingAudio(true)}
                      className="p-2 rounded-full text-slate-500 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors shrink-0"
                      title="Record voice message"
                    >
                      <Mic className="w-4.5 h-4.5" />
                    </button>
                  </>
                )}

                <input
                  ref={textInputRef}
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={
                    editingMessage
                      ? 'Edit your message...'
                      : isOnline()
                      ? isGroup
                        ? `Message ${liveGroupRoom?.groupName || 'group'}...`
                        : 'Type a message...'
                      : 'Type message (will queue offline)...'
                  }
                  className="flex-1 min-w-0 px-3.5 py-2.5 rounded-full bg-slate-100 dark:bg-[#201c38] text-slate-800 dark:text-slate-100 text-sm outline-none focus:ring-2 focus:ring-[#7560DF] placeholder:text-slate-400"
                />

                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="p-2.5 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white disabled:opacity-40 shadow-sm transition-all shrink-0"
                >
                  {editingMessage ? <Check className="w-4.5 h-4.5" /> : <Send className="w-4.5 h-4.5" />}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen Zoom & Protected Media Viewer Lightbox */}
      <MediaLightboxModal
        isOpen={Boolean(lightboxMedia)}
        mediaType={lightboxMedia?.type || 'image'}
        mediaUrl={lightboxMedia?.mediaUrl || ''}
        fileName={lightboxMedia?.fileName}
        protectedMode={lightboxMedia?.protectedMode}
        viewerUsername={userProfile?.username}
        expiresAt={lightboxMedia?.expiresAt}
        onSave={
          lightboxMedia && !lightboxMedia.protectedMode
            ? async () => {
                const ext = lightboxMedia.type === 'image' ? 'jpg' : 'mp4';
                await saveMediaToDevice(
                  lightboxMedia.mediaUrl,
                  lightboxMedia.fileName || `ethio_chat_${lightboxMedia.messageId}.${ext}`,
                  lightboxMedia.mimeType
                );
                triggerSaveToast(t('saveToGallery'));
              }
            : undefined
        }
        onClose={() => setLightboxMedia(null)}
        onExpired={() => setNowTick(Date.now())}
      />
    </div>
  );
};
