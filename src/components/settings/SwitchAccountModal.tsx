import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  X,
  UserPlus,
  Check,
  Trash2,
  Users
} from 'lucide-react';

interface SwitchAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SwitchAccountModal: React.FC<SwitchAccountModalProps> = ({ isOpen, onClose }) => {
  const {
    currentUser,
    savedAccounts,
    switchSavedAccount,
    removeSavedAccount,
    openAddAccount,
  } = useAuth();
  const { t } = useLanguage();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-200/80 dark:border-purple-950/60 overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#7560DF]/15 text-[#7560DF] flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                {t('switchAccount')}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {savedAccounts.length} saved account(s) on this device
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto flex-1">
          {savedAccounts.map((acc) => {
            const isActive = acc.uid === currentUser?.uid;
            return (
              <div
                key={acc.uid}
                className={`p-3 rounded-2xl border flex items-center justify-between gap-3 transition-all ${
                  isActive
                    ? 'border-[#7560DF] bg-[#7560DF]/10'
                    : 'border-slate-200/80 dark:border-purple-950/50 hover:bg-slate-50 dark:hover:bg-purple-950/20'
                }`}
              >
                <button
                  onClick={async () => {
                    await switchSavedAccount(acc);
                    onClose();
                  }}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <img
                    src={acc.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${acc.username}`}
                    alt={acc.displayName}
                    className="w-11 h-11 rounded-full object-cover ring-2 ring-[#7560DF]/30 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-slate-900 dark:text-white truncate">
                      {acc.displayName}
                    </p>
                    <p className="text-xs text-[#7560DF] dark:text-[#A798F8] truncate">
                      @{acc.username}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">{acc.email}</p>
                  </div>
                </button>

                <div className="flex items-center gap-1.5 shrink-0">
                  {isActive ? (
                    <span className="px-2.5 py-1 rounded-full bg-[#7560DF] text-white text-[11px] font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      <span>Active</span>
                    </span>
                  ) : (
                    <button
                      onClick={() => removeSavedAccount(acc.uid)}
                      className="p-2 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      title="Remove from saved list"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <button
            onClick={() => {
              onClose();
              openAddAccount();
            }}
            className="w-full py-3 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-sm shadow-md shadow-[#7560DF]/25 flex items-center justify-center gap-2 transition-all mt-2"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add Account</span>
          </button>
        </div>
      </div>
    </div>
  );
};
