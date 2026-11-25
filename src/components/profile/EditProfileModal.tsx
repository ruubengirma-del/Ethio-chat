import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { compressImage } from '../../lib/mediaCompression';
import { evaluatePasswordStrength, validateStrongPassword } from '../../lib/passwordValidation';
import {
  savePendingEmailChangeFlow,
  readPendingEmailChangeFlow,
  clearPendingEmailChangeFlow,
} from '../../lib/otpFlowPersistence';
import { 
  X, 
  Camera, 
  User, 
  AtSign,
  Mail, 
  Lock, 
  FileText, 
  Check, 
  CheckCircle2,
  Loader2, 
  AlertCircle,
  Image as ImageIcon,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck
} from 'lucide-react';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({ isOpen, onClose }) => {
  const {
    userProfile,
    updateUserProfileData,
    checkUsernameAvailability,
    requestEmailChangeCode,
    verifyEmailChangeCode,
    requiresFreshGoogleReauth,
    reauthenticateWithGoogle,
  } = useAuth();
  const { t } = useLanguage();

  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');
  const [username, setUsername] = useState(userProfile?.username || '');
  const [bio, setBio] = useState(userProfile?.bio || '');
  const [email, setEmail] = useState(userProfile?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [needsRecentLoginPw, setNeedsRecentLoginPw] = useState(false);
  const [photoURL, setPhotoURL] = useState(userProfile?.photoURL || '');
  const [coverURL, setCoverURL] = useState(userProfile?.coverURL || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);
  const [isCompressingCover, setIsCompressingCover] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live username uniqueness status
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');

  // Old-email OTP verification state for email changes
  const [emailCodeSentFor, setEmailCodeSentFor] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState('');
  const [verifiedEmailChange, setVerifiedEmailChange] = useState<{ forEmail: string; token: string } | null>(null);
  const [isSendingEmailCode, setIsSendingEmailCode] = useState(false);
  const [isVerifyingEmailCode, setIsVerifyingEmailCode] = useState(false);
  const [emailStepNotice, setEmailStepNotice] = useState<string | null>(null);
  const [emailStepError, setEmailStepError] = useState<string | null>(null);
  const [emailChangedBanner, setEmailChangedBanner] = useState<string | null>(null);
  const [needsEmailReauthPw, setNeedsEmailReauthPw] = useState(false);
  const [needsEmailGoogleReauth, setNeedsEmailGoogleReauth] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const initializedUidRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (!userProfile) return;

    // Only initialize when transitioning closed -> open or switching user account.
    // Do NOT reset while modal stays open when focus/visibilitychange refreshes userProfile.lastSeenAt.
    const shouldInitialize =
      !wasOpenRef.current || initializedUidRef.current !== userProfile.userId;
    if (!shouldInitialize) return;

    wasOpenRef.current = true;
    initializedUidRef.current = userProfile.userId;

    const pending = readPendingEmailChangeFlow(userProfile.userId, userProfile.email);

    setDisplayName(userProfile.displayName || '');
    setUsername(userProfile.username || '');
    setBio(userProfile.bio || '');
    setPhotoURL(userProfile.photoURL || '');
    setCoverURL(userProfile.coverURL || '');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPw(false);
    setShowNewPw(false);
    setShowConfirmPw(false);
    setNeedsRecentLoginPw(false);
    setNeedsEmailReauthPw(false);
    setNeedsEmailGoogleReauth(false);
    setEmailChangedBanner(null);
    setUsernameStatus('idle');
    setErrorMsg(null);
    setSuccessMsg(null);

    if (pending) {
      setEmail(pending.newEmail || userProfile.email || '');
      setEmailCodeSentFor(pending.emailCodeSentFor || null);
      setEmailCode('');
      setVerifiedEmailChange(pending.verifiedEmailChange || null);
      setEmailStepNotice(
        pending.verifiedEmailChange
          ? t('emailChangeVerifiedMsg')
          : `6-digit verification code sent to ${userProfile.email}.`
      );
      setEmailStepError(null);
    } else {
      setEmail(userProfile.email || '');
      setEmailCodeSentFor(null);
      setEmailCode('');
      setVerifiedEmailChange(null);
      setEmailStepNotice(null);
      setEmailStepError(null);
    }
  }, [isOpen, userProfile, t]);

  useEffect(() => {
    if (!isOpen || !userProfile) return;
    const clean = username.trim().replace(/^@+/, '').toLowerCase();
    const original = (userProfile.username || '').trim().toLowerCase();
    if (!clean || clean === original) {
      setUsernameStatus('idle');
      return;
    }
    if (!/^[a-z0-9_]{3,30}$/.test(clean)) {
      setUsernameStatus('invalid');
      return;
    }

    let cancelled = false;
    setUsernameStatus('checking');
    const timer = window.setTimeout(async () => {
      const res = await checkUsernameAvailability(clean, userProfile.userId);
      if (cancelled) return;
      setUsernameStatus(res.available ? 'available' : res.reason === 'invalid_format' ? 'invalid' : 'taken');
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, username, userProfile, checkUsernameAvailability]);

  if (!isOpen || !userProfile) return null;

  const pwChecks = evaluatePasswordStrength(newPassword);
  const oldNormalizedEmail = (userProfile.email || '').trim().toLowerCase();
  const typedNormalizedEmail = email.trim().toLowerCase();
  const isEmailChanged = Boolean(typedNormalizedEmail && typedNormalizedEmail !== oldNormalizedEmail);
  const isEmailVerifiedForTarget =
    isEmailChanged && verifiedEmailChange?.forEmail === typedNormalizedEmail && Boolean(verifiedEmailChange.token);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCompressingPhoto(true);
    setErrorMsg(null);
    try {
      const res = await compressImage(file, 450, 450, 0.8);
      setPhotoURL(res.dataUrl);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to compress profile photo');
    } finally {
      setIsCompressingPhoto(false);
    }
  };

  const handleCoverSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCompressingCover(true);
    setErrorMsg(null);
    try {
      const res = await compressImage(file, 1000, 480, 0.78);
      setCoverURL(res.dataUrl);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to compress cover photo');
    } finally {
      setIsCompressingCover(false);
    }
  };

  const handleSendEmailChangeCode = async () => {
    setErrorMsg(null);
    setEmailStepNotice(null);
    setEmailStepError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedNormalizedEmail)) {
      const m = 'Please enter a valid new email address first.';
      setEmailStepError(m);
      setErrorMsg(m);
      return;
    }
    setIsSendingEmailCode(true);
    try {
      const res = await requestEmailChangeCode(typedNormalizedEmail);
      setEmailCodeSentFor(typedNormalizedEmail);
      setVerifiedEmailChange(null);
      setEmailCode('');
      setEmailStepNotice(`6-digit verification code sent to ${res.sentTo}.`);
      savePendingEmailChangeFlow({
        uid: userProfile.userId,
        oldEmail: oldNormalizedEmail,
        newEmail: typedNormalizedEmail,
        emailCodeSentFor: typedNormalizedEmail,
        verifiedEmailChange: null,
      });
    } catch (err: any) {
      const msg = err?.message || '';
      if (err?.code === 'EMAIL_SERVICE_NOT_CONFIGURED' || msg.includes('EMAIL_SERVICE_NOT_CONFIGURED')) {
        const m = t('emailServiceNotConfigured');
        setEmailStepError(m);
        setErrorMsg(m);
      } else if (msg.includes('EMAIL_ALREADY_IN_USE')) {
        const m = t('emailAlreadyInUse');
        setEmailStepError(m);
        setErrorMsg(m);
      } else {
        const m = msg || 'Could not send verification code to your current email.';
        setEmailStepError(m);
        setErrorMsg(m);
      }
    } finally {
      setIsSendingEmailCode(false);
    }
  };

  const applyVerifiedEmailChangeNow = async (targetEmail: string, token: string) => {
    const res = await updateUserProfileData({
      email: targetEmail,
      emailChangeToken: token,
      currentPassword: currentPassword || undefined,
    });
    clearPendingEmailChangeFlow();
    setVerifiedEmailChange(null);
    setEmailCodeSentFor(null);
    setEmailCode('');
    setEmailStepNotice(null);
    setEmailStepError(null);
    setNeedsEmailReauthPw(false);
    setNeedsEmailGoogleReauth(false);
    setEmail(targetEmail);
    setEmailChangedBanner(
      res && res.emailVerificationLinkSent
        ? t('emailUpdatedFirebaseConfirmNotice').replace(/\{email\}/g, targetEmail)
        : `Email updated to ${targetEmail}!`
    );
  };

  const handleVerifyEmailChangeCode = async () => {
    setErrorMsg(null);
    setEmailStepNotice(null);
    setEmailStepError(null);
    setEmailChangedBanner(null);
    if (!emailCode.trim()) {
      const m = 'Please enter the 6-digit verification code from your current email.';
      setEmailStepError(m);
      setErrorMsg(m);
      return;
    }
    setIsVerifyingEmailCode(true);
    try {
      const token = await verifyEmailChangeCode(typedNormalizedEmail, emailCode.trim());
      const nextVerified = { forEmail: typedNormalizedEmail, token };
      setVerifiedEmailChange(nextVerified);
      savePendingEmailChangeFlow({
        uid: userProfile.userId,
        oldEmail: oldNormalizedEmail,
        newEmail: typedNormalizedEmail,
        emailCodeSentFor: typedNormalizedEmail,
        verifiedEmailChange: nextVerified,
      });
      await applyVerifiedEmailChangeNow(typedNormalizedEmail, token);
    } catch (err: any) {
      const code = String(err?.code || '');
      const m = err?.message || 'Incorrect verification code.';
      if (code === 'GOOGLE_REAUTH_REQUIRED' || m === 'GOOGLE_REAUTH_REQUIRED') {
        setNeedsEmailGoogleReauth(true);
        setEmailStepError(t('googleReauthRequiredNotice'));
        return;
      }
      if (code === 'POPUP_BLOCKED_REAUTH' || code === 'auth/popup-blocked' || m.includes('popup-blocked')) {
        setNeedsEmailGoogleReauth(true);
        setEmailStepError(t('popupBlockedReauthHelp'));
        return;
      }
      if (m.includes('Current Password')) {
        setNeedsEmailReauthPw(true);
        setNeedsRecentLoginPw(true);
      }
      setEmailStepError(m);
      setErrorMsg(m);
    } finally {
      setIsVerifyingEmailCode(false);
    }
  };

  const handleApplyVerifiedEmailWithPassword = async () => {
    if (!verifiedEmailChange || verifiedEmailChange.forEmail !== typedNormalizedEmail) return;
    setErrorMsg(null);
    setEmailStepError(null);
    setIsVerifyingEmailCode(true);

    // Invoke Google re-auth IMMEDIATELY (zero awaits before it) so browsers never block the popup!
    if (needsEmailGoogleReauth || requiresFreshGoogleReauth()) {
      try {
        await reauthenticateWithGoogle();
        setNeedsEmailGoogleReauth(false);
      } catch (reauthErr: any) {
        const code = String(reauthErr?.code || reauthErr?.message || '');
        setNeedsEmailGoogleReauth(true);
        setEmailStepError(
          code.includes('POPUP_BLOCKED') || code.includes('popup-blocked')
            ? t('popupBlockedReauthHelp')
            : code.includes('popup-closed-by-user')
            ? 'Google verification window was closed. Tap the button again to confirm.'
            : reauthErr?.message || t('googleReauthRequiredNotice')
        );
        setIsVerifyingEmailCode(false);
        return;
      }
    }

    try {
      await applyVerifiedEmailChangeNow(typedNormalizedEmail, verifiedEmailChange.token);
    } catch (err: any) {
      const code = String(err?.code || '');
      const m = err?.message || 'Could not complete email update.';
      if (code === 'GOOGLE_REAUTH_REQUIRED' || m === 'GOOGLE_REAUTH_REQUIRED') {
        setNeedsEmailGoogleReauth(true);
        setEmailStepError(t('googleReauthRequiredNotice'));
      } else if (code === 'POPUP_BLOCKED_REAUTH' || code === 'auth/popup-blocked' || m.includes('popup-blocked')) {
        setNeedsEmailGoogleReauth(true);
        setEmailStepError(t('popupBlockedReauthHelp'));
      } else {
        if (m.includes('Current Password')) {
          setNeedsEmailReauthPw(true);
          setNeedsRecentLoginPw(true);
        }
        setEmailStepError(m);
        setErrorMsg(m);
      }
    } finally {
      setIsVerifyingEmailCode(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanUsername = username.trim().replace(/^@+/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
      setErrorMsg('Username must be 3–30 characters using only letters, numbers, and underscores (_).');
      return;
    }
    if (usernameStatus === 'taken') {
      setErrorMsg(t('usernameAlreadyInUse'));
      return;
    }

    if (isEmailChanged) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedNormalizedEmail)) {
        setErrorMsg('Please enter a valid new email address.');
        return;
      }
      if (!isEmailVerifiedForTarget) {
        setErrorMsg(t('emailChangeVerificationRequired'));
        return;
      }
    }

    if (newPassword) {
      const pwCheck = validateStrongPassword(newPassword);
      if (!pwCheck.valid) {
        setErrorMsg(pwCheck.error || 'Password does not meet security requirements.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setErrorMsg('New password and Confirm password do not match.');
        return;
      }
    }

    setIsSaving(true);

    // If email change is verified and Google reauth is stale, run Google popup synchronously first!
    if (isEmailChanged && isEmailVerifiedForTarget && (needsEmailGoogleReauth || requiresFreshGoogleReauth())) {
      try {
        await reauthenticateWithGoogle();
        setNeedsEmailGoogleReauth(false);
      } catch (reauthErr: any) {
        const code = String(reauthErr?.code || reauthErr?.message || '');
        setNeedsEmailGoogleReauth(true);
        const msg =
          code.includes('POPUP_BLOCKED') || code.includes('popup-blocked')
            ? t('popupBlockedReauthHelp')
            : code.includes('popup-closed-by-user')
            ? 'Google verification window was closed. Please try again.'
            : reauthErr?.message || t('googleReauthRequiredNotice');
        setEmailStepError(msg);
        setErrorMsg(msg);
        setIsSaving(false);
        return;
      }
    }

    try {
      await updateUserProfileData({
        username: cleanUsername,
        displayName,
        bio,
        email: typedNormalizedEmail,
        emailChangeToken: isEmailChanged ? verifiedEmailChange?.token : undefined,
        photoURL,
        coverURL,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      clearPendingEmailChangeFlow();
      setSuccessMsg('Profile updated successfully!');
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err: any) {
      const code = String(err?.code || '');
      const msg = err?.message || '';
      if (msg.includes('EMAIL_ALREADY_IN_USE')) {
        setErrorMsg(t('emailAlreadyInUse'));
      } else if (msg.includes('EMAIL_CHANGE_VERIFICATION_REQUIRED')) {
        setErrorMsg(t('emailChangeVerificationRequired'));
      } else if (msg.includes('USERNAME_ALREADY_IN_USE')) {
        setUsernameStatus('taken');
        setErrorMsg(t('usernameAlreadyInUse'));
      } else if (code === 'GOOGLE_REAUTH_REQUIRED' || msg === 'GOOGLE_REAUTH_REQUIRED') {
        setNeedsEmailGoogleReauth(true);
        setEmailStepError(t('googleReauthRequiredNotice'));
        setErrorMsg(t('googleReauthRequiredNotice'));
      } else if (code === 'POPUP_BLOCKED_REAUTH' || code === 'auth/popup-blocked' || msg.includes('popup-blocked')) {
        setNeedsEmailGoogleReauth(true);
        setEmailStepError(t('popupBlockedReauthHelp'));
        setErrorMsg(t('popupBlockedReauthHelp'));
      } else if (msg.includes('Current Password')) {
        setNeedsRecentLoginPw(true);
        setErrorMsg(msg);
      } else {
        setErrorMsg(msg || 'Failed to update profile');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    clearPendingEmailChangeFlow();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <h2 className="font-bold text-base text-slate-900 dark:text-white">
            Edit Profile
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Cover Photo Picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-[#7560DF]" />
              <span>Cover Photo</span>
            </label>
            <div
              onClick={() => coverInputRef.current?.click()}
              className="relative h-24 rounded-2xl overflow-hidden bg-gradient-to-r from-[#503cb3] via-[#7560DF] to-[#9986fa] cursor-pointer group border border-slate-200 dark:border-purple-900/50"
            >
              {coverURL && (
                <img src={coverURL} alt="Cover preview" className="w-full h-full object-cover" />
              )}
              <div className="absolute inset-0 bg-black/35 flex items-center justify-center gap-1.5 text-white text-xs font-bold opacity-85 group-hover:opacity-100 transition-opacity">
                <Camera className="w-4 h-4" />
                <span>{isCompressingCover ? 'Optimizing cover...' : 'Change Cover Photo'}</span>
              </div>
            </div>
            <input
              type="file"
              ref={coverInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleCoverSelect}
            />
          </div>

          {/* Change Avatar */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              <img
                src={photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${userProfile.username}`}
                alt={displayName}
                className="w-20 h-20 rounded-full object-cover ring-4 ring-[#7560DF]/30 shadow-md"
              />
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-6 h-6 text-white" />
              </div>
              <button
                type="button"
                className="absolute bottom-0 right-0 p-1.5 rounded-full bg-[#7560DF] text-white shadow-md"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handlePhotoSelect}
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {isCompressingPhoto ? 'Optimizing photo...' : 'Tap to change profile picture'}
            </span>
          </div>

          {/* Display Name */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[#7560DF]" />
              <span>Display Name</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-950/60 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
            />
          </div>

          {/* Change Username */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <AtSign className="w-3.5 h-3.5 text-[#7560DF]" />
              <span>{t('changeUsernameLabel')}</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                required
                minLength={3}
                maxLength={30}
                placeholder="e.g. abel_tadesse"
                className={`w-full pl-8 pr-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border text-sm text-slate-900 dark:text-white outline-none focus:ring-2 ${
                  usernameStatus === 'taken'
                    ? 'border-rose-400 focus:ring-rose-500'
                    : usernameStatus === 'available'
                    ? 'border-emerald-400 focus:ring-emerald-500'
                    : 'border-slate-200 dark:border-purple-950/60 focus:ring-[#7560DF]'
                }`}
              />
            </div>
            {usernameStatus === 'checking' && (
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{t('checkingUsername')}</span>
              </p>
            )}
            {usernameStatus === 'taken' && (
              <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>{t('usernameAlreadyInUse')}</span>
              </p>
            )}
            {usernameStatus === 'available' && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span>{t('usernameAvailable')}</span>
              </p>
            )}
            {(usernameStatus === 'idle' || usernameStatus === 'invalid') && (
              <p className="text-[11px] text-slate-400">3–30 letters, numbers, or underscore (_)</p>
            )}
          </div>

          {/* Bio */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-[#7560DF]" />
              <span>Bio / Status</span>
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              maxLength={250}
              placeholder="Tell other Ethiopian users about yourself..."
              className="w-full px-3.5 py-2 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-950/60 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF] resize-none"
            />
          </div>

          {/* Change Email with Mandatory Previous/Current Email 6-Digit Code Verification */}
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-[#7560DF]" />
                <span>Email Address</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  setEmail(nextVal);
                  const nextNorm = nextVal.trim().toLowerCase();
                  if (verifiedEmailChange && verifiedEmailChange.forEmail !== nextNorm) {
                    setVerifiedEmailChange(null);
                  }
                  if (emailCodeSentFor && emailCodeSentFor !== nextNorm) {
                    setEmailCodeSentFor(null);
                    setEmailCode('');
                    setEmailStepNotice(null);
                    setNeedsEmailReauthPw(false);
                    clearPendingEmailChangeFlow();
                  } else if (!nextNorm || nextNorm === oldNormalizedEmail) {
                    setNeedsEmailReauthPw(false);
                    clearPendingEmailChangeFlow();
                  }
                  setEmailChangedBanner(null);
                  setEmailStepError(null);
                }}
                required
                className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-950/60 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
              />
            </div>

            {emailChangedBanner && !isEmailChanged && (
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>{emailChangedBanner}</span>
              </div>
            )}

            {isEmailChanged && (
              <div className="p-3.5 rounded-2xl bg-[#7560DF]/8 dark:bg-[#201c38] border border-[#7560DF]/30 space-y-2.5">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#7560DF] shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      {t('emailChangeVerifyTitle')}
                    </p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      {t('emailChangeVerifyDesc')}
                    </p>
                    <p className="text-[11px] font-semibold text-[#7560DF] dark:text-[#B09EFC]">
                      Current email: {userProfile.email}
                    </p>
                  </div>
                </div>

                {!isEmailVerifiedForTarget && (
                  <button
                    type="button"
                    disabled={isSendingEmailCode}
                    onClick={handleSendEmailChangeCode}
                    className="w-full py-2 px-3 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {isSendingEmailCode ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Sending Code...</span>
                      </>
                    ) : (
                      <span>
                        {emailCodeSentFor === typedNormalizedEmail
                          ? t('resendCodeToCurrentEmailBtn')
                          : t('sendCodeToCurrentEmailBtn')}
                      </span>
                    )}
                  </button>
                )}

                {emailCodeSentFor === typedNormalizedEmail && !isEmailVerifiedForTarget && (
                  <div className="space-y-2 pt-1">
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-200 block">
                      {t('emailChangeCodeInputLabel')}
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <KeyRound className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          value={emailCode}
                          onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="123456"
                          className="w-full pl-8 pr-3 py-2 rounded-xl bg-white dark:bg-[#16132b] border border-slate-200 dark:border-purple-950/60 text-sm font-mono tracking-[0.3em] text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={isVerifyingEmailCode || emailCode.length < 6}
                        onClick={handleVerifyEmailChangeCode}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 transition-colors"
                      >
                        {isVerifyingEmailCode ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <span>{t('verifyCodeBtn')}</span>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {isEmailVerifiedForTarget && (
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span>{t('emailChangeVerifiedMsg')}</span>
                    </div>
                    {needsEmailReauthPw && (
                      <div className="space-y-1.5">
                        <input
                          type={showCurrentPw ? 'text' : 'password'}
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="Enter Current Password to confirm"
                          className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#16132b] border border-slate-200 dark:border-purple-950/60 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={isVerifyingEmailCode}
                      onClick={handleApplyVerifiedEmailWithPassword}
                      className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      {isVerifyingEmailCode ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Updating Email...</span>
                        </>
                      ) : needsEmailGoogleReauth || requiresFreshGoogleReauth() ? (
                        <span>{t('reauthGoogleToUpdateEmailBtn')}</span>
                      ) : (
                        <span>Confirm &amp; Update Email Now</span>
                      )}
                    </button>
                  </div>
                )}

                {emailStepNotice && !isEmailVerifiedForTarget && (
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                    {emailStepNotice}
                  </p>
                )}

                {emailStepError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-[11px] flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                    <span>{emailStepError}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Change Password Section */}
          <div className="p-3.5 rounded-2xl bg-slate-50/90 dark:bg-[#201c38]/80 border border-slate-200/80 dark:border-purple-950/60 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
              <Lock className="w-3.5 h-3.5 text-[#7560DF]" />
              <span>{t('changePasswordLabel')}</span>
            </div>

            {(newPassword.length > 0 || needsRecentLoginPw) && (
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Current Password (for security verification)
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPw ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password if prompted"
                    className="w-full pl-3.5 pr-9 py-2 rounded-xl bg-white dark:bg-[#16132b] border border-slate-200 dark:border-purple-950/60 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF] placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPw((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showCurrentPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}

            <div className="relative">
              <input
                type={showNewPw ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (leave blank to keep current)"
                className="w-full pl-3.5 pr-9 py-2.5 rounded-xl bg-white dark:bg-[#16132b] border border-slate-200 dark:border-purple-950/60 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF] placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={() => setShowNewPw((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {newPassword.length > 0 && (
              <>
                <div className="relative">
                  <input
                    type={showConfirmPw ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full pl-3.5 pr-9 py-2 rounded-xl bg-white dark:bg-[#16132b] border border-slate-200 dark:border-purple-950/60 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF] placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPw((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1 pt-0.5 text-[11px]">
                  <span className={pwChecks.minLength ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {pwChecks.minLength ? '✓' : '○'} 8+ characters
                  </span>
                  <span className={pwChecks.hasUppercase ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {pwChecks.hasUppercase ? '✓' : '○'} Uppercase (A-Z)
                  </span>
                  <span className={pwChecks.hasLowercase ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {pwChecks.hasLowercase ? '✓' : '○'} Lowercase (a-z)
                  </span>
                  <span className={pwChecks.hasNumber ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {pwChecks.hasNumber ? '✓' : '○'} Number (0-9)
                  </span>
                  <span className={pwChecks.hasSymbol ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {pwChecks.hasSymbol ? '✓' : '○'} Symbol (!@#$...)
                  </span>
                  <span className={confirmPassword && confirmPassword === newPassword ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {confirmPassword && confirmPassword === newPassword ? '✓' : '○'} Passwords match
                  </span>
                </div>
              </>
            )}
          </div>

          {successMsg && (
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500" />
              <span>{successMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSaving || isCompressingPhoto || isCompressingCover || usernameStatus === 'taken'}
              className="w-full py-3 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] disabled:opacity-60 text-white font-bold text-sm shadow-md shadow-[#7560DF]/25 transition-all flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving Updates...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

