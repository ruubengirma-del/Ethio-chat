import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { X, Ban, ShieldCheck } from 'lucide-react';

interface BlockedUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BlockedUsersModal: React.FC<BlockedUsersModalProps> = ({ isOpen, onClose }) => {
  const { blockedUsers, unblockUser } = useAuth();
  const { t } = useLanguage();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-200/80 dark:border-purple-950/60 overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-rose-500/15 text-rose-500 flex items-center justify-center">
              <Ban className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                {t('blockedUsers')} ({blockedUsers.length})
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {blockedUsers.length} user(s) currently blocked
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
          {blockedUsers.length === 0 ? (
            <div className="py-10 text-center text-slate-400 space-y-2">
              <ShieldCheck className="w-10 h-10 mx-auto text-emerald-500 opacity-70" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                No blocked users
              </p>
              <p className="text-xs max-w-xs mx-auto">
                When you block someone from their profile or chat, they will appear here and you can unblock them anytime.
              </p>
            </div>
          ) : (
            blockedUsers.map((b) => (
              <div
                key={b.blockedUserId}
                className="p-3 rounded-2xl border border-slate-200/80 dark:border-purple-950/50 bg-slate-50/70 dark:bg-[#201c38] flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={b.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${b.username}`}
                    alt={b.displayName}
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-slate-900 dark:text-white truncate">
                      {b.displayName}
                    </p>
                    <p className="text-xs text-slate-400 truncate">@{b.username}</p>
                  </div>
                </div>

                <button
                  onClick={() => unblockUser(b.blockedUserId)}
                  className="px-3.5 py-1.5 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold shrink-0 transition-colors"
                >
                  {t('unblockUser')}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
