import React, { useState } from 'react';
import { Download, Smartphone, X, Copy, Check, ExternalLink } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'settings-row';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState(false);

  if (isInstalled) {
    return null;
  }

  const appUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://ais-pre-drvztwlm4i4ydhihbolla3-201690340973.us-east1.run.app';

  const handleAction = async () => {
    if (isInstallable) {
      const ok = await install();
      if (ok) return;
    }
    setShowGuide(true);
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
    } catch {
      const el = document.createElement('textarea');
      el.value = appUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {variant === 'header' ? (
        isInstallable || isIOS ? (
          <button
            type="button"
            onClick={handleAction}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold shadow-sm transition-colors"
            title="Install Ethio Chat"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Install</span>
          </button>
        ) : null
      ) : (
        <div
          onClick={handleAction}
          className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-purple-950/20 transition-colors group"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#7560DF]/15 dark:bg-[#7560DF]/25 flex items-center justify-center text-[#7560DF] shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-[#7560DF] transition-colors truncate">
                Install App on Device
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Install as a native app on Android &amp; iPhone
              </p>
            </div>
          </div>
          <Download className="w-4 h-4 text-[#7560DF] shrink-0" />
        </div>
      )}

      {showGuide && (
        <div
          onClick={() => setShowGuide(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl p-6 shadow-2xl border border-slate-100 dark:border-purple-950/60 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-[#7560DF]/15 text-[#7560DF] flex items-center justify-center">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                    Install Ethio Chat
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Android &amp; iPhone App Install
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/30"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200/80 dark:border-purple-900/40 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                App URL
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={appUrl}
                  className="flex-1 bg-white dark:bg-[#141126] border border-slate-200 dark:border-purple-900/50 rounded-xl px-3 py-2 text-xs text-slate-700 dark:text-slate-200 outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="px-3 py-2 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {isIOS ? (
              <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <p className="font-bold text-slate-900 dark:text-white">iPhone / iPad (Safari):</p>
                <p>1. Tap the <strong>Share</strong> icon at the bottom.</p>
                <p>2. Scroll down and select <strong>Add to Home Screen</strong>.</p>
              </div>
            ) : (
              <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <p className="font-bold text-slate-900 dark:text-white">Android (Chrome):</p>
                <p>1. Open the link above directly in Chrome.</p>
                <p>2. Tap the three dots (<strong>⋮</strong>) in the top right.</p>
                <p>3. Select <strong>Install app</strong> or <strong>Add to Home screen</strong> to install it on your phone.</p>
              </div>
            )}

            <div className="p-3 rounded-2xl bg-[#7560DF]/10 text-[#5c48c5] dark:text-[#B09EFC] text-[11px] leading-relaxed flex items-start gap-2">
              <ExternalLink className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Need a standalone <strong>.APK</strong> file? Paste this URL into{' '}
                <strong>pwabuilder.com</strong> to generate an Android APK package.
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full py-2.5 rounded-2xl bg-slate-100 dark:bg-[#241f42] hover:bg-slate-200 dark:hover:bg-[#2f2856] text-slate-800 dark:text-slate-100 font-bold text-sm transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};
