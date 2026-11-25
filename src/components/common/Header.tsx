import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { isOnline, isSimulatedOffline, setSimulatedOffline } from '../../lib/offlineSync';
import { 
  Wifi, 
  WifiOff, 
  Moon, 
  Sun, 
  Search, 
  Bell
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface HeaderProps {
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenSearch,
  onOpenNotifications,
}) => {
  const { unreadNotificationsCount } = useAuth();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { t } = useLanguage();
  const [onlineStatus, setOnlineStatus] = useState<boolean>(isOnline());
  const [simulated, setSimulated] = useState<boolean>(isSimulatedOffline());

  useEffect(() => {
    const update = () => {
      setOnlineStatus(isOnline());
      setSimulated(isSimulatedOffline());
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const handleToggleOfflineSimulator = () => {
    const next = !simulated;
    setSimulated(next);
    setSimulatedOffline(next);
    setOnlineStatus(isOnline());
  };

  return (
    <header className="sticky top-0 z-40 bg-white/80 dark:bg-[#120f24]/85 backdrop-blur-md border-b border-slate-200/80 dark:border-purple-950/40 transition-colors">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between gap-2">
        {/* Brand Logo & Name */}
        <div className="flex items-center gap-2.5 cursor-pointer group select-none min-w-0">
          <div className="relative w-10 h-10 rounded-full p-0.5 bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] shadow-md shadow-[#7560DF]/20 group-hover:scale-105 transition-transform flex items-center justify-center overflow-hidden bg-white shrink-0">
            <img 
              src="/assets/aistudio/20261111_152710_57efcc53.png" 
              alt="Ethio Chat Logo" 
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-base sm:text-lg tracking-tight bg-gradient-to-r from-[#7560DF] via-[#8B78EE] to-[#B09EFC] bg-clip-text text-transparent truncate">
                {t('appName')}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium hidden sm:block">
              Facebook × Messenger Experience
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <PWAInstallButton variant="header" />

          {/* Offline Simulator / Status Badge */}
          <button
            onClick={handleToggleOfflineSimulator}
            title={simulated ? t('simOffline') : (onlineStatus ? t('online') : t('offline'))}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-semibold transition-all border ${
              onlineStatus
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-100'
                : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 animate-pulse'
            }`}
          >
            {onlineStatus ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <Wifi className="w-3.5 h-3.5" />
                <span className="hidden md:inline">{t('online')}</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span className="font-bold text-[11px]">
                  {simulated ? t('simOffline') : t('offline')}
                </span>
              </>
            )}
          </button>

          {/* Common Notification Bell */}
          <button
            onClick={onOpenNotifications}
            className="relative p-2 rounded-full text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors"
            title={t('notifications')}
            aria-label={t('notifications')}
          >
            <Bell className="w-5 h-5" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-extrabold flex items-center justify-center shadow-sm">
                {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
              </span>
            )}
          </button>

          {/* Quick Search */}
          <button
            onClick={onOpenSearch}
            className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors"
            title={t('searchUsers')}
          >
            <Search className="w-4.5 h-4.5" />
          </button>

          {/* Theme Toggle */}
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors"
            title={isDarkMode ? "Light Mode" : "Dark Mode"}
          >
            {isDarkMode ? (
              <Sun className="w-4.5 h-4.5 text-amber-400" />
            ) : (
              <Moon className="w-4.5 h-4.5 text-slate-600" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
