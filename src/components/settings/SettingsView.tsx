import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { isSimulatedOffline, setSimulatedOffline } from '../../lib/offlineSync';
import { FONT_STYLES } from '../../lib/socialHelpers';
import { AppLanguage } from '../../types';
import { 
  Moon, 
  Sun, 
  Mail, 
  Wifi, 
  WifiOff, 
  LogOut, 
  ExternalLink, 
  Users,
  PlusCircle,
  BarChart3,
  Bot,
  Ban,
  Smartphone,
  Globe,
  RefreshCw,
  ChevronRight,
  Check,
  Clock,
  CheckCheck,
  ShieldCheck,
  Lock,
  Image as ImageIcon,
  Type,
  Smile,
  Download,
  HardDriveDownload,
  Sparkles,
  Trash2,
  AlertTriangle,
  Loader2,
  Crown
} from 'lucide-react';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { GoldVerifiedBadge } from '../common/GoldVerifiedBadge';

interface SettingsViewProps {
  onNavigateToProfile: () => void;
  onOpenSubscription: () => void;
  onOpenCreateGroup: () => void;
  onOpenSwitchAccount: () => void;
  onOpenDashboard: () => void;
  onOpenRubGPT: () => void;
  onOpenBlocked: () => void;
  onOpenDevices: () => void;
  onOpenLastSeen: () => void;
  onOpenTwoStep: () => void;
  onOpenAppLock: () => void;
  onOpenChatWallpaper: () => void;
  onOpenFontSize: () => void;
  onOpenFontStyle: () => void;
  onOpenChatBackup: () => void;
  onOpenModerationInbox?: () => void;
  onOpenPaymentDashboard?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ 
  onNavigateToProfile,
  onOpenSubscription,
  onOpenCreateGroup,
  onOpenSwitchAccount,
  onOpenDashboard,
  onOpenRubGPT,
  onOpenBlocked,
  onOpenDevices,
  onOpenLastSeen,
  onOpenTwoStep,
  onOpenAppLock,
  onOpenChatWallpaper,
  onOpenFontSize,
  onOpenFontStyle,
  onOpenChatBackup,
  onOpenModerationInbox,
  onOpenPaymentDashboard,
}) => {
  const {
    userProfile,
    signOut,
    deleteAccount,
    blockedUsers,
    devices,
    savedAccounts,
    updateUserProfileData,
    isOwner,
    isAdmin,
    isUserGoldVerified,
  } = useAuth();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const [simulatedOffline, setSimOffline] = useState(isSimulatedOffline());
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const readReceiptsOn = userProfile?.readReceiptsEnabled !== false;
  const reactionsOn = userProfile?.messageReactionsEnabled !== false;
  const autoDownloadOn = userProfile?.autoDownloadMedia !== false;
  const lastSeenLabel =
    userProfile?.lastSeenVisibility === 'nobody'
      ? 'Nobody'
      : userProfile?.lastSeenVisibility === 'followers'
      ? 'Followers'
      : 'Everyone';
  const fontSizeLabel =
    userProfile?.chatFontSize === 'small'
      ? 'Small'
      : userProfile?.chatFontSize === 'large'
      ? 'Large'
      : 'Medium';
  const fontStyleName =
    FONT_STYLES.find((f) => f.id === userProfile?.fontStyle)?.name || FONT_STYLES[0].name;

  const handleToggleOffline = () => {
    const next = !simulatedOffline;
    setSimOffline(next);
    setSimulatedOffline(next);
  };

  const handleContactUs = () => {
    const email = 'Ruubengirma@gmail.com';
    const subject = encodeURIComponent('Ethio Chat Support & Feedback');
    const body = encodeURIComponent(
      `Hello Ethio Chat Support Team,\n\nI am contacting you regarding Ethio Chat app.\n\nUser: ${userProfile?.displayName || 'User'} (@${userProfile?.username || 'unknown'})\nPlatform: Web / Android / iOS\n\nMy Message:\n`
    );
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  };

  const languages: Array<{ code: AppLanguage; label: string; native: string }> = [
    { code: 'en', label: '1. English', native: 'English' },
    { code: 'om', label: '2. Afaan Oromo', native: 'Afaan Oromoo' },
    { code: 'am', label: '3. Amharic', native: 'አማርኛ' },
  ];

  return (
    <div className="max-w-xl mx-auto px-4 py-4 space-y-5 pb-24">
      {/* Account Info Card */}
      {userProfile && (
        <div className="bg-white dark:bg-[#16132b] rounded-3xl p-4 sm:p-5 border border-slate-200/80 dark:border-purple-950/40 shadow-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <img
              src={userProfile.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${userProfile.username}`}
              alt={userProfile.displayName}
              className="w-14 h-14 rounded-full object-cover ring-2 ring-[#7560DF]/40 shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <h3 className="font-extrabold text-base text-slate-900 dark:text-white truncate">
                  {userProfile.displayName}
                </h3>
                <GoldVerifiedBadge userId={userProfile.userId} size="sm" />
              </div>
              <p className="text-xs font-semibold text-[#7560DF] dark:text-[#A798F8] truncate">
                @{userProfile.username}
              </p>
              <p className="text-xs text-slate-400 truncate max-w-[200px]">
                {userProfile.email}
              </p>
            </div>
          </div>

          <button
            onClick={onNavigateToProfile}
            className="px-3.5 py-2 rounded-2xl bg-[#7560DF]/10 dark:bg-[#7560DF]/20 text-[#7560DF] dark:text-[#B09EFC] hover:bg-[#7560DF]/25 text-xs font-bold transition-colors shrink-0"
          >
            {t('navProfile')}
          </button>
        </div>
      )}

      {/* Account, Dashboard & RubGPT */}
      <div className="bg-white dark:bg-[#16132b] rounded-3xl border border-slate-200/80 dark:border-purple-950/40 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-purple-950/40 font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t('accountSection')}
        </div>

        <div className="divide-y divide-slate-100 dark:divide-purple-950/30">
          {/* Subscription (Premium & Gold Verified Badge) */}
          <div
            onClick={onOpenSubscription}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-amber-50/60 dark:hover:bg-amber-950/15 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
                <Crown className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors truncate">
                    {t('subscription')}
                  </h4>
                  {userProfile && isUserGoldVerified(userProfile.userId) && (
                    <span className="text-[10px] font-extrabold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                      · Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('subscriptionDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          {/* Switch Account / Add Account */}
          <div
            onClick={onOpenSwitchAccount}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-[#7560DF]/10 dark:bg-[#7560DF]/20 text-[#7560DF] flex items-center justify-center shrink-0">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors truncate">
                    {t('switchAccount')}
                  </h4>
                  <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-[#201c38] text-[10px] font-bold text-slate-600 dark:text-slate-300">
                    {savedAccounts.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('switchAccountDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          {/* Dashboard (Monthly & Yearly views) */}
          <div
            onClick={onOpenDashboard}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <BarChart3 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-emerald-500 transition-colors truncate">
                  {t('dashboard')}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('dashboardDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          {/* RubGPT AI Assistant */}
          <div
            onClick={onOpenRubGPT}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#7560DF] to-[#9E8CF8] text-white flex items-center justify-center shadow-md shadow-[#7560DF]/25 shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors truncate">
                    {t('rubGpt')}
                  </h4>
                  <span className="px-1.5 py-0.5 rounded-full bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] text-[9px] font-extrabold uppercase">
                    AI
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('rubGptDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
        </div>
      </div>

      {/* Groups, Blocked Users & Devices */}
      <div className="bg-white dark:bg-[#16132b] rounded-3xl border border-slate-200/80 dark:border-purple-950/40 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-purple-950/40 font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t('groupsSection')}
        </div>

        <div className="divide-y divide-slate-100 dark:divide-purple-950/30">
          {/* Create Group */}
          <div
            onClick={onOpenCreateGroup}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-[#7560DF] text-white flex items-center justify-center shadow-md shadow-[#7560DF]/25 shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors truncate">
                  {t('createGroup')}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('createGroupDesc')}
                </p>
              </div>
            </div>
            <PlusCircle className="w-5 h-5 text-[#7560DF] shrink-0" />
          </div>

          {/* Blocked Users */}
          <div
            onClick={onOpenBlocked}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0">
                <Ban className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-rose-500 transition-colors truncate">
                    {t('blockedUsers')}
                  </h4>
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-500 text-[10px] font-extrabold">
                    {blockedUsers.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('blockedUsersDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          {/* Logged-in Devices */}
          <div
            onClick={onOpenDevices}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-blue-500/15 text-blue-500 flex items-center justify-center shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-blue-500 transition-colors truncate">
                    {t('devicesTitle')}
                  </h4>
                  <span className="px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-500 text-[10px] font-extrabold">
                    {devices.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('devicesDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          {/* Last Seen */}
          <div
            onClick={onOpenLastSeen}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-violet-500/15 text-[#7560DF] flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors truncate">
                    {t('lastSeen')}
                  </h4>
                  <span className="px-2 py-0.5 rounded-full bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] text-[10px] font-extrabold">
                    {lastSeenLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('lastSeenDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          {/* Read Receipts Toggle */}
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-sky-500/15 text-sky-500 flex items-center justify-center shrink-0">
                <CheckCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                  {t('readReceipts')}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('readReceiptsDesc')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => updateUserProfileData({ readReceiptsEnabled: !readReceiptsOn })}
              className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                readReceiptsOn ? 'bg-[#7560DF]' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  readReceiptsOn ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Two-Step Verification */}
          <div
            onClick={onOpenTwoStep}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-emerald-500 transition-colors truncate">
                    {t('twoStepVerification')}
                  </h4>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                      userProfile?.twoStepEnabled
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-slate-100 dark:bg-[#201c38] text-slate-500'
                    }`}
                  >
                    {userProfile?.twoStepEnabled ? 'ON' : 'OFF'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('twoStepDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          {/* App Lock */}
          <div
            onClick={onOpenAppLock}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-amber-500 transition-colors truncate">
                    {t('appLock')}
                  </h4>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                      userProfile?.appLockEnabled
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-slate-100 dark:bg-[#201c38] text-slate-500'
                    }`}
                  >
                    {userProfile?.appLockEnabled ? 'ON' : 'OFF'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('appLockDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
        </div>
      </div>

      {/* Chat Settings Section */}
      <div className="bg-white dark:bg-[#16132b] rounded-3xl border border-slate-200/80 dark:border-purple-950/40 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-purple-950/40 font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t('chatSettingsSection')}
        </div>

        <div className="divide-y divide-slate-100 dark:divide-purple-950/30">
          {/* Chat Wallpaper */}
          <div
            onClick={onOpenChatWallpaper}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-[#7560DF]/15 text-[#7560DF] flex items-center justify-center shrink-0">
                <ImageIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors truncate">
                  {t('chatWallpaper')}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('chatWallpaperDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          {/* Font Size */}
          <div
            onClick={onOpenFontSize}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center shrink-0">
                <Type className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-indigo-500 transition-colors truncate">
                    {t('fontSize')}
                  </h4>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[10px] font-extrabold">
                    {fontSizeLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('fontSizeDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          {/* Font Style (10 Beautiful Global Fonts) */}
          <div
            onClick={onOpenFontStyle}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-[#7560DF]/15 text-[#7560DF] flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors truncate">
                    {t('fontStyle')}
                  </h4>
                  <span className="px-2 py-0.5 rounded-full bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] text-[10px] font-extrabold truncate max-w-[130px]">
                    {fontStyleName}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('fontStyleDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          {/* Message Reactions Toggle */}
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-pink-500/15 text-pink-500 flex items-center justify-center shrink-0">
                <Smile className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                  {t('messageReactions')}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('messageReactionsDesc')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => updateUserProfileData({ messageReactionsEnabled: !reactionsOn })}
              className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                reactionsOn ? 'bg-[#7560DF]' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  reactionsOn ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Auto Download Media Toggle */}
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 text-cyan-500 flex items-center justify-center shrink-0">
                <Download className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                  {t('autoDownloadMedia')}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('autoDownloadMediaDesc')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => updateUserProfileData({ autoDownloadMedia: !autoDownloadOn })}
              className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                autoDownloadOn ? 'bg-[#7560DF]' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  autoDownloadOn ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Chat Backup */}
          <div
            onClick={onOpenChatBackup}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
                <HardDriveDownload className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-emerald-500 transition-colors truncate">
                  {t('chatBackup')}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {t('chatBackupDesc')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
        </div>
      </div>

      {/* Language Selector: 1. English, 2. Afaan Oromo, 3. Amharic */}
      <div className="bg-white dark:bg-[#16132b] rounded-3xl border border-slate-200/80 dark:border-purple-950/40 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-purple-950/40 flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <Globe className="w-4 h-4 text-[#7560DF]" />
          <span>{t('languageSection')}</span>
        </div>
        <div className="p-4 space-y-2.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('languageDesc')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {languages.map((lang) => {
              const active = language === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setLanguage(lang.code)}
                  className={`px-3.5 py-3 rounded-2xl border text-left transition-all flex items-center justify-between gap-2 ${
                    active
                      ? 'bg-[#7560DF] text-white border-[#7560DF] shadow-md shadow-[#7560DF]/25'
                      : 'bg-slate-50 dark:bg-[#201c38] text-slate-800 dark:text-slate-200 border-slate-200/80 dark:border-purple-950/40 hover:border-[#7560DF]/50'
                  }`}
                >
                  <div>
                    <p className="text-xs font-extrabold">{lang.label}</p>
                    <p className={`text-[10px] ${active ? 'text-purple-100' : 'text-slate-400'}`}>
                      {lang.native}
                    </p>
                  </div>
                  {active && <Check className="w-4 h-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Appearance & Network */}
      <div className="bg-white dark:bg-[#16132b] rounded-3xl border border-slate-200/80 dark:border-purple-950/40 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-purple-950/40 font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t('appearanceSection')}
        </div>

        <div className="divide-y divide-slate-100 dark:divide-purple-950/30">
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#7560DF]/10 dark:bg-[#7560DF]/20 flex items-center justify-center text-[#7560DF]">
                {isDarkMode ? <Moon className="w-5 h-5 text-amber-400" /> : <Sun className="w-5 h-5" />}
              </div>
              <div>
                <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                  {t('darkMode')}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('darkModeDesc')}
                </p>
              </div>
            </div>

            <button
              onClick={toggleDarkMode}
              className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                isDarkMode ? 'bg-[#7560DF]' : 'bg-slate-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  isDarkMode ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                simulatedOffline ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-600' : 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600'
              }`}>
                {simulatedOffline ? <WifiOff className="w-5 h-5" /> : <Wifi className="w-5 h-5" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                    {t('simOfflineMode')}
                  </h4>
                  {simulatedOffline && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-300 font-bold px-1.5 py-0.5 rounded">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('simOfflineDesc')}
                </p>
              </div>
            </div>

            <button
              onClick={handleToggleOffline}
              className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                simulatedOffline ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  simulatedOffline ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Support & Info */}
      <div className="bg-white dark:bg-[#16132b] rounded-3xl border border-slate-200/80 dark:border-purple-950/40 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-purple-950/40 font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t('supportSection')}
        </div>

        <div className="divide-y divide-slate-100 dark:divide-purple-950/30">
          <PWAInstallButton variant="settings-row" />

          <div
            onClick={handleContactUs}
            className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#7560DF]/10 dark:bg-[#7560DF]/20 flex items-center justify-center text-[#7560DF] group-hover:scale-105 transition-transform">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors">
                  {t('contactUs')}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-[#7560DF] dark:text-[#B09EFC]">Ruubengirma@gmail.com</span>
                </p>
              </div>
            </div>

            <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-[#7560DF] transition-colors" />
          </div>

          {(isOwner || isAdmin) && onOpenPaymentDashboard && (
            <div
              onClick={onOpenPaymentDashboard}
              className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-amber-50/60 dark:hover:bg-amber-950/15 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/15 flex items-center justify-center text-amber-500">
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                    {t('paymentManagement')}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isOwner
                      ? 'Approve payments, Gold badges, pricing & Admin roles'
                      : 'Review, approve & reject payment requests'}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </div>
          )}

          {isOwner &&
            onOpenModerationInbox && (
              <div
                onClick={onOpenModerationInbox}
                className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-rose-500/15 flex items-center justify-center text-rose-500">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-rose-500 transition-colors">
                      {t('moderationInbox')}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Review post reports & warning appeals
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
            )}
        </div>
      </div>

      {/* Sign Out Button (with Yes / No Confirmation) */}
      <div className="space-y-2.5">
        <button
          type="button"
          onClick={() => setShowLogoutConfirm(true)}
          className="w-full py-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-bold text-sm flex items-center justify-center gap-2 transition-colors border border-rose-200/60 dark:border-rose-900/40"
        >
          <LogOut className="w-4 h-4" />
          <span>{t('logOut')}</span>
        </button>

        {/* Delete Account Button (directly beneath Log Out) */}
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          className="w-full py-3.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-md shadow-red-600/20"
        >
          <Trash2 className="w-4 h-4" />
          <span>{t('deleteAccount')}</span>
        </button>
      </div>

      {/* App Info Footer */}
      <div className="text-center space-y-1 text-slate-400 text-xs pt-2">
        <p className="font-semibold text-[#7560DF] dark:text-[#A798F8]">
          Ethio Chat v2.0
        </p>
        <p className="font-semibold">Ruube Studio</p>
      </div>

      {/* Log Out Yes / No Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#16132b] w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-slate-100 dark:border-purple-950/60 space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/15 text-rose-500 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>
            <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
              {t('logOutConfirmTitle')}
            </h3>
            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2.5 rounded-2xl bg-slate-100 dark:bg-[#241f42] hover:bg-slate-200 dark:hover:bg-[#2f2856] text-slate-800 dark:text-slate-100 font-bold text-sm transition-colors"
              >
                {t('noBtn')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLogoutConfirm(false);
                  signOut();
                }}
                className="flex-1 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm transition-colors shadow-md shadow-rose-600/25"
              >
                {t('yesBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Yes / No Permanent Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#16132b] w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-red-200 dark:border-red-900/50 space-y-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-red-500/15 text-red-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                {t('deleteAccountConfirmTitle')}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {t('deleteAccountWarning')}
              </p>
            </div>
            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                disabled={deletingAccount}
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-2xl bg-slate-100 dark:bg-[#241f42] hover:bg-slate-200 dark:hover:bg-[#2f2856] text-slate-800 dark:text-slate-100 font-bold text-sm transition-colors"
              >
                {t('noBtn')}
              </button>
              <button
                type="button"
                disabled={deletingAccount}
                onClick={async () => {
                  setDeletingAccount(true);
                  try {
                    await deleteAccount();
                    setShowDeleteConfirm(false);
                  } finally {
                    setDeletingAccount(false);
                  }
                }}
                className="flex-1 py-2.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-red-600/25"
              >
                {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>{t('yesBtn')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
