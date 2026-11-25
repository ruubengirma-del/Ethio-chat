import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  isPlatformBiometricAvailable,
  registerBiometricCredential,
  verifyBiometricCredential
} from '../../lib/socialHelpers';
import { X, Eye, ShieldCheck, Lock, Check, KeyRound, Unlock, Fingerprint, Loader2 } from 'lucide-react';

/* 1. Last Seen Visibility Modal */
export const LastSeenModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { userProfile, updateUserProfileData } = useAuth();
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);

  if (!isOpen || !userProfile) return null;

  const currentVal = userProfile.lastSeenVisibility || 'everyone';

  const options: Array<{ id: 'everyone' | 'followers' | 'nobody'; title: string; desc: string }> = [
    { id: 'everyone', title: 'Everyone', desc: 'Anyone viewing your profile can see your Last Seen time' },
    { id: 'followers', title: 'Followers Only', desc: 'Only people connected with you see your Last Seen time' },
    { id: 'nobody', title: 'Nobody (Hidden)', desc: 'Hide your Last Seen timestamp on your profile' },
  ];

  const handleSelect = async (val: 'everyone' | 'followers' | 'nobody') => {
    setSaving(true);
    try {
      await updateUserProfileData({ lastSeenVisibility: val });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-[#7560DF]" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{t('lastSeen')}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-purple-900/30">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-2.5">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t('lastSeenDesc')}</p>
          {options.map((opt) => {
            const active = currentVal === opt.id;
            return (
              <button
                key={opt.id}
                disabled={saving}
                onClick={() => handleSelect(opt.id)}
                className={`w-full p-3.5 rounded-2xl border text-left flex items-center justify-between gap-3 transition-all ${
                  active
                    ? 'border-[#7560DF] bg-[#7560DF]/10 text-[#7560DF] dark:text-[#B09EFC]'
                    : 'border-slate-200 dark:border-purple-950/40 hover:bg-slate-50 dark:hover:bg-[#201c38] text-slate-800 dark:text-slate-200'
                }`}
              >
                <div>
                  <p className="text-sm font-bold">{opt.title}</p>
                  <p className="text-xs opacity-75">{opt.desc}</p>
                </div>
                {active && <Check className="w-4.5 h-4.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* 2. Two-Step Verification Modal */
export const TwoStepModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { userProfile, updateUserProfileData } = useAuth();
  const { t } = useLanguage();
  const [pin, setPin] = useState(userProfile?.twoStepPin || '');
  const [confirmPin, setConfirmPin] = useState(userProfile?.twoStepPin || '');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!isOpen || !userProfile) return null;

  const isEnabled = Boolean(userProfile.twoStepEnabled);

  const handleSaveEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pin.length < 4 || pin.length > 8) {
      setErr('Please enter a 4 to 8 digit security PIN.');
      return;
    }
    if (pin !== confirmPin) {
      setErr('PINs do not match.');
      return;
    }
    setSaving(true);
    try {
      await updateUserProfileData({ twoStepEnabled: true, twoStepPin: pin });
      sessionStorage.setItem(`ethio_2fa_ok_${userProfile.userId}`, 'true');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    setSaving(true);
    try {
      await updateUserProfileData({ twoStepEnabled: false });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{t('twoStepVerification')}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-purple-900/30">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSaveEnable} className="p-5 space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('twoStepDesc')}</p>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Security PIN (4-6 digits)</label>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
              placeholder="e.g. 2580"
              className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm tracking-widest font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Confirm PIN</label>
            <input
              type="password"
              inputMode="numeric"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
              placeholder="Re-enter PIN"
              className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm tracking-widest font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
            />
          </div>

          {err && <p className="text-xs font-semibold text-rose-500">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-xs shadow-md shadow-[#7560DF]/25"
            >
              {isEnabled ? 'Update 2FA PIN' : 'Enable Two-Step Verification'}
            </button>
            {isEnabled && (
              <button
                type="button"
                disabled={saving}
                onClick={handleDisable}
                className="px-4 py-2.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 font-bold text-xs"
              >
                Turn Off
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

/* 3. App Lock Config Modal (with Optional Fingerprint Lock ON/OFF) */
export const AppLockConfigModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onLockNow: () => void;
}> = ({ isOpen, onClose, onLockNow }) => {
  const { userProfile, updateUserProfileData } = useAuth();
  const { t } = useLanguage();
  const [passcode, setPasscode] = useState(userProfile?.appLockPin || '');
  const [fingerprintOn, setFingerprintOn] = useState(Boolean(userProfile?.fingerprintLockEnabled));
  const [credentialId, setCredentialId] = useState<string>(userProfile?.fingerprintCredentialId || '');
  const [biometricSupported, setBiometricSupported] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPasscode(userProfile?.appLockPin || '');
    setFingerprintOn(Boolean(userProfile?.fingerprintLockEnabled));
    setCredentialId(userProfile?.fingerprintCredentialId || '');
    setErr(null);
    setSavedNotice(null);
    isPlatformBiometricAvailable().then(setBiometricSupported).catch(() => setBiometricSupported(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen || !userProfile) return null;

  const isEnabled = Boolean(userProfile.appLockEnabled);
  const canTurnOff = isEnabled || fingerprintOn || Boolean(userProfile.appLockPin);

  const handleToggleFingerprint = async () => {
    const nextVal = !fingerprintOn;
    setErr(null);
    setSavedNotice(null);
    setSaving(true);
    try {
      if (nextVal) {
        sessionStorage.setItem(`ethio_applock_ok_${userProfile.userId}`, 'true');
        const reg = await registerBiometricCredential(userProfile.userId, userProfile.username);
        setFingerprintOn(true);
        setCredentialId(reg.credentialId);
        await updateUserProfileData({
          appLockEnabled: true,
          fingerprintLockEnabled: true,
          fingerprintCredentialId: reg.credentialId,
          ...(passcode.trim().length >= 4 ? { appLockPin: passcode.trim() } : {}),
        });
        setSavedNotice(t('appLockSaved'));
      } else {
        setFingerprintOn(false);
        const keepAppLock = passcode.trim().length >= 4 && isEnabled;
        await updateUserProfileData({
          fingerprintLockEnabled: false,
          appLockEnabled: keepAppLock,
          ...(keepAppLock ? { appLockPin: passcode.trim() } : {}),
        });
        setSavedNotice(t('appLockSaved'));
      }
    } catch (error: any) {
      setErr(error?.message || 'Failed to update Fingerprint Lock.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSavedNotice(null);
    const trimmedPin = passcode.trim();
    if (!fingerprintOn && trimmedPin.length < 4) {
      setErr('Enter a passcode of at least 4 characters or enable Fingerprint Lock.');
      return;
    }
    if (trimmedPin.length > 0 && trimmedPin.length < 4) {
      setErr('Passcode must be at least 4 characters.');
      return;
    }
    setSaving(true);
    try {
      sessionStorage.setItem(`ethio_applock_ok_${userProfile.userId}`, 'true');
      await updateUserProfileData({
        appLockEnabled: true,
        appLockPin: trimmedPin,
        fingerprintLockEnabled: fingerprintOn,
        ...(credentialId ? { fingerprintCredentialId: credentialId } : {}),
      });
      setSavedNotice(t('appLockSaved'));
      setTimeout(() => {
        onClose();
      }, 450);
    } catch (error: any) {
      setErr(error?.message || 'Failed to save App Lock settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    setErr(null);
    setSavedNotice(null);
    setSaving(true);
    try {
      setFingerprintOn(false);
      setPasscode('');
      setCredentialId('');
      sessionStorage.removeItem(`ethio_applock_ok_${userProfile.userId}`);
      await updateUserProfileData({
        appLockEnabled: false,
        fingerprintLockEnabled: false,
        appLockPin: '',
        fingerprintCredentialId: '',
      });
      onClose();
    } catch (error: any) {
      setErr(error?.message || 'Failed to turn off App Lock.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-[#7560DF]" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{t('appLock')}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-purple-900/30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('appLockDesc')}</p>

          {/* Optional Fingerprint Lock ON/OFF Card */}
          <div className="p-3.5 rounded-2xl bg-[#7560DF]/8 dark:bg-[#201c38] border border-[#7560DF]/25 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                fingerprintOn ? 'bg-emerald-500 text-white' : 'bg-[#7560DF]/15 text-[#7560DF]'
              }`}>
                <Fingerprint className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h4 className="font-bold text-xs text-slate-900 dark:text-white">
                    {t('fingerprintLock')}
                  </h4>
                  <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-extrabold ${
                    fingerprintOn
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
                  }`}>
                    {fingerprintOn ? 'ON' : 'OFF'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                  {t('fingerprintLockDesc')}
                  {biometricSupported ? '' : ' (Hardware biometric activates automatically on supported devices)'}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={handleToggleFingerprint}
              className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                fingerprintOn ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  fingerprintOn ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              App Passcode / PIN {fingerprintOn ? '(Optional fallback)' : ''}
            </label>
            <input
              type="password"
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value.slice(0, 12));
                setErr(null);
              }}
              placeholder={fingerprintOn ? 'Optional fallback passcode' : 'Enter 4+ digit PIN or password'}
              className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
            />
          </div>

          {err && <p className="text-xs font-semibold text-rose-500">{err}</p>}
          {savedNotice && (
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" />
              <span>{savedNotice}</span>
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 px-4 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] disabled:opacity-60 text-white font-bold text-xs shadow-md shadow-[#7560DF]/25 flex items-center justify-center gap-1.5"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Save App Lock Settings</span>
            </button>
            {canTurnOff && (
              <>
                {(isEnabled && (passcode.trim().length >= 4 || fingerprintOn)) && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      onClose();
                      onLockNow();
                    }}
                    className="px-4 py-2.5 rounded-2xl bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] font-bold text-xs"
                  >
                    Lock Now
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleDisable}
                  className="px-4 py-2.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-bold text-xs"
                >
                  Turn Off
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

/* 4. Full-screen Passcode / 2FA / Fingerprint Lock Overlay */
export const PasscodeOverlay: React.FC<{
  mode: 'applock' | '2fa';
  expectedPin?: string;
  fingerprintEnabled?: boolean;
  fingerprintCredentialId?: string;
  onUnlock: () => void;
  onSignOut: () => void;
}> = ({ mode, expectedPin, fingerprintEnabled, fingerprintCredentialId, onUnlock, onSignOut }) => {
  const { t } = useLanguage();
  const [entry, setEntry] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [scanningFingerprint, setScanningFingerprint] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (expectedPin && entry === expectedPin) {
      setErr(null);
      setEntry('');
      onUnlock();
    } else {
      setErr('Incorrect PIN / Passcode. Please try again.');
    }
  };

  const handleFingerprintUnlock = async () => {
    setErr(null);
    setScanningFingerprint(true);
    try {
      const res = await verifyBiometricCredential(fingerprintCredentialId);
      if (res.verified) {
        onUnlock();
      } else {
        setErr(res.error || 'Fingerprint verification failed. Try again or use passcode.');
      }
    } finally {
      setScanningFingerprint(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-purple-900/50 text-center space-y-5">
        <div className="w-16 h-16 rounded-3xl bg-[#7560DF]/15 text-[#7560DF] flex items-center justify-center mx-auto">
          {mode === '2fa' ? (
            <KeyRound className="w-8 h-8" />
          ) : fingerprintEnabled ? (
            <Fingerprint className="w-8 h-8" />
          ) : (
            <Lock className="w-8 h-8" />
          )}
        </div>

        <div className="space-y-1">
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
            {mode === '2fa' ? 'Two-Step Verification' : 'Ethio Chat Locked'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {mode === '2fa'
              ? 'Enter your 2-Step Verification PIN to access your account.'
              : fingerprintEnabled
              ? 'Use your device fingerprint or passcode to unlock.'
              : 'Enter your App Lock passcode to continue.'}
          </p>
        </div>

        {mode === 'applock' && fingerprintEnabled && (
          <button
            type="button"
            disabled={scanningFingerprint}
            onClick={handleFingerprintUnlock}
            className="w-full py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-500/25 transition-all active:scale-98"
          >
            {scanningFingerprint ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Fingerprint className="w-5 h-5" />
            )}
            <span>{t('unlockWithFingerprint')}</span>
          </button>
        )}

        {expectedPin && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              autoFocus={!(mode === 'applock' && fingerprintEnabled)}
              value={entry}
              onChange={(e) => {
                setEntry(e.target.value);
                setErr(null);
              }}
              placeholder="••••"
              className="w-full px-4 py-3 rounded-2xl bg-slate-100 dark:bg-[#201c38] text-center text-lg font-extrabold tracking-[0.4em] text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
            />

            <button
              type="submit"
              className="w-full py-3 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#7560DF]/25"
            >
              <Unlock className="w-4 h-4" />
              <span>Unlock</span>
            </button>
          </form>
        )}

        {err && <p className="text-xs font-semibold text-rose-500">{err}</p>}

        <button
          type="button"
          onClick={onSignOut}
          className="text-xs font-semibold text-slate-400 hover:text-rose-500 transition-colors"
        >
          Switch Account / Log Out
        </button>
      </div>
    </div>
  );
};
