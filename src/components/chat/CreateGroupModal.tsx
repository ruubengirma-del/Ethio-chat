import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  increment
} from 'firebase/firestore';
import { SocialGroup } from '../../types';
import { compressImage } from '../../lib/mediaCompression';
import {
  X,
  Users,
  Search,
  Check,
  Globe,
  Loader2,
  Sparkles,
  Trash2,
  Crown,
  Plus,
  Camera,
  ArrowRight
} from 'lucide-react';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenGroup: (group: SocialGroup) => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
  onOpenGroup
}) => {
  const { currentUser, userProfile } = useAuth();
  const { t } = useLanguage();

  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupPhoto, setGroupPhoto] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [allGroups, setAllGroups] = useState<SocialGroup[]>([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to all Groups for Search, Owner list, and Joined list
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

  const myOwnedGroups = useMemo(() => {
    if (!currentUser) return [];
    return allGroups.filter((g) => g.ownerId === currentUser.uid);
  }, [allGroups, currentUser]);

  const myJoinedGroups = useMemo(() => {
    if (!currentUser) return [];
    return allGroups.filter(
      (g) => g.ownerId !== currentUser.uid && (g.memberIds || []).includes(currentUser.uid)
    );
  }, [allGroups, currentUser]);

  const searchedGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) {
      return allGroups.filter(
        (g) => !currentUser || !(g.memberIds || []).includes(currentUser.uid)
      );
    }
    return allGroups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.description || '').toLowerCase().includes(q)
    );
  }, [allGroups, groupSearch, currentUser]);

  if (!isOpen) return null;

  const handleSelectPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const res = await compressImage(file, 420, 420, 0.78);
      setGroupPhoto(res.dataUrl);
    } catch {
      // ignore
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !userProfile || submitting) return;
    const trimmedName = groupName.trim();
    if (!trimmedName) {
      setErrorMsg('Please enter a group name.');
      return;
    }

    setErrorMsg(null);
    setSubmitting(true);

    try {
      const now = new Date().toISOString();
      const groupId = `grp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      const newGroup: SocialGroup = {
        groupId,
        name: trimmedName.slice(0, 80),
        nameLower: trimmedName.slice(0, 80).toLowerCase(),
        ...(groupDescription.trim() ? { description: groupDescription.trim().slice(0, 300) } : {}),
        ...(groupPhoto ? { photoURL: groupPhoto } : {}),
        ownerId: currentUser.uid,
        adminIds: [currentUser.uid],
        memberIds: [currentUser.uid],
        memberCount: 1,
        postingLocked: false,
        createdAt: now,
        updatedAt: now,
      };

      await setDoc(doc(db, 'groups', groupId), newGroup);

      setGroupName('');
      setGroupDescription('');
      setGroupPhoto('');
      onOpenGroup(newGroup);
    } catch (err: any) {
      console.error('Failed to create group:', err);
      setErrorMsg(err?.message || 'Could not create group. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinAndEnter = async (group: SocialGroup) => {
    if (!currentUser || busyGroupId) return;
    if ((group.memberIds || []).includes(currentUser.uid) || group.ownerId === currentUser.uid) {
      onOpenGroup(group);
      return;
    }
    setBusyGroupId(group.groupId);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'groups', group.groupId), {
        memberIds: arrayUnion(currentUser.uid),
        memberCount: increment(1),
        updatedAt: now,
      });
      onOpenGroup({
        ...group,
        memberIds: Array.from(new Set([...(group.memberIds || []), currentUser.uid])),
        memberCount: (group.memberCount || 0) + 1,
        updatedAt: now,
      });
    } finally {
      setBusyGroupId(null);
    }
  };

  const handleLeaveJoinedGroup = async (group: SocialGroup) => {
    if (!currentUser || busyGroupId || group.ownerId === currentUser.uid) return;
    setBusyGroupId(group.groupId);
    try {
      await updateDoc(doc(db, 'groups', group.groupId), {
        memberIds: arrayRemove(currentUser.uid),
        memberCount: increment(-1),
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setBusyGroupId(null);
    }
  };

  const handleDeleteOwnedGroup = async (groupId: string) => {
    if (busyGroupId) return;
    setBusyGroupId(groupId);
    try {
      await deleteDoc(doc(db, 'groups', groupId));
      setConfirmDeleteId(null);
    } finally {
      setBusyGroupId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200/80 dark:border-purple-950/60 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between bg-gradient-to-r from-[#7560DF]/10 to-transparent">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#7560DF] text-white flex items-center justify-center shadow-md shadow-[#7560DF]/25">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                {t('createGroup')}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('createGroupDesc')}
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

        {/* Scrollable Body */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* 1. Create Group Form */}
          <form onSubmit={handleCreateGroup} className="space-y-3 p-4 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200/80 dark:border-purple-900/50">
            <div className="flex items-center gap-3">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleSelectPhoto}
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="w-14 h-14 rounded-2xl bg-white dark:bg-[#16132b] border border-dashed border-[#7560DF] flex items-center justify-center overflow-hidden shrink-0"
                title="Group Photo"
              >
                {groupPhoto ? (
                  <img src={groupPhoto} alt="Group" className="w-full h-full object-cover" />
                ) : (
                  <Camera className="w-5 h-5 text-[#7560DF]" />
                )}
              </button>

              <div className="flex-1 space-y-1.5 min-w-0">
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Group Name *"
                  className="w-full px-3.5 py-2 rounded-xl bg-white dark:bg-[#16132b] border border-slate-200 dark:border-purple-900/50 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
                />
                <input
                  type="text"
                  maxLength={200}
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  placeholder="Description (Optional)"
                  className="w-full px-3.5 py-1.5 rounded-xl bg-white dark:bg-[#16132b] border border-slate-200 dark:border-purple-900/50 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
                />
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200/80 dark:border-emerald-900/40 flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 dark:text-white">
                  {t('publicGroupOnly')}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t('publicGroupOnlyDesc')}
                </p>
              </div>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 text-xs">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !groupName.trim()}
              className="w-full py-2.5 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-sm shadow-md shadow-[#7560DF]/25 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating Group...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{t('createGroup')}</span>
                </>
              )}
            </button>
          </form>

          {/* 2. Groups Created By You (Owner — Open or Delete) */}
          {myOwnedGroups.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Crown className="w-3.5 h-3.5 text-amber-500" />
                  <span>{t('myOwnedGroups')} ({myOwnedGroups.length})</span>
                </h4>
              </div>

              <div className="space-y-2">
                {myOwnedGroups.map((g) => (
                  <div
                    key={g.groupId}
                    className="p-3 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200/80 dark:border-purple-900/50 flex items-center justify-between gap-2.5"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenGroup(g)}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-left group"
                    >
                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] text-white flex items-center justify-center shrink-0">
                        {g.photoURL ? (
                          <img src={g.photoURL} alt={g.name} className="w-full h-full object-cover" />
                        ) : (
                          <Users className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] truncate">
                            {g.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 text-[10px] font-extrabold shrink-0">
                            {t('ownerBadge')}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {(g.memberCount || 1).toLocaleString()} {t('membersCount')}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {confirmDeleteId === g.groupId ? (
                        <>
                          <button
                            type="button"
                            disabled={busyGroupId === g.groupId}
                            onClick={() => handleDeleteOwnedGroup(g.groupId)}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold"
                          >
                            {t('yesBtn')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-xs font-bold"
                          >
                            {t('noBtn')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onOpenGroup(g)}
                            className="p-2 rounded-xl bg-[#7560DF]/10 text-[#7560DF] dark:text-[#B09EFC] hover:bg-[#7560DF]/20"
                            title="Open Group"
                          >
                            <ArrowRight className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(g.groupId)}
                            className="p-2 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 hover:bg-rose-500/25"
                            title={t('deleteGroup')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. Groups You Joined (Joined badge + Trash/Leave icon beside it) */}
          {myJoinedGroups.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{t('myJoinedGroups')} ({myJoinedGroups.length})</span>
                </h4>
              </div>

              <div className="space-y-2">
                {myJoinedGroups.map((g) => (
                  <div
                    key={g.groupId}
                    className="p-3 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200/80 dark:border-purple-900/50 flex items-center justify-between gap-2.5"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenGroup(g)}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-left group"
                    >
                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] text-white flex items-center justify-center shrink-0">
                        {g.photoURL ? (
                          <img src={g.photoURL} alt={g.name} className="w-full h-full object-cover" />
                        ) : (
                          <Users className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] truncate">
                            {g.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-extrabold shrink-0">
                            {t('joinedBadge')}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {(g.memberCount || 1).toLocaleString()} {t('membersCount')}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onOpenGroup(g)}
                        className="p-2 rounded-xl bg-[#7560DF]/10 text-[#7560DF] dark:text-[#B09EFC] hover:bg-[#7560DF]/20"
                        title="Open Group"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busyGroupId === g.groupId}
                        onClick={() => handleLeaveJoinedGroup(g)}
                        className="p-2 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 hover:bg-rose-500/25"
                        title={t('leaveGroup')}
                      >
                        {busyGroupId === g.groupId ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. Search & Join Groups (Search just like users + Join enters directly into Group) */}
          <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-purple-950/40">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300 px-1">
              {t('discoverGroupsTitle')}
            </h4>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={groupSearch}
                onChange={(e) => setGroupSearch(e.target.value)}
                placeholder="Search groups by name..."
                className="w-full pl-9 pr-4 py-2 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
              />
            </div>

            {searchedGroups.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">
                {groupSearch.trim()
                  ? `No groups matching "${groupSearch}"`
                  : 'Create a group above or search existing groups to join!'}
              </p>
            ) : (
              <div className="space-y-2">
                {searchedGroups.map((g) => {
                  const isAlreadyMember =
                    currentUser &&
                    (g.ownerId === currentUser.uid || (g.memberIds || []).includes(currentUser.uid));
                  return (
                    <div
                      key={g.groupId}
                      className="p-3 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200/80 dark:border-purple-900/50 flex items-center justify-between gap-2.5"
                    >
                      <div
                        onClick={() => isAlreadyMember && onOpenGroup(g)}
                        className={`flex items-center gap-2.5 min-w-0 flex-1 ${
                          isAlreadyMember ? 'cursor-pointer' : ''
                        }`}
                      >
                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] text-white flex items-center justify-center shrink-0">
                          {g.photoURL ? (
                            <img src={g.photoURL} alt={g.name} className="w-full h-full object-cover" />
                          ) : (
                            <Users className="w-5 h-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h5 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                            {g.name}
                          </h5>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {(g.memberCount || 1).toLocaleString()} {t('membersCount')}
                            {g.description ? ` · ${g.description}` : ''}
                          </p>
                        </div>
                      </div>

                      {isAlreadyMember ? (
                        <button
                          type="button"
                          onClick={() => onOpenGroup(g)}
                          className="px-3 py-1.5 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-bold shrink-0"
                        >
                          {t('joinedBadge')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyGroupId === g.groupId}
                          onClick={() => handleJoinAndEnter(g)}
                          className="px-3.5 py-2 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold shrink-0 flex items-center gap-1"
                        >
                          {busyGroupId === g.groupId ? (
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
          </div>
        </div>
      </div>
    </div>
  );
};
