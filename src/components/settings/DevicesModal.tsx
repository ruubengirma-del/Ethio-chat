import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { X, Smartphone, Monitor, Trash2, Shield } from 'lucide-react';

interface DevicesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DevicesModal: React.FC<DevicesModalProps> = ({ isOpen, onClose }) => {
  const { devices, currentDeviceId, removeDevice } = useAuth();
  const { t } = useLanguage();

  if (!isOpen) return null;

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-200/80 dark:border-purple-950/60 overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-blue-500/15 text-blue-500 flex items-center justify-center">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                {t('devicesTitle')} ({devices.length})
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Logged in on {devices.length} device(s)
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
          <div className="p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 flex items-start gap-2.5 text-xs text-blue-700 dark:text-blue-300">
            <Shield className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              If you notice an unfamiliar phone or browser logged into your account, tap <strong>Remove</strong> to disconnect it immediately.
            </span>
          </div>

          {devices.map((dev) => {
            const isCurrent = dev.deviceId === currentDeviceId;
            const isMobile = dev.platform === 'Android' || dev.platform === 'iOS';

            return (
              <div
                key={dev.deviceId}
                className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                  isCurrent
                    ? 'border-[#7560DF] bg-[#7560DF]/10'
                    : 'border-slate-200/80 dark:border-purple-950/50 bg-slate-50 dark:bg-[#201c38]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#16132b] border border-slate-200 dark:border-purple-900/40 flex items-center justify-center text-[#7560DF] shrink-0">
                    {isMobile ? <Smartphone className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {dev.deviceName}
                      </p>
                      {isCurrent && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 text-[10px] font-bold shrink-0">
                          This Device
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Last active: {formatTime(dev.lastActiveAt)}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => removeDevice(dev.deviceId)}
                  className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1 shrink-0 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
