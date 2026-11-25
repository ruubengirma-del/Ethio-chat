import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import {
  collection,
  doc,
  query,
  where,
  getDocs,
  writeBatch,
  setDoc
} from 'firebase/firestore';
import { Team, TeamMember, TeamMessage, UserProfile } from '../../types';
import { compressImage } from '../../lib/mediaCompression';
import { createAppNotification } from '../../lib/socialHelpers';
import {
  X,
  Users,
  Search,
  Check,
  Globe,
  Lock,
  Loader2,
  Camera,
  AtSign,
  AlertCircle,
  CheckCircle2,
  Sparkles
} from 'lucide-react';

interface CreateTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTeamCreated: (team: Team) => void;
}

export const CreateTeamModal: React.FC<CreateTeamModalProps> = ({
  isOpen,
  onClose,
  onTeamCreated,
}) => {
  const { currentUser, userProfile, allUsers } = useAuth();
  const { t } = useLanguage();

  const [teamName, setTeamName] = useState('');
  const [description, setDescription] = useState('');
  const [photoURL, setPhotoURL] = useState<string>('');
  const [isPublic, setIsPublic] = useState(true);
  const [teamUsername, setTeamUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
  }, [isOpen]);

  // Real-time unique @teamUsername validation when Public is selected
  useEffect(() => {
    if (!isPublic) {
      setUsernameStatus('idle');
      return;
    }
    const cleaned = teamUsername.trim().replace(/^@+/, '').toLowerCase();
    if (!cleaned) {
      setUsernameStatus('idle');
      return;
    }
    if (!/^[a-z0-9_]{3,35}$/.test(cleaned)) {
      setUsernameStatus('invalid');
      return;
    }

    let cancelled = false;
    setUsernameStatus('checking');

    const timer = setTimeout(async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'teams'), where('teamUsernameLower', '==', cleaned))
        );
        if (cancelled) return;
        setUsernameStatus(snap.empty ? 'available' : 'taken');
      } catch {
        if (!cancelled) setUsernameStatus('idle');
      }
    }, 320);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [teamUsername, isPublic]);

  const otherUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allUsers
      .filter((u) => u.userId !== currentUser?.uid)
      .filter((u) => {
        if (!q) return true;
        return (
          u.username.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q)
        );
      });
  }, [allUsers, currentUser, searchQuery]);

  if (!isOpen) return null;

  const toggleMember = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSelectLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingLogo(true);
    setErrorMsg(null);
    try {
      const res = await compressImage(file, 420, 420, 0.8);
      setPhotoURL(res.dataUrl);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not process team logo.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !userProfile || submitting) return;

    const trimmedName = teamName.trim();
    if (!trimmedName) {
      setErrorMsg('Please enter a Team name.');
      return;
    }

    const cleanHandle = teamUsername.trim().replace(/^@+/, '');
    const lowerHandle = cleanHandle.toLowerCase();

    if (isPublic) {
      if (!/^[a-z0-9_]{3,35}$/.test(lowerHandle)) {
        setErrorMsg('Public Teams require a valid @username (3-35 letters, numbers, or _).');
        return;
      }
      // Double-check uniqueness strictly before creation
      const dupCheck = await getDocs(
        query(collection(db, 'teams'), where('teamUsernameLower', '==', lowerHandle))
      );
      if (!dupCheck.empty) {
        setUsernameStatus('taken');
        setErrorMsg(t('teamUsernameTaken'));
        return;
      }
    }

    setErrorMsg(null);
    setSubmitting(true);

    try {
      const now = new Date().toISOString();
      const teamId = `team_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const uniqueSelected = Array.from(new Set(selectedUserIds.filter((id) => id !== currentUser.uid)));
      const totalCount = 1 + uniqueSelected.length;

      const teamData: Team = {
        teamId,
        name: trimmedName,
        nameLower: trimmedName.toLowerCase(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(photoURL ? { photoURL } : {}),
        isPublic,
        ...(isPublic
          ? {
              teamUsername: cleanHandle,
              teamUsernameLower: lowerHandle,
            }
          : {}),
        ownerId: currentUser.uid,
        adminIds: [currentUser.uid],
        memberCount: totalCount,
        maxMembers: 70000000,
        messagingLocked: false,
        lastMessage: `${userProfile.displayName} created Team "${trimmedName}"`,
        lastMessageTime: now,
        lastSenderId: currentUser.uid,
        liveRoom: {
          active: false,
          mode: 'voice',
          liveCommentsEnabled: true,
        },
        createdAt: now,
        updatedAt: now,
      };

      await setDoc(doc(db, 'teams', teamId), teamData);

      // Build member documents (supports chunked batches up to 70,000,000 members)
      const memberDocs: TeamMember[] = [
        {
          userId: userProfile.userId,
          teamId,
          username: userProfile.username,
          displayName: userProfile.displayName,
          ...(userProfile.photoURL ? { photoURL: userProfile.photoURL } : {}),
          role: 'owner',
          joinedAt: now,
        },
      ];

      uniqueSelected.forEach((uid) => {
        const u = allUsers.find((usr: UserProfile) => usr.userId === uid);
        if (u) {
          memberDocs.push({
            userId: u.userId,
            teamId,
            username: u.username,
            displayName: u.displayName,
            ...(u.photoURL ? { photoURL: u.photoURL } : {}),
            role: 'member',
            joinedAt: now,
          });
        }
      });

      const CHUNK_SIZE = 400;
      for (let i = 0; i < memberDocs.length; i += CHUNK_SIZE) {
        const batch = writeBatch(db);
        const slice = memberDocs.slice(i, i + CHUNK_SIZE);
        slice.forEach((m) => {
          batch.set(doc(db, 'teams', teamId, 'members', m.userId), m);
        });
        await batch.commit();
      }

      // Create initial welcome message inside Team (strictly private to members)
      const welcomeMsgId = `tmsg_welcome_${Date.now()}`;
      const welcomeMsg: TeamMessage = {
        messageId: welcomeMsgId,
        teamId,
        senderId: userProfile.userId,
        senderUsername: userProfile.username,
        senderDisplayName: userProfile.displayName,
        ...(userProfile.photoURL ? { senderPhotoURL: userProfile.photoURL } : {}),
        type: 'text',
        text: `Welcome to ${trimmedName}! Team created (${totalCount} member${totalCount === 1 ? '' : 's'} · up to 70,000,000 capacity).`,
        createdAt: now,
      };
      await setDoc(doc(db, 'teams', teamId, 'messages', welcomeMsgId), welcomeMsg);

      // Notify added members
      await Promise.all(
        uniqueSelected.slice(0, 50).map((uid) =>
          createAppNotification({
            recipientId: uid,
            actor: userProfile,
            type: 'team',
            chatId: teamId,
            text: `added you to Team "${trimmedName}"`,
          })
        )
      );

      // Reset & enter Team immediately
      setTeamName('');
      setDescription('');
      setPhotoURL('');
      setTeamUsername('');
      setSelectedUserIds([]);
      setSearchQuery('');
      onTeamCreated(teamData);
    } catch (err: any) {
      console.error('Failed to create team:', err);
      setErrorMsg(err?.message || 'Could not create Team. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-200/80 dark:border-purple-950/60 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between bg-gradient-to-r from-[#7560DF]/12 to-transparent">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[#7560DF] text-white flex items-center justify-center shadow-md shadow-[#7560DF]/25">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                {t('createTeam')}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Up to 70,000,000 members · Private member space
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-purple-950/40 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreateTeam} className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Team Logo / Photo Picker + Name */}
          <div className="flex items-center gap-4">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleSelectLogo}
            />
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
              className="relative w-18 h-18 rounded-2xl bg-gradient-to-tr from-[#7560DF]/20 to-[#9E8CF8]/25 border-2 border-dashed border-[#7560DF]/50 flex items-center justify-center shrink-0 overflow-hidden hover:border-[#7560DF] transition-colors group"
              title="Upload Team Logo or Photo"
            >
              {photoURL ? (
                <img src={photoURL} alt="Team Logo" className="w-full h-full object-cover" />
              ) : uploadingLogo ? (
                <Loader2 className="w-6 h-6 animate-spin text-[#7560DF]" />
              ) : (
                <div className="flex flex-col items-center gap-0.5 text-[#7560DF]">
                  <Camera className="w-5 h-5" />
                  <span className="text-[10px] font-bold">Logo</span>
                </div>
              )}
            </button>

            <div className="flex-1 space-y-2 min-w-0">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Team Name *
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="e.g. Oromia Tech Team..."
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
                />
              </div>
              {photoURL && (
                <button
                  type="button"
                  onClick={() => setPhotoURL('')}
                  className="text-[11px] font-semibold text-rose-500 hover:underline"
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Description (Optional)
            </label>
            <input
              type="text"
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happens inside this Team?"
              className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
            />
          </div>

          {/* Public vs Private Selection */}
          <div className="space-y-2.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Team Privacy
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setIsPublic(true)}
                className={`p-3 rounded-2xl border text-left transition-all flex flex-col gap-1 ${
                  isPublic
                    ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500'
                    : 'border-slate-200 dark:border-purple-900/50 bg-slate-50 dark:bg-[#201c38]'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900 dark:text-white">
                  <Globe className={`w-4 h-4 ${isPublic ? 'text-emerald-500' : 'text-slate-400'}`} />
                  <span>Public</span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                  Requires unique @username
                </p>
              </button>

              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className={`p-3 rounded-2xl border text-left transition-all flex flex-col gap-1 ${
                  !isPublic
                    ? 'border-[#7560DF] bg-[#7560DF]/10 ring-1 ring-[#7560DF]'
                    : 'border-slate-200 dark:border-purple-900/50 bg-slate-50 dark:bg-[#201c38]'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900 dark:text-white">
                  <Lock className={`w-4 h-4 ${!isPublic ? 'text-[#7560DF]' : 'text-slate-400'}`} />
                  <span>Private</span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                  Members added inside only
                </p>
              </button>
            </div>

            {isPublic && (
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Unique Public Team @Username *
                </label>
                <div className="relative">
                  <AtSign className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7560DF]" />
                  <input
                    type="text"
                    required={isPublic}
                    maxLength={36}
                    value={teamUsername}
                    onChange={(e) => setTeamUsername(e.target.value.replace(/\s+/g, ''))}
                    placeholder="e.g. oromia_developers"
                    className="w-full pl-9 pr-10 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
                  />
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                    {usernameStatus === 'checking' && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                    {usernameStatus === 'available' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    {(usernameStatus === 'taken' || usernameStatus === 'invalid') && (
                      <AlertCircle className="w-4 h-4 text-rose-500" />
                    )}
                  </div>
                </div>
                {usernameStatus === 'taken' && (
                  <p className="text-[11px] font-bold text-rose-500">{t('teamUsernameTaken')}</p>
                )}
                {usernameStatus === 'invalid' && (
                  <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    Use 3–35 letters, numbers, or underscores (_) only.
                  </p>
                )}
                {usernameStatus === 'available' && (
                  <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                    @{teamUsername.replace(/^@+/, '').toLowerCase()} is available!
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Add Members Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Add Members ({selectedUserIds.length + 1} / 70,000,000)
              </label>
              <span className="text-[11px] text-[#7560DF] font-semibold">
                Owner included
              </span>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search users to add to this Team..."
                className="w-full pl-9 pr-4 py-2 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
              />
            </div>

            <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
              {otherUsers.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">
                  No matching users found. You can also add up to 70,000,000 members anytime inside the Team!
                </p>
              ) : (
                otherUsers.map((u) => {
                  const isSelected = selectedUserIds.includes(u.userId);
                  return (
                    <button
                      key={u.userId}
                      type="button"
                      onClick={() => toggleMember(u.userId)}
                      className={`w-full p-2.5 rounded-2xl border flex items-center justify-between gap-3 transition-all text-left ${
                        isSelected
                          ? 'border-[#7560DF] bg-[#7560DF]/10'
                          : 'border-slate-200/80 dark:border-purple-950/50 hover:bg-slate-50 dark:hover:bg-purple-950/20'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={u.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`}
                          alt={u.displayName}
                          className="w-8 h-8 rounded-full object-cover shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {u.displayName}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">@{u.username}</p>
                        </div>
                      </div>
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-[#7560DF] text-white'
                            : 'border-2 border-slate-300 dark:border-purple-800'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              !teamName.trim() ||
              (isPublic && (usernameStatus === 'taken' || usernameStatus === 'invalid' || !teamUsername.trim()))
            }
            className="w-full py-3 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-sm shadow-md shadow-[#7560DF]/25 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Creating Team...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>{t('createTeam')} & Enter</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
