import React, { useState } from 'react';
import { AudienceVisibility, UserProfile } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { Globe, Lock, Users, UserCheck, Check, Search, Save } from 'lucide-react';

interface AudienceSelectorProps {
  visibility: AudienceVisibility;
  excludedUserIds: string[];
  allowedUserIds: string[];
  onChange: (next: {
    visibility: AudienceVisibility;
    excludedUserIds: string[];
    allowedUserIds: string[];
  }) => void;
}

export const AudienceSelector: React.FC<AudienceSelectorProps> = ({
  visibility,
  excludedUserIds,
  allowedUserIds,
  onChange,
}) => {
  const { currentUser, allUsers, updateUserProfileData } = useAuth();
  const { t } = useLanguage();
  const [editingMode, setEditingMode] = useState<'close_friends' | 'select_friends' | null>(null);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const otherUsers = allUsers
    .filter((u: UserProfile) => u.userId !== currentUser?.uid)
    .filter((u) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q);
    });

  const handlePickMode = (mode: AudienceVisibility) => {
    if (mode === 'close_friends') {
      setDraftIds(excludedUserIds);
      setEditingMode('close_friends');
      onChange({ visibility: mode, excludedUserIds, allowedUserIds });
    } else if (mode === 'select_friends') {
      setDraftIds(allowedUserIds);
      setEditingMode('select_friends');
      onChange({ visibility: mode, excludedUserIds, allowedUserIds });
    } else {
      setEditingMode(null);
      onChange({ visibility: mode, excludedUserIds, allowedUserIds });
    }
  };

  const toggleUser = (uid: string) => {
    setDraftIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleSaveList = async () => {
    if (editingMode === 'close_friends') {
      onChange({
        visibility: 'close_friends',
        excludedUserIds: draftIds,
        allowedUserIds,
      });
      await updateUserProfileData({ closeFriendsExcludedIds: draftIds }).catch(() => {});
    } else if (editingMode === 'select_friends') {
      onChange({
        visibility: 'select_friends',
        excludedUserIds,
        allowedUserIds: draftIds,
      });
      await updateUserProfileData({ selectedFriendIds: draftIds }).catch(() => {});
    }
    setEditingMode(null);
  };

  const options: Array<{
    id: AudienceVisibility;
    label: string;
    desc: string;
    icon: React.ReactNode;
    count?: number;
  }> = [
    {
      id: 'public',
      label: t('audiencePublic'),
      desc: t('audiencePublicDesc'),
      icon: <Globe className="w-4 h-4 text-emerald-500" />,
    },
    {
      id: 'private',
      label: t('audiencePrivate'),
      desc: t('audiencePrivateDesc'),
      icon: <Lock className="w-4 h-4 text-amber-500" />,
    },
    {
      id: 'close_friends',
      label: t('audienceCloseFriends'),
      desc: t('audienceCloseFriendsDesc'),
      icon: <Users className="w-4 h-4 text-rose-500" />,
      count: excludedUserIds.length,
    },
    {
      id: 'select_friends',
      label: t('audienceSelectFriends'),
      desc: t('audienceSelectFriendsDesc'),
      icon: <UserCheck className="w-4 h-4 text-[#7560DF]" />,
      count: allowedUserIds.length,
    },
  ];

  return (
    <div className="space-y-2.5">
      <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
        {t('audienceLabel')}
      </p>

      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => {
          const active = visibility === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handlePickMode(opt.id)}
              className={`p-2.5 rounded-2xl border text-left transition-all flex items-start gap-2 ${
                active
                  ? 'border-[#7560DF] bg-[#7560DF]/10 ring-1 ring-[#7560DF]/40'
                  : 'border-slate-200 dark:border-purple-950/50 bg-slate-50/60 dark:bg-[#201c38] hover:border-[#7560DF]/40'
              }`}
            >
              <div className="mt-0.5 shrink-0">{opt.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {opt.label}
                  </span>
                  {typeof opt.count === 'number' && opt.count > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-[#7560DF] text-white text-[10px] font-bold">
                      {opt.count}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5">
                  {opt.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Friend Selection Drawer for Close Friends / Select Friends */}
      {editingMode && (
        <div className="p-3 rounded-2xl border border-[#7560DF]/40 bg-slate-50 dark:bg-[#201c38] space-y-2.5 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#7560DF] dark:text-[#B09EFC]">
              {editingMode === 'close_friends'
                ? 'Select Close Friends (will NOT see this)'
                : 'Select Friends (ONLY these people will see this)'}
            </span>
            <button
              type="button"
              onClick={handleSaveList}
              className="px-3 py-1 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold flex items-center gap-1 shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('saveSelection')} ({draftIds.length})</span>
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white dark:bg-[#16132b] border border-slate-200 dark:border-purple-900/50 text-xs outline-none focus:ring-1 focus:ring-[#7560DF]"
            />
          </div>

          <div className="max-h-36 overflow-y-auto space-y-1">
            {otherUsers.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-2">No other users found yet.</p>
            ) : (
              otherUsers.map((u) => {
                const picked = draftIds.includes(u.userId);
                return (
                  <button
                    key={u.userId}
                    type="button"
                    onClick={() => toggleUser(u.userId)}
                    className={`w-full px-2.5 py-2 rounded-xl flex items-center justify-between text-left transition-colors ${
                      picked ? 'bg-[#7560DF]/15' : 'hover:bg-white dark:hover:bg-[#16132b]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={u.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`}
                        alt={u.displayName}
                        className="w-7 h-7 rounded-full object-cover"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {u.displayName}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">@{u.username}</p>
                      </div>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                        picked
                          ? 'bg-[#7560DF] text-white'
                          : 'border border-slate-300 dark:border-purple-800'
                      }`}
                    >
                      {picked && <Check className="w-3 h-3" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
