import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  orderBy,
  limit,
  writeBatch
} from 'firebase/firestore';
import {
  Team,
  TeamMember,
  TeamMessage,
  TeamMessageType,
  UserProfile
} from '../../types';
import { compressImage, processChatVideoFile } from '../../lib/mediaCompression';
import {
  REACTION_EMOJIS_8,
  saveMediaToDevice,
  saveTextToDevice,
  createAppNotification
} from '../../lib/socialHelpers';
import { AudioRecorder } from './AudioRecorder';
import { TeamLiveStageModal } from './TeamLiveStageModal';
import { primeMediaStream } from '../../lib/mediaPermissions';
import { MediaLightboxModal } from '../common/MediaLightboxModal';
import { GoldVerifiedBadge } from '../common/GoldVerifiedBadge';
import {
  ArrowLeft,
  Users,
  Send,
  Paperclip,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Mic,
  Download,
  Lock,
  Unlock,
  Reply,
  Smile,
  Trash2,
  Crown,
  Shield,
  Plus,
  X,
  Radio,
  Video,
  Phone,
  Camera,
  Check,
  Loader2,
  AlertCircle,
  Search,
  Eye,
  ShieldAlert,
  Clock,
  ZoomIn,
  Maximize2
} from 'lucide-react';

interface TeamRoomViewProps {
  team: Team;
  onBack: () => void;
  onViewProfile: (userId: string) => void;
}

interface PendingTeamAttachment {
  id: string;
  type: 'image' | 'video' | 'audio' | 'pdf';
  mediaUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export const TeamRoomView: React.FC<TeamRoomViewProps> = ({
  team,
  onBack,
  onViewProfile,
}) => {
  const { userProfile, allUsers } = useAuth();
  const { t } = useLanguage();

  const [liveTeam, setLiveTeam] = useState<Team>(team);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [myMembership, setMyMembership] = useState<TeamMember | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [messages, setMessages] = useState<TeamMessage[]>([]);

  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [isLiveStageOpen, setIsLiveStageOpen] = useState(false);

  // Composer & Multi-file (up to 10) attachment state
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<TeamMessage | null>(null);
  const [showFilePickerMenu, setShowFilePickerMenu] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingTeamAttachment[]>([]);
  const [preventDownload, setPreventDownload] = useState(false);
  const [ephemeral30s, setEphemeral30s] = useState(false);
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
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [isProcessingMedia, setIsProcessingMedia] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Message interactions (emoji reactions bar, in-app PDF reader modal, toast)
  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null);
  const [viewingPdfMsg, setViewingPdfMsg] = useState<TeamMessage | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Owner Edit Team Profile & Delete state (STRICTLY Owner only; Admin cannot edit Name/Photo or Delete)
  const [editName, setEditName] = useState(team.name);
  const [editDesc, setEditDesc] = useState(team.description || '');
  const [editPhoto, setEditPhoto] = useState(team.photoURL || '');
  const [savingTeamEdit, setSavingTeamEdit] = useState(false);
  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [joiningPublic, setJoiningPublic] = useState(false);

  const deletedExpiredIdsRef = useRef<Set<string>>(new Set());
  const photoPickerRef = useRef<HTMLInputElement>(null);
  const videoPickerRef = useRef<HTMLInputElement>(null);
  const audioPickerRef = useRef<HTMLInputElement>(null);
  const pdfPickerRef = useRef<HTMLInputElement>(null);
  const editLogoPickerRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2200);
  };

  // Subscribe to Team document
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'teams', team.teamId), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Team;
        setLiveTeam(data);
        setEditName(data.name);
        setEditDesc(data.description || '');
        setEditPhoto(data.photoURL || '');
      }
    });
    return () => unsub();
  }, [team.teamId]);

  // Subscribe strictly to current user's membership doc first
  useEffect(() => {
    if (!userProfile) {
      setMembershipLoading(false);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'teams', team.teamId, 'members', userProfile.userId),
      (snap) => {
        setMyMembership(snap.exists() ? (snap.data() as TeamMember) : null);
        setMembershipLoading(false);
      },
      () => {
        setMyMembership(null);
        setMembershipLoading(false);
      }
    );
    return () => unsub();
  }, [team.teamId, userProfile?.userId]);

  const isOwner = Boolean(userProfile && liveTeam.ownerId === userProfile.userId);
  const isMember = Boolean(myMembership || isOwner);
  const isAdmin = Boolean(
    userProfile &&
      (isOwner ||
        myMembership?.role === 'admin' ||
        (liveTeam.adminIds || []).includes(userProfile.userId))
  );

  // Subscribe to members list (bounded snapshot up to 200 displayed cleanly while memberCount supports 70M)
  useEffect(() => {
    if (!isMember) return;
    const q = query(collection(db, 'teams', team.teamId, 'members'), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: TeamMember[] = [];
        snap.forEach((d) => list.push(d.data() as TeamMember));
        list.sort((a, b) => {
          const rank = { owner: 0, admin: 1, member: 2 };
          return (rank[a.role] ?? 2) - (rank[b.role] ?? 2);
        });
        setMembers(list);
      },
      () => {}
    );
    return () => unsub();
  }, [team.teamId, isMember]);

  // Subscribe to Team messages strictly ONLY when current user is a Team member
  useEffect(() => {
    if (!isMember) {
      setMessages([]);
      return;
    }
    const q = query(
      collection(db, 'teams', team.teamId, 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: TeamMessage[] = [];
        snap.forEach((d) => list.push(d.data() as TeamMessage));
        setMessages(list);
      },
      () => {}
    );
    return () => unsub();
  }, [team.teamId, isMember]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

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

  // Auto-delete expired ephemeral team messages from Firestore once timer hits 0
  useEffect(() => {
    messages.forEach((m) => {
      if (!m.expiresAt) return;
      const expMs = new Date(m.expiresAt).getTime();
      if (expMs <= nowTick && !deletedExpiredIdsRef.current.has(m.messageId)) {
        deletedExpiredIdsRef.current.add(m.messageId);
        if (lightboxMedia?.messageId === m.messageId) {
          setLightboxMedia(null);
        }
        deleteDoc(doc(db, 'teams', liveTeam.teamId, 'messages', m.messageId)).catch(() => {});
      }
    });
  }, [messages, nowTick, liveTeam.teamId, lightboxMedia]);

  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) => !(m.expiresAt && new Date(m.expiresAt).getTime() <= nowTick)
      ),
    [messages, nowTick]
  );

  // Inline screenshot & screen-recording deterrence while un-downloadable media from others is visible
  const hasVisibleProtectedMedia = useMemo(
    () =>
      visibleMessages.some(
        (m) =>
          Boolean(m.preventDownload) &&
          m.senderId !== userProfile?.userId &&
          (m.type === 'image' || m.type === 'video')
      ),
    [visibleMessages, userProfile?.userId]
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

  const canSendMessages = !liveTeam.messagingLocked || isAdmin;

  const memberIdsSet = useMemo(() => new Set(members.map((m) => m.userId)), [members]);
  const usersAvailableToAdd = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return allUsers
      .filter((u) => !memberIdsSet.has(u.userId))
      .filter((u) => {
        if (!q) return true;
        return (
          u.displayName.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q)
        );
      })
      .slice(0, 15);
  }, [allUsers, memberIdsSet, memberSearch]);

  // Join Public Team handler (strictly blocks joining private teams from outside)
  const handleJoinPublicTeam = async () => {
    if (!userProfile || !liveTeam.isPublic || joiningPublic) return;
    setJoiningPublic(true);
    try {
      const now = new Date().toISOString();
      const memberDoc: TeamMember = {
        userId: userProfile.userId,
        teamId: liveTeam.teamId,
        username: userProfile.username,
        displayName: userProfile.displayName,
        ...(userProfile.photoURL ? { photoURL: userProfile.photoURL } : {}),
        role: 'member',
        joinedAt: now,
      };
      await setDoc(doc(db, 'teams', liveTeam.teamId, 'members', userProfile.userId), memberDoc);
      await updateDoc(doc(db, 'teams', liveTeam.teamId), {
        memberCount: increment(1),
        updatedAt: now,
      }).catch(() => {});
    } finally {
      setJoiningPublic(false);
    }
  };

  // Non-member Privacy Gate
  if (membershipLoading) {
    return (
      <div className="h-[calc(100dvh-56px)] sm:h-[calc(100dvh-64px)] max-w-2xl mx-auto flex items-center justify-center bg-white dark:bg-[#0f0d1a]">
        <Loader2 className="w-7 h-7 animate-spin text-[#7560DF]" />
      </div>
    );
  }

  if (!isMember) {
    return (
      <div className="h-[calc(100dvh-56px)] sm:h-[calc(100dvh-64px)] max-w-2xl mx-auto bg-white dark:bg-[#0f0d1a] flex flex-col">
        <div className="p-4 border-b border-slate-200 dark:border-purple-950/40 flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-purple-900/30"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h3 className="font-bold text-base truncate">{liveTeam.name}</h3>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
          {liveTeam.photoURL ? (
            <img
              src={liveTeam.photoURL}
              alt={liveTeam.name}
              className="w-20 h-20 rounded-3xl object-cover ring-4 ring-[#7560DF]/20"
            />
          ) : (
            <div className="w-20 h-20 rounded-3xl bg-[#7560DF]/15 text-[#7560DF] flex items-center justify-center">
              {liveTeam.isPublic ? <Users className="w-10 h-10" /> : <Lock className="w-10 h-10" />}
            </div>
          )}

          <div className="space-y-1">
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              {liveTeam.name}
            </h2>
            {liveTeam.isPublic && liveTeam.teamUsername && (
              <p className="text-xs font-bold text-[#7560DF]">@{liveTeam.teamUsername}</p>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
              {liveTeam.isPublic
                ? 'Join this Team to see messages, photos, videos, music, PDFs, and live Voice/Video stages.'
                : 'This is a private Team. Only added members can see its messages, files, and media.'}
            </p>
          </div>

          {liveTeam.isPublic && (
            <button
              type="button"
              disabled={joiningPublic}
              onClick={handleJoinPublicTeam}
              className="px-6 py-3 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-sm shadow-md shadow-[#7560DF]/25 flex items-center gap-2"
            >
              {joiningPublic ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span>Join Team ({liveTeam.memberCount.toLocaleString()} members)</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });
  };

  // Handle selecting up to 10 files at once (Photo, Video, Music, PDF)
  const handleSelectBatchFiles = async (
    e: React.ChangeEvent<HTMLInputElement>,
    kind: 'image' | 'video' | 'audio' | 'pdf'
  ) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    setShowFilePickerMenu(false);
    if (fileList.length === 0) return;

    const remainingSlots = 10 - pendingAttachments.length;
    if (remainingSlots <= 0) {
      setMediaError('Maximum 10 attachments can be sent in one batch.');
      return;
    }

    const chosen = fileList.slice(0, remainingSlots);
    if (fileList.length > remainingSlots) {
      setMediaError(`Only the first ${remainingSlots} file(s) were added (max 10 at once).`);
    } else {
      setMediaError(null);
    }

    setIsProcessingMedia(true);
    const added: PendingTeamAttachment[] = [];

    try {
      for (const file of chosen) {
        if (kind === 'image') {
          const compressed = await compressImage(file, 900, 900, 0.72);
          added.push({
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: 'image',
            mediaUrl: compressed.dataUrl,
            fileName: file.name,
            fileSize: compressed.sizeBytes,
            mimeType: 'image/jpeg',
          });
        } else if (kind === 'video') {
          if (file.size > 50 * 1024 * 1024) {
            setMediaError(`"${file.name}" exceeds the 50 MB chat video limit.`);
            continue;
          }
          const uploaded = await processChatVideoFile(file);
          added.push({
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: 'video',
            mediaUrl: uploaded.url,
            fileName: file.name,
            fileSize: uploaded.sizeBytes,
            mimeType: uploaded.mimeType,
          });
        } else {
          if (file.size > 680 * 1024) {
            setMediaError(`"${file.name}" exceeds 680 KB per-file instant sync limit.`);
            continue;
          }
          const dataUrl = await readFileAsDataUrl(file);
          if (dataUrl.length > 940000) {
            setMediaError(`"${file.name}" encoded size is too large (max ~680 KB).`);
            continue;
          }
          added.push({
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: kind,
            mediaUrl: dataUrl,
            fileName: file.name,
            fileSize: file.size,
            mimeType:
              file.type ||
              (kind === 'pdf'
                ? 'application/pdf'
                : 'audio/mpeg'),
          });
        }
      }
      if (added.length > 0) {
        setPendingAttachments((prev) => [...prev, ...added].slice(0, 10));
      }
    } catch (err: any) {
      setMediaError(err?.message || 'Failed to prepare selected files.');
    } finally {
      setIsProcessingMedia(false);
    }
  };

  // Send Text and/or up to 10 Batch Attachments
  const handleSendTeamMessages = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userProfile || !canSendMessages || sending) return;

    const trimmedText = inputText.trim();
    if (!trimmedText && pendingAttachments.length === 0) return;

    setSending(true);
    setMediaError(null);

    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      const replyFields = replyingTo
        ? {
            replyToMessageId: replyingTo.messageId,
            replyToSenderName: replyingTo.senderDisplayName,
            replyToText:
              replyingTo.type === 'text'
                ? replyingTo.text.slice(0, 180)
                : replyingTo.fileName || replyingTo.type.toUpperCase(),
          }
        : {};

      let snippet = trimmedText;

      if (pendingAttachments.length > 0) {
        const batchId = `tbatch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const expiresAt = ephemeral30s ? new Date(Date.now() + 30000).toISOString() : undefined;
        pendingAttachments.forEach((att, idx) => {
          const messageId = `tmsg_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
          const payload: TeamMessage = {
            messageId,
            teamId: liveTeam.teamId,
            senderId: userProfile.userId,
            senderUsername: userProfile.username,
            senderDisplayName: userProfile.displayName,
            ...(userProfile.photoURL ? { senderPhotoURL: userProfile.photoURL } : {}),
            type: att.type,
            text: idx === 0 && trimmedText ? trimmedText : att.fileName,
            mediaUrl: att.mediaUrl,
            fileName: att.fileName,
            fileSize: att.fileSize,
            mimeType: att.mimeType,
            preventDownload,
            ...(ephemeral30s && expiresAt ? { expiresAfterSeconds: 30, expiresAt } : {}),
            batchId,
            batchIndex: idx,
            batchTotal: pendingAttachments.length,
            ...(idx === 0 ? replyFields : {}),
            createdAt: new Date(Date.now() + idx).toISOString(),
          };
          batch.set(doc(db, 'teams', liveTeam.teamId, 'messages', messageId), payload);
        });

        const firstType = pendingAttachments[0].type;
        const icon =
          firstType === 'image'
            ? '📷'
            : firstType === 'video'
            ? '🎬'
            : firstType === 'audio'
            ? '🎵'
            : '📄';
        snippet = `${icon} Sent ${pendingAttachments.length} ${firstType}${pendingAttachments.length > 1 ? 's' : ''}${trimmedText ? `: ${trimmedText}` : ''}`;
      } else {
        const messageId = `tmsg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const payload: TeamMessage = {
          messageId,
          teamId: liveTeam.teamId,
          senderId: userProfile.userId,
          senderUsername: userProfile.username,
          senderDisplayName: userProfile.displayName,
          ...(userProfile.photoURL ? { senderPhotoURL: userProfile.photoURL } : {}),
          type: 'text',
          text: trimmedText,
          ...replyFields,
          createdAt: now,
        };
        batch.set(doc(db, 'teams', liveTeam.teamId, 'messages', messageId), payload);
      }

      await batch.commit();
      await updateDoc(doc(db, 'teams', liveTeam.teamId), {
        lastMessage: snippet.slice(0, 200),
        lastMessageTime: now,
        lastSenderId: userProfile.userId,
        updatedAt: now,
      }).catch(() => {});

      setInputText('');
      setPendingAttachments([]);
      setPreventDownload(false);
      setEphemeral30s(false);
      setReplyingTo(null);
    } catch (err: any) {
      setMediaError(err?.message || 'Failed to send to Team.');
    } finally {
      setSending(false);
    }
  };

  const openTeamMediaInLightbox = (msg: TeamMessage) => {
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

  // Send Voice Note in Team
  const handleSendTeamVoice = async (audioDataUrl: string, durationSeconds: number) => {
    if (!userProfile || !canSendMessages) return;
    setIsRecordingAudio(false);
    const now = new Date().toISOString();
    const messageId = `tmsg_voice_${Date.now()}`;
    const payload: TeamMessage = {
      messageId,
      teamId: liveTeam.teamId,
      senderId: userProfile.userId,
      senderUsername: userProfile.username,
      senderDisplayName: userProfile.displayName,
      ...(userProfile.photoURL ? { senderPhotoURL: userProfile.photoURL } : {}),
      type: 'audio',
      text: 'Voice message',
      mediaUrl: audioDataUrl,
      fileName: `voice_${durationSeconds}s.webm`,
      audioDuration: durationSeconds,
      preventDownload: false,
      createdAt: now,
    };
    await setDoc(doc(db, 'teams', liveTeam.teamId, 'messages', messageId), payload);
    await updateDoc(doc(db, 'teams', liveTeam.teamId), {
      lastMessage: '🎤 Voice message',
      lastMessageTime: now,
      lastSenderId: userProfile.userId,
      updatedAt: now,
    }).catch(() => {});
  };

  // 8-Emoji Reaction toggle
  const handleToggleTeamReaction = async (msg: TeamMessage, emoji: string) => {
    if (!userProfile) return;
    setActiveReactionMsgId(null);
    const currentReactions = { ...(msg.reactions || {}) };
    const existing = Array.isArray(currentReactions[emoji]) ? [...currentReactions[emoji]] : [];
    const hasReacted = existing.includes(userProfile.userId);
    const updated = hasReacted
      ? existing.filter((id) => id !== userProfile.userId)
      : [...existing, userProfile.userId];
    if (updated.length === 0) delete currentReactions[emoji];
    else currentReactions[emoji] = updated;

    await updateDoc(doc(db, 'teams', liveTeam.teamId, 'messages', msg.messageId), {
      reactions: currentReactions,
    }).catch(() => {});
  };

  const handleDeleteTeamMessage = async (msg: TeamMessage) => {
    if (!userProfile) return;
    if (msg.senderId !== userProfile.userId && !isAdmin) return;
    await deleteDoc(doc(db, 'teams', liveTeam.teamId, 'messages', msg.messageId)).catch(() => {});
  };

  const handleSaveTeamAttachment = async (msg: TeamMessage) => {
    if (msg.preventDownload && msg.senderId !== userProfile?.userId) return;
    if (msg.type === 'text') {
      saveTextToDevice(msg.text, `${liveTeam.name}_${msg.messageId}.txt`);
      showToast(t('saveTextFile'));
      return;
    }
    if (!msg.mediaUrl) return;
    const filename =
      msg.fileName ||
      `team_${msg.type}_${msg.messageId}.${msg.type === 'pdf' ? 'pdf' : msg.type === 'image' ? 'jpg' : msg.type === 'audio' ? 'mp3' : 'mp4'}`;
    await saveMediaToDevice(msg.mediaUrl, filename, msg.mimeType);
    showToast(t('downloadImage'));
  };

  // Owner ONLY: Start Voice Chat or Start Video Chat
  const handleStartLiveStage = async (mode: 'voice' | 'video') => {
    if (!isOwner) return;
    // Trigger mic/camera permission synchronously inside click gesture before awaiting Firestore
    primeMediaStream('team-stage', {
      wantAudio: true,
      wantVideo: mode === 'video',
      facingMode: 'user',
    });
    const now = new Date().toISOString();
    await updateDoc(doc(db, 'teams', liveTeam.teamId), {
      liveRoom: {
        active: true,
        mode,
        liveCommentsEnabled: true,
        startedBy: userProfile!.userId,
        startedAt: now,
      },
      updatedAt: now,
    }).catch(() => {});
    setIsLiveStageOpen(true);
  };

  // Owner ONLY: Save Team Name, Photo, and Description (Admin CANNOT change Team Name or Photo)
  const handleSaveOwnerTeamEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner || !editName.trim() || savingTeamEdit) return;
    setSavingTeamEdit(true);
    try {
      await updateDoc(doc(db, 'teams', liveTeam.teamId), {
        name: editName.trim(),
        nameLower: editName.trim().toLowerCase(),
        description: editDesc.trim(),
        photoURL: editPhoto || '',
        updatedAt: new Date().toISOString(),
      });
      showToast('Team details updated!');
    } finally {
      setSavingTeamEdit(false);
    }
  };

  const handleOwnerSelectNewLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !isOwner) return;
    try {
      const res = await compressImage(file, 420, 420, 0.8);
      setEditPhoto(res.dataUrl);
    } catch {}
  };

  // Owner or Admin: Open / Close Team Messaging
  const handleToggleMessagingLock = async () => {
    if (!isAdmin) return;
    await updateDoc(doc(db, 'teams', liveTeam.teamId), {
      messagingLocked: !liveTeam.messagingLocked,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  };

  // Owner ONLY: Grant / Revoke Admin
  const handleToggleAdminRole = async (member: TeamMember) => {
    if (!isOwner || member.userId === liveTeam.ownerId) return;
    const nextRole = member.role === 'admin' ? 'member' : 'admin';
    await updateDoc(doc(db, 'teams', liveTeam.teamId, 'members', member.userId), {
      role: nextRole,
    }).catch(() => {});
    await updateDoc(doc(db, 'teams', liveTeam.teamId), {
      adminIds:
        nextRole === 'admin' ? arrayUnion(member.userId) : arrayRemove(member.userId),
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  };

  // Owner / Admin ONLY: Add new user (supports up to 70,000,000 members)
  const handleAddUserToTeam = async (u: UserProfile) => {
    if (!userProfile || !isAdmin) return;
    if (liveTeam.memberCount >= 70000000) return;
    const now = new Date().toISOString();
    const m: TeamMember = {
      userId: u.userId,
      teamId: liveTeam.teamId,
      username: u.username,
      displayName: u.displayName,
      ...(u.photoURL ? { photoURL: u.photoURL } : {}),
      role: 'member',
      joinedAt: now,
    };
    await setDoc(doc(db, 'teams', liveTeam.teamId, 'members', u.userId), m);
    await updateDoc(doc(db, 'teams', liveTeam.teamId), {
      memberCount: increment(1),
      updatedAt: now,
    }).catch(() => {});
    await createAppNotification({
      recipientId: u.userId,
      actor: userProfile,
      type: 'team',
      chatId: liveTeam.teamId,
      text: `added you to Team "${liveTeam.name}"`,
    });
  };

  // Owner removes any non-owner member (Admin cannot remove Owner or other Admins or Delete Team)
  const handleRemoveMember = async (member: TeamMember) => {
    if (member.userId === liveTeam.ownerId) return;
    if (!isOwner && (!isAdmin || member.role === 'admin')) return;
    await deleteDoc(doc(db, 'teams', liveTeam.teamId, 'members', member.userId)).catch(() => {});
    await updateDoc(doc(db, 'teams', liveTeam.teamId), {
      memberCount: increment(-1),
      adminIds: arrayRemove(member.userId),
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  };

  // Owner ONLY: Delete Team
  const handleDeleteTeam = async () => {
    if (!isOwner) return;
    await deleteDoc(doc(db, 'teams', liveTeam.teamId)).catch(() => {});
    onBack();
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-56px)] sm:h-[calc(100dvh-64px)] max-w-2xl mx-auto bg-white dark:bg-[#0f0d1a] border-x border-slate-200/80 dark:border-purple-950/40 relative">
      {/* Top Bar */}
      <div className="px-3 sm:px-4 py-3 bg-white dark:bg-[#16132b] border-b border-slate-200/80 dark:border-purple-950/40 flex items-center justify-between gap-2 shadow-sm z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="p-2 -ml-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-purple-900/30 shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setShowSettingsDrawer((v) => !v)}
            className="flex items-center gap-2.5 text-left min-w-0 group"
          >
            {liveTeam.photoURL ? (
              <img
                src={liveTeam.photoURL}
                alt={liveTeam.name}
                className="w-10 h-10 rounded-2xl object-cover shrink-0 ring-1 ring-slate-200 dark:ring-purple-800"
              />
            ) : (
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] text-white flex items-center justify-center shrink-0 font-black">
                {liveTeam.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] truncate">
                  {liveTeam.name}
                </h3>
                {!liveTeam.isPublic && <Lock className="w-3 h-3 text-[#7560DF] shrink-0" />}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {liveTeam.memberCount.toLocaleString()} / 70M members
                {liveTeam.isPublic && liveTeam.teamUsername ? ` · @${liveTeam.teamUsername}` : ''}
              </p>
            </div>
          </button>
        </div>

        {/* Right Controls: Owner-only Start Voice / Video Chat + Team Drawer button */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isOwner && !liveTeam.liveRoom?.active && (
            <>
              <button
                type="button"
                onClick={() => handleStartLiveStage('voice')}
                className="px-2.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center gap-1"
                title={t('startVoiceChat')}
              >
                <Phone className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Voice</span>
              </button>
              <button
                type="button"
                onClick={() => handleStartLiveStage('video')}
                className="px-2.5 py-2 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold flex items-center gap-1"
                title={t('startVideoChat')}
              >
                <Video className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Video</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setShowSettingsDrawer((v) => !v)}
            className="p-2 rounded-xl bg-[#7560DF]/10 dark:bg-[#7560DF]/25 text-[#7560DF] dark:text-[#B09EFC] hover:bg-[#7560DF]/20"
            title="Team Settings & Members"
          >
            <Users className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>

      {/* Active Voice / Video Stage Banner for ALL Team Members */}
      {liveTeam.liveRoom?.active && (
        <div className="px-4 py-2.5 bg-gradient-to-r from-rose-600 to-[#7560DF] text-white flex items-center justify-between gap-2 shadow-sm z-10">
          <div className="flex items-center gap-2 min-w-0">
            <Radio className="w-4 h-4 animate-pulse shrink-0" />
            <span className="text-xs font-extrabold truncate">
              {liveTeam.liveRoom.mode === 'video' ? 'Live Video Chat Active' : 'Live Voice Chat Active'} · 6 Seats
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isOwner) {
                primeMediaStream('team-stage', {
                  wantAudio: true,
                  wantVideo: liveTeam.liveRoom?.mode === 'video',
                  facingMode: 'user',
                });
              }
              setIsLiveStageOpen(true);
            }}
            className="px-3.5 py-1.5 rounded-full bg-white text-[#7560DF] text-xs font-extrabold hover:bg-white/90 shrink-0"
          >
            {t('joinLiveStage')}
          </button>
        </div>
      )}

      {/* Expandable Team Settings & Members Drawer */}
      {showSettingsDrawer && (
        <div className="bg-white dark:bg-[#1a1633] border-b border-slate-200 dark:border-purple-950/50 p-4 space-y-4 max-h-[65vh] overflow-y-auto shadow-lg z-20">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Team Settings & Members ({liveTeam.memberCount.toLocaleString()})
            </h4>
            <button
              type="button"
              onClick={() => setShowSettingsDrawer(false)}
              className="p-1 rounded-full text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* OWNER ONLY: Edit Team Name, Photo/Logo, Description & Delete Team (Admins strictly CANNOT do these) */}
          {isOwner && (
            <form
              onSubmit={handleSaveOwnerTeamEdit}
              className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#241f42] border border-slate-200 dark:border-purple-900/50 space-y-3"
            >
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5" />
                <span>Owner Team Controls</span>
              </p>

              <div className="flex items-center gap-3">
                <input
                  ref={editLogoPickerRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleOwnerSelectNewLogo}
                />
                <button
                  type="button"
                  onClick={() => editLogoPickerRef.current?.click()}
                  className="w-14 h-14 rounded-2xl bg-white dark:bg-[#16132b] border border-dashed border-[#7560DF] flex items-center justify-center overflow-hidden shrink-0"
                  title="Change Team Photo"
                >
                  {editPhoto ? (
                    <img src={editPhoto} alt="Logo" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-5 h-5 text-[#7560DF]" />
                  )}
                </button>
                <div className="flex-1 space-y-1.5 min-w-0">
                  <input
                    type="text"
                    maxLength={80}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Team Name"
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#16132b] border border-slate-200 dark:border-purple-900/50 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
                  />
                  <input
                    type="text"
                    maxLength={300}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="Team Description"
                    className="w-full px-3 py-1.5 rounded-xl bg-white dark:bg-[#16132b] border border-slate-200 dark:border-purple-900/50 text-xs text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#7560DF]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={savingTeamEdit || !editName.trim()}
                  className="px-3.5 py-2 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold flex items-center gap-1"
                >
                  {savingTeamEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Save Name & Photo</span>
                </button>

                {!confirmDeleteTeam ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteTeam(true)}
                    className="ml-auto px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Team</span>
                  </button>
                ) : (
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleDeleteTeam}
                      className="px-3 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold"
                    >
                      {t('yesBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteTeam(false)}
                      className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold"
                    >
                      {t('noBtn')}
                    </button>
                  </div>
                )}
              </div>
            </form>
          )}

          {/* Open / Close Messaging Toggle (Owner or Admin) */}
          {isAdmin && (
            <div className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-slate-50 dark:bg-[#241f42] border border-slate-200/80 dark:border-purple-900/50">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 dark:text-white">
                  {liveTeam.messagingLocked ? 'Team Messaging Closed' : 'Team Messaging Open'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {liveTeam.messagingLocked
                    ? 'Only Owner & Admins can send messages/files'
                    : 'All Team members can send messages & files'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleMessagingLock}
                className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 ${
                  liveTeam.messagingLocked
                    ? 'bg-emerald-500 text-white'
                    : 'bg-amber-500 text-white'
                }`}
              >
                {liveTeam.messagingLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                <span>{liveTeam.messagingLocked ? 'Open' : 'Close'}</span>
              </button>
            </div>
          )}

          {/* Notice for Non-Owner Admins enforcing strict boundary */}
          {!isOwner && isAdmin && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-[#241f42] px-3 py-2 rounded-xl flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-[#7560DF] shrink-0" />
              <span>Admin role: You can moderate messages and members. Only the Owner can rename, change logo, start Voice/Video, or delete the Team.</span>
            </p>
          )}

          {/* Members List */}
          <div className="space-y-1.5">
            {members.map((m) => {
              const memberIsOwner = m.userId === liveTeam.ownerId;
              const memberIsAdmin = !memberIsOwner && m.role === 'admin';
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
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 text-[10px] font-extrabold shrink-0">
                        Owner
                      </span>
                    )}
                    {memberIsAdmin && (
                      <span className="px-1.5 py-0.5 rounded bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] text-[10px] font-extrabold shrink-0">
                        Admin
                      </span>
                    )}
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    {isOwner && !memberIsOwner && (
                      <button
                        type="button"
                        onClick={() => handleToggleAdminRole(m)}
                        className="px-2 py-1 rounded-lg bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] text-[10px] font-bold hover:bg-[#7560DF]/25"
                      >
                        {memberIsAdmin ? t('removeAdmin') : t('makeAdmin')}
                      </button>
                    )}
                    {!memberIsOwner && (isOwner || (isAdmin && !memberIsAdmin)) && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m)}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/15"
                        title="Remove from Team"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add Users to Team */}
          {isAdmin && liveTeam.memberCount < 70000000 && (
            <div className="pt-2 border-t border-slate-100 dark:border-purple-950/40 space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Add users to this Team (up to 70,000,000)..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-[#241f42] text-xs outline-none focus:ring-2 focus:ring-[#7560DF]"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {usersAvailableToAdd.map((u) => (
                  <button
                    key={u.userId}
                    type="button"
                    onClick={() => handleAddUserToTeam(u)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#7560DF]/10 text-[#7560DF] dark:text-[#B09EFC] text-xs font-semibold hover:bg-[#7560DF]/20"
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

      {/* Team Messages Scroll Area */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/50 dark:bg-[#0f0d1a]">
        {visibleMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <Users className="w-10 h-10 text-[#7560DF] mb-2" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{liveTeam.name}</p>
            <p className="text-xs max-w-xs mt-1">
              Only Team members can see texts, photos, videos, music, and PDFs shared here.
            </p>
          </div>
        ) : (
          visibleMessages.map((msg) => {
            const isMine = msg.senderId === userProfile?.userId;
            const lockedForViewer = Boolean(msg.preventDownload && !isMine);
            const remainingSec = msg.expiresAt
              ? Math.max(1, Math.ceil((new Date(msg.expiresAt).getTime() - nowTick) / 1000))
              : null;
            const reactionEntries = Object.entries(msg.reactions || {}).filter(
              ([, uids]) => Array.isArray(uids) && uids.length > 0
            );

            return (
              <div key={msg.messageId} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                {!isMine && (
                  <button
                    type="button"
                    onClick={() => onViewProfile(msg.senderId)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#7560DF] dark:text-[#A798F8] mb-0.5 ml-1 hover:underline"
                  >
                    <span>{msg.senderDisplayName}</span>
                    <GoldVerifiedBadge userId={msg.senderId} size="xs" />
                  </button>
                )}

                <div
                  className={`max-w-[82%] sm:max-w-[72%] rounded-2xl px-3.5 py-2.5 text-sm shadow-xs ${
                    isMine
                      ? 'bg-[#7560DF] text-white rounded-br-sm'
                      : 'bg-white dark:bg-[#1f1b38] text-slate-900 dark:text-slate-100 border border-slate-200/80 dark:border-purple-950/40 rounded-bl-sm'
                  }`}
                >
                  {/* Reply Quote Preview */}
                  {msg.replyToText && (
                    <div
                      className={`mb-2 px-2.5 py-1.5 rounded-xl text-[11px] ${
                        isMine ? 'bg-white/15 text-white/90' : 'bg-slate-100 dark:bg-[#2a244b] text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <p className="font-bold truncate">{msg.replyToSenderName || 'Reply'}</p>
                      <p className="truncate opacity-85">{msg.replyToText}</p>
                    </div>
                  )}

                  {/* TEXT */}
                  {msg.type === 'text' && (
                    <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                  )}

                  {/* IMAGE */}
                  {msg.type === 'image' && msg.mediaUrl && (
                    <div
                      className={`space-y-1.5 ${
                        lockedForViewer ? 'protected-media-guard no-touch-callout' : ''
                      }`}
                      onContextMenu={(e) => {
                        if (lockedForViewer) e.preventDefault();
                      }}
                    >
                      {msg.text && msg.text !== msg.fileName && (
                        <p className="text-sm leading-snug mb-1">{msg.text}</p>
                      )}
                      <div
                        onClick={() => {
                          if (lockedForViewer && inlineShieldActive) return;
                          openTeamMediaInLightbox(msg);
                        }}
                        className="relative rounded-xl overflow-hidden cursor-zoom-in group bg-black/10"
                      >
                        <img
                          src={msg.mediaUrl}
                          alt={msg.fileName || 'Team Photo'}
                          draggable={!lockedForViewer}
                          className="max-h-64 w-full object-cover rounded-xl select-none"
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
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        {lockedForViewer ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900/75 text-amber-200 font-bold text-[10px]">
                            <Lock className="w-3 h-3" />
                            <span>{t('mediaProtected')}</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSaveTeamAttachment(msg)}
                            className={`ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold ${
                              isMine ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC]'
                            }`}
                          >
                            <Download className="w-3 h-3" />
                            <span>{t('saveToGallery')}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* VIDEO */}
                  {msg.type === 'video' && msg.mediaUrl && (
                    <div
                      className={`space-y-1.5 ${
                        lockedForViewer ? 'protected-media-guard no-touch-callout' : ''
                      }`}
                      onContextMenu={(e) => {
                        if (lockedForViewer) e.preventDefault();
                      }}
                    >
                      {msg.text && msg.text !== msg.fileName && (
                        <p className="text-sm leading-snug mb-1">{msg.text}</p>
                      )}
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
                          onClick={() => openTeamMediaInLightbox(msg)}
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
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => openTeamMediaInLightbox(msg)}
                          className="truncate opacity-85 hover:underline text-left font-semibold"
                        >
                          {msg.fileName || 'Video'}
                        </button>
                        {lockedForViewer ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900/75 text-amber-200 font-bold text-[10px] shrink-0">
                            <Lock className="w-3 h-3" />
                            <span>{t('mediaProtected')}</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSaveTeamAttachment(msg)}
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold shrink-0 ${
                              isMine ? 'bg-white/20 text-white' : 'bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC]'
                            }`}
                          >
                            <Download className="w-3 h-3" />
                            <span>{t('downloadImage')}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* MUSIC / AUDIO */}
                  {msg.type === 'audio' && msg.mediaUrl && (
                    <div className="space-y-1.5 min-w-[230px]">
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <Music className="w-4 h-4 shrink-0" />
                        <span className="truncate">{msg.fileName || 'Audio / Music'}</span>
                      </div>
                      <audio
                        src={msg.mediaUrl}
                        controls
                        controlsList={lockedForViewer ? 'nodownload' : undefined}
                        className="w-full h-9"
                      />
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="opacity-75">{formatBytes(msg.fileSize)}</span>
                        {lockedForViewer ? (
                          <span className="inline-flex items-center gap-1 text-amber-200 font-bold">
                            <Lock className="w-3 h-3" /> {t('mediaProtected')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSaveTeamAttachment(msg)}
                            className="inline-flex items-center gap-1 font-bold underline"
                          >
                            <Download className="w-3 h-3" /> {t('downloadImage')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* PDF */}
                  {msg.type === 'pdf' && (
                    <div className="space-y-1.5 min-w-[220px]">
                      <div
                        className={`p-2.5 rounded-xl flex items-center gap-2.5 ${
                          isMine ? 'bg-white/15' : 'bg-slate-100 dark:bg-[#2a244b]'
                        }`}
                      >
                        <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold truncate">{msg.fileName || 'Document.pdf'}</p>
                          <p className="text-[10px] opacity-75">{formatBytes(msg.fileSize) || 'PDF'}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setViewingPdfMsg(msg)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold ${
                            isMine ? 'bg-white/20 text-white' : 'bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC]'
                          }`}
                        >
                          <Eye className="w-3 h-3" />
                          <span>Read PDF</span>
                        </button>
                        {lockedForViewer ? (
                          <span className="inline-flex items-center gap-1 text-amber-200 text-[10px] font-bold">
                            <Lock className="w-3 h-3" /> Protected
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSaveTeamAttachment(msg)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold ${
                              isMine ? 'bg-white/20 text-white' : 'bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC]'
                            }`}
                          >
                            <Download className="w-3 h-3" />
                            <span>{t('downloadImage')}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Footer Actions Row: Reply + 8 Emoji React + Delete + Timestamp */}
                  <div
                    className={`flex items-center justify-between gap-3 mt-1.5 pt-1 border-t text-[10px] ${
                      isMine ? 'border-white/15 text-white/80' : 'border-slate-100 dark:border-purple-900/40 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setReplyingTo(msg)}
                        className="hover:underline flex items-center gap-0.5 font-semibold"
                      >
                        <Reply className="w-3 h-3" />
                        <span>{t('reply')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveReactionMsgId((prev) =>
                            prev === msg.messageId ? null : msg.messageId
                          )
                        }
                        className="hover:underline flex items-center gap-0.5 font-semibold"
                      >
                        <Smile className="w-3 h-3" />
                      </button>
                      {(isMine || isAdmin) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteTeamMessage(msg)}
                          className="hover:text-rose-400"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <span>
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>

                {/* Inline 8-Emoji Reaction Picker when opened */}
                {activeReactionMsgId === msg.messageId && (
                  <div className="mt-1 px-2 py-1 rounded-2xl bg-white dark:bg-[#1f1b38] border border-slate-200 dark:border-purple-800 shadow-md flex items-center gap-1">
                    {REACTION_EMOJIS_8.map((item) => (
                      <button
                        key={item.emoji}
                        type="button"
                        onClick={() => handleToggleTeamReaction(msg, item.emoji)}
                        className="text-base p-1 hover:scale-125 transition-transform"
                      >
                        {item.emoji}
                      </button>
                    ))}
                  </div>
                )}

                {/* Reaction Pills */}
                {reactionEntries.length > 0 && (
                  <div className={`flex items-center gap-1 mt-1 flex-wrap ${isMine ? 'justify-end' : 'justify-start'}`}>
                    {reactionEntries.map(([emoji, uids]) => {
                      const reacted = userProfile ? uids.includes(userProfile.userId) : false;
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleToggleTeamReaction(msg, emoji)}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 border ${
                            reacted
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

      {/* Bottom Composer or Closed Messaging Banner */}
      {!canSendMessages ? (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-900/40 flex items-center justify-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-300 safe-bottom">
          <Lock className="w-4 h-4 shrink-0" />
          <span>{t('teamMessagingClosedBanner')}</span>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#16132b] border-t border-slate-200/80 dark:border-purple-950/40 safe-bottom relative">
          {mediaError && (
            <div className="px-4 py-2 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-900/40 flex items-center justify-between gap-2 text-xs text-rose-600 dark:text-rose-300 font-semibold">
              <div className="flex items-center gap-1.5 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="truncate">{mediaError}</span>
              </div>
              <button type="button" onClick={() => setMediaError(null)}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Replying-to Banner */}
          {replyingTo && (
            <div className="px-4 py-2 bg-[#7560DF]/10 border-b border-[#7560DF]/20 flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <p className="font-bold text-[#7560DF] dark:text-[#B09EFC]">
                  {t('replyingTo')} {replyingTo.senderDisplayName}
                </p>
                <p className="text-slate-600 dark:text-slate-300 truncate">
                  {replyingTo.type === 'text' ? replyingTo.text : replyingTo.fileName || replyingTo.type}
                </p>
              </div>
              <button type="button" onClick={() => setReplyingTo(null)} className="p-1 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Selected Up-to-10 Attachments Batch Draft Tray + Prevent Download Toggle */}
          {pendingAttachments.length > 0 && (
            <div className="p-3 border-b border-slate-100 dark:border-purple-950/40 space-y-2.5 bg-slate-50/80 dark:bg-[#1a1633]">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  Selected Attachments ({pendingAttachments.length}/10)
                </span>
                <button
                  type="button"
                  onClick={() => setPendingAttachments([])}
                  className="text-rose-500 font-bold hover:underline"
                >
                  Clear all
                </button>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {pendingAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="relative shrink-0 w-20 h-20 rounded-2xl border border-slate-200 dark:border-purple-800 overflow-hidden bg-white dark:bg-[#241f42] flex flex-col items-center justify-center p-1"
                  >
                    {att.type === 'image' ? (
                      <img src={att.mediaUrl} alt={att.fileName} className="w-full h-full object-cover rounded-xl" />
                    ) : att.type === 'video' ? (
                      <Film className="w-6 h-6 text-blue-500" />
                    ) : att.type === 'audio' ? (
                      <Music className="w-6 h-6 text-amber-500" />
                    ) : (
                      <FileText className="w-6 h-6 text-rose-500" />
                    )}
                    {att.type !== 'image' && (
                      <span className="text-[9px] font-bold truncate w-full text-center px-1 mt-1">
                        {att.fileName}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setPendingAttachments((prev) => prev.filter((x) => x.id !== att.id))
                      }
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Sender Prevent Download Switch */}
              <div className="p-2.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/40 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>{t('preventDownloadLabel')}</span>
                  </p>
                  <p className="text-[10px] text-slate-600 dark:text-slate-300">
                    Members can view/play inside Team only; downloading disabled.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreventDownload((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                    preventDownload ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      preventDownload ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* 30sec Self-Destruct Ephemeral Media Switch */}
              <div className="p-2.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/40 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span>{t('ephemeral30sLabel')}</span>
                  </p>
                  <p className="text-[10px] text-slate-600 dark:text-slate-300">
                    {t('ephemeral30sDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEphemeral30s((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                    ephemeral30s ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      ephemeral30s ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* 4-Option File Attachment Popover (Photo, Video, Music, PDF — up to 10 each) */}
          {showFilePickerMenu && (
            <div className="px-4 py-3 border-b border-slate-100 dark:border-purple-950/40 bg-white dark:bg-[#1a1633] flex items-center justify-around gap-2">
              <button
                type="button"
                onClick={() => photoPickerRef.current?.click()}
                className="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-[#241f42] text-xs font-bold text-slate-700 dark:text-slate-200"
              >
                <div className="w-10 h-10 rounded-full bg-[#7560DF]/15 text-[#7560DF] flex items-center justify-center">
                  <ImageIcon className="w-5 h-5" />
                </div>
                <span>{t('photo')}</span>
              </button>

              <button
                type="button"
                onClick={() => videoPickerRef.current?.click()}
                className="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-[#241f42] text-xs font-bold text-slate-700 dark:text-slate-200"
              >
                <div className="w-10 h-10 rounded-full bg-blue-500/15 text-blue-500 flex items-center justify-center">
                  <Film className="w-5 h-5" />
                </div>
                <span>{t('video')}</span>
              </button>

              <button
                type="button"
                onClick={() => audioPickerRef.current?.click()}
                className="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-[#241f42] text-xs font-bold text-slate-700 dark:text-slate-200"
              >
                <div className="w-10 h-10 rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center">
                  <Music className="w-5 h-5" />
                </div>
                <span>{t('teamMusic')}</span>
              </button>

              <button
                type="button"
                onClick={() => pdfPickerRef.current?.click()}
                className="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-[#241f42] text-xs font-bold text-slate-700 dark:text-slate-200"
              >
                <div className="w-10 h-10 rounded-full bg-rose-500/15 text-rose-500 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <span>{t('teamPdf')}</span>
              </button>
            </div>
          )}

          {/* Hidden Multi-File Inputs */}
          <input
            ref={photoPickerRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleSelectBatchFiles(e, 'image')}
          />
          <input
            ref={videoPickerRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => handleSelectBatchFiles(e, 'video')}
          />
          <input
            ref={audioPickerRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(e) => handleSelectBatchFiles(e, 'audio')}
          />
          <input
            ref={pdfPickerRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => handleSelectBatchFiles(e, 'pdf')}
          />

          <div className="p-2.5 sm:p-3">
            {isRecordingAudio ? (
              <AudioRecorder
                onSendVoiceNote={handleSendTeamVoice}
                onCancel={() => setIsRecordingAudio(false)}
              />
            ) : (
              <form onSubmit={handleSendTeamMessages} className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={isProcessingMedia}
                  onClick={() => setShowFilePickerMenu((v) => !v)}
                  className={`p-2.5 rounded-full transition-colors shrink-0 ${
                    showFilePickerMenu
                      ? 'bg-[#7560DF] text-white'
                      : 'text-slate-500 hover:text-[#7560DF] hover:bg-slate-100 dark:hover:bg-purple-900/30'
                  }`}
                  title={t('teamUpTo10Files')}
                >
                  {isProcessingMedia ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Paperclip className="w-5 h-5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setIsRecordingAudio(true)}
                  className="p-2.5 rounded-full text-slate-500 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors shrink-0"
                  title="Voice Note"
                >
                  <Mic className="w-5 h-5" />
                </button>

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={`Message ${liveTeam.name}...`}
                  className="flex-1 min-w-0 px-3.5 py-2.5 rounded-full bg-slate-100 dark:bg-[#201c38] text-slate-800 dark:text-slate-100 text-sm outline-none focus:ring-2 focus:ring-[#7560DF] placeholder:text-slate-400"
                />

                <button
                  type="submit"
                  disabled={sending || (!inputText.trim() && pendingAttachments.length === 0)}
                  className="p-2.5 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white disabled:opacity-40 shadow-sm shrink-0"
                >
                  {sending ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Send className="w-4.5 h-4.5" />}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* In-App PDF Reader Modal (Respects Prevent Download lock) */}
      {viewingPdfMsg && (
        <div
          onClick={() => setViewingPdfMsg(null)}
          onContextMenu={(e) => {
            if (viewingPdfMsg.preventDownload && viewingPdfMsg.senderId !== userProfile?.userId) {
              e.preventDefault();
            }
          }}
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex flex-col p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-2xl w-full mx-auto flex-1 bg-white dark:bg-[#16132b] rounded-3xl overflow-hidden flex flex-col border border-purple-900/40"
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-purple-950/40 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {viewingPdfMsg.fileName || 'Document.pdf'}
                </p>
                {viewingPdfMsg.preventDownload && viewingPdfMsg.senderId !== userProfile?.userId && (
                  <p className="text-[10px] font-bold text-amber-500 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> {t('mediaProtected')}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setViewingPdfMsg(null)}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-purple-900/30"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <iframe
              src={
                viewingPdfMsg.preventDownload && viewingPdfMsg.senderId !== userProfile?.userId
                  ? `${viewingPdfMsg.mediaUrl}#toolbar=0&navpanes=0`
                  : viewingPdfMsg.mediaUrl
              }
              title={viewingPdfMsg.fileName || 'PDF Viewer'}
              className="flex-1 w-full bg-slate-100 dark:bg-slate-900"
            />
          </div>
        </div>
      )}

      {/* Live 10-Seat Voice & Video Chat Stage Modal */}
      {isLiveStageOpen && userProfile && (
        <TeamLiveStageModal
          team={liveTeam}
          currentUser={userProfile}
          members={members}
          onClose={() => setIsLiveStageOpen(false)}
        />
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
                  lightboxMedia.fileName || `team_${lightboxMedia.messageId}.${ext}`,
                  lightboxMedia.mimeType
                );
                showToast(t('downloadImage'));
              }
            : undefined
        }
        onClose={() => setLightboxMedia(null)}
        onExpired={() => setNowTick(Date.now())}
      />

      {toastMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-slate-900 dark:bg-[#7560DF] text-white text-xs font-bold shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  );
};
