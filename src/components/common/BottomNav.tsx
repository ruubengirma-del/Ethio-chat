import React from 'react';
import { Home, Clapperboard, MessageSquare, Users, Settings } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export type TabType = 'home' | 'video' | 'chats' | 'search' | 'profile' | 'settings';

interface BottomNavProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
  homeBadge?: number;
  videoBadge?: number;
  unreadCount?: number;
  allUsersBadge?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  homeBadge = 0,
  videoBadge = 0,
  unreadCount = 0,
  allUsersBadge = 0,
}) => {
  const { t } = useLanguage();

  const tabs: Array<{ id: TabType; label: string; icon: React.ReactNode; badge?: number }> = [
    {
      id: 'home',
      label: t('navFeed'),
      icon: <Home className="w-4.5 h-4.5 sm:w-5 sm:h-5" />,
      badge: homeBadge,
    },
    {
      id: 'video',
      label: t('navVideo'),
      icon: <Clapperboard className="w-4.5 h-4.5 sm:w-5 sm:h-5" />,
      badge: videoBadge,
    },
    {
      id: 'chats',
      label: t('navChats'),
      icon: <MessageSquare className="w-4.5 h-4.5 sm:w-5 sm:h-5" />,
      badge: unreadCount
    },
    {
      id: 'search',
      label: t('navSearch'),
      icon: <Users className="w-4.5 h-4.5 sm:w-5 sm:h-5" />,
      badge: allUsersBadge,
    },
    {
      id: 'settings',
      label: t('navSettings'),
      icon: <Settings className="w-4.5 h-4.5 sm:w-5 sm:h-5" />
    }
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#120f24]/95 backdrop-blur-lg border-t border-slate-200/80 dark:border-purple-950/40 safe-bottom">
      <div className="max-w-lg mx-auto px-1.5 sm:px-4 h-16 flex items-center justify-around gap-0.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`relative flex-1 flex flex-col items-center justify-center py-1 transition-all rounded-xl min-w-0 ${
                isActive
                  ? 'text-[#7560DF] font-bold scale-105'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium'
              }`}
            >
              <div className="relative">
                {tab.icon}
                {Boolean(tab.badge && tab.badge > 0) && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-extrabold flex items-center justify-center shadow-sm whitespace-nowrap animate-pulse">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] sm:text-[11px] mt-0.5 tracking-tight truncate max-w-full px-0.5 ${isActive ? 'text-[#7560DF] dark:text-[#A798F8]' : ''}`}>
                {tab.label}
              </span>
              {isActive && (
                <span className="w-1 h-1 rounded-full bg-[#7560DF] absolute -bottom-0.5" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
