import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { evaluatePasswordStrength, validateStrongPassword } from '../../lib/passwordValidation';
import {
  savePendingForgotPwFlow,
  readPendingForgotPwFlow,
  clearPendingForgotPwFlow,
  savePendingSignupFlow,
  readPendingSignupFlow,
  clearPendingSignupFlow,
} from '../../lib/otpFlowPersistence';
import {
  preloadGoogleIdentity,
  promptInAppGoogleChooser,
  renderInAppGoogleButton,
} from '../../lib/googleIdentity';
import { useBackHandler } from '../../lib/backNavigation';
import { 
  Lock, 
  Mail, 
  User, 
  Loader2, 
  AlertCircle, 
  ArrowRight,
  X,
  KeyRound,
  CheckCircle2,
  ShieldCheck
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
}

type ForgotStep = 'email' | 'code' | 'new_password';
type SignupStep = 'details' | 'code';

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const {
    signIn,
    signUp,
    requestSignUpCode,
    verifySignUpCode,
    signInWithGoogle,
    signInWithGoogleCredential,
    savedAccounts,
    switchSavedAccount,
    currentUser,
    resetPassword,
    requestPasswordResetCode,
    verifyPasswordResetCode,
    completePasswordResetWithToken,
    checkUsernameAvailability,
    pendingReauth,
    clearPendingReauth,
  } = useAuth();
  const { t } = useLanguage();
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [forgotStep, setForgotStep] = useState<ForgotStep>('email');
  const [signupStep, setSignupStep] = useState<SignupStep>('details');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Forgot password & Sign Up OTP states
  const [verificationCode, setVerificationCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showFirebaseResetBackup, setShowFirebaseResetBackup] = useState(false);
  const [restoredSignupFromStorage, setRestoredSignupFromStorage] = useState(false);

  // In-app Google account chooser sheet
  const [showGoogleChooser, setShowGoogleChooser] = useState(false);
  const [gisButtonMounted, setGisButtonMounted] = useState(false);
  const gisButtonRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const wasOpenRef = useRef(false);

  useBackHandler(Boolean(isOpen && showGoogleChooser), () => setShowGoogleChooser(false));
  useBackHandler(Boolean(isOpen && onClose && !showGoogleChooser), () => {
    clearPendingForgotPwFlow();
    clearPendingSignupFlow();
    onClose?.();
  });

  useEffect(() => {
    if (isOpen) {
      void preloadGoogleIdentity();
    } else {
      setShowGoogleChooser(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    if (pendingReauth?.email) {
      wasOpenRef.current = true;
      clearPendingForgotPwFlow();
      clearPendingSignupFlow();
      setMode('signin');
      setSignupStep('details');
      setEmail(pendingReauth.email);
      setPassword('');
      setErrorMsg(null);
      setSuccessMsg(null);
      return;
    }

    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      const pendingSignup = readPendingSignupFlow();
      if (pendingSignup) {
        setMode('signup');
        setSignupStep('code');
        setRestoredSignupFromStorage(true);
        setUsername(pendingSignup.username || '');
        setDisplayName(pendingSignup.displayName || '');
        setEmail(pendingSignup.email);
        setPassword('');
        setVerificationCode('');
        setErrorMsg(null);
        setSuccessMsg(t('signupCodeSentNotice'));
        return;
      }

      const pending = readPendingForgotPwFlow();
      if (pending) {
        setMode('forgot');
        setForgotStep(pending.forgotStep);
        setEmail(pending.email);
        setResetToken(pending.resetToken || '');
        setVerificationCode('');
        setNewPassword('');
        setConfirmNewPassword('');
        setShowFirebaseResetBackup(false);
        setErrorMsg(null);
        setSuccessMsg(
          pending.forgotStep === 'new_password'
            ? 'Code verified! Enter your new password below.'
            : `Enter the 6-digit verification code sent to ${pending.email}.`
        );
      }
    }
  }, [isOpen, pendingReauth, t]);

  useEffect(() => {
    if (!isOpen || mode !== 'signup') {
      setUsernameStatus('idle');
      return;
    }
    const clean = username.trim().replace(/^@+/, '').toLowerCase();
    if (!clean) {
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
      const res = await checkUsernameAvailability(clean);
      if (cancelled) return;
      setUsernameStatus(res.available ? 'available' : res.reason === 'invalid_format' ? 'invalid' : 'taken');
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, mode, username, checkUsernameAvailability]);

  if (!isOpen) return null;

  const resetForgotFlow = () => {
    setForgotStep('email');
    setVerificationCode('');
    setResetToken('');
    setNewPassword('');
    setConfirmNewPassword('');
    setShowFirebaseResetBackup(false);
    clearPendingForgotPwFlow();
  };

  const resetSignupFlow = () => {
    setSignupStep('details');
    setRestoredSignupFromStorage(false);
    setVerificationCode('');
    clearPendingSignupFlow();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      if (mode === 'forgot') {
        if (forgotStep === 'email') {
          await requestPasswordResetCode(email);
          const normEmail = email.trim().toLowerCase();
          setForgotStep('code');
          setShowFirebaseResetBackup(false);
          setSuccessMsg('A 6-digit verification code has been sent to your email.');
          savePendingForgotPwFlow({
            forgotStep: 'code',
            email: normEmail,
            resetToken: '',
          });
        } else if (forgotStep === 'code') {
          if (!verificationCode.trim()) {
            throw new Error('Please enter the verification code sent to your email.');
          }
          const token = await verifyPasswordResetCode(email, verificationCode);
          const normEmail = email.trim().toLowerCase();
          setResetToken(token);
          setForgotStep('new_password');
          setSuccessMsg('Code verified! Enter your new password below.');
          savePendingForgotPwFlow({
            forgotStep: 'new_password',
            email: normEmail,
            resetToken: token,
          });
        } else {
          const pwCheck = validateStrongPassword(newPassword);
          if (!pwCheck.valid) {
            throw new Error(pwCheck.error || 'Password does not meet security requirements.');
          }
          if (newPassword !== confirmNewPassword) {
            throw new Error('Passwords do not match.');
          }
          await completePasswordResetWithToken(email, resetToken, newPassword);
          setMode('signin');
          resetForgotFlow();
          setPassword('');
          setSuccessMsg('Password updated! You can now log in with your new password.');
        }
      } else if (mode === 'signup') {
        const cleanUsername = username.trim().replace(/^@+/, '').toLowerCase();
        const normEmail = email.trim().toLowerCase();
        if (signupStep === 'details') {
          if (!cleanUsername) throw new Error('Please choose a username');
          if (usernameStatus === 'taken') {
            throw new Error('USERNAME_ALREADY_IN_USE');
          }
          const pwCheck = validateStrongPassword(password);
          if (!pwCheck.valid) {
            throw new Error(pwCheck.error || 'Password does not meet security requirements.');
          }
          await requestSignUpCode(cleanUsername, normEmail);
          setSignupStep('code');
          setRestoredSignupFromStorage(false);
          setVerificationCode('');
          setSuccessMsg(t('signupCodeSentNotice'));
          savePendingSignupFlow({
            signupStep: 'code',
            username: cleanUsername,
            displayName: displayName.trim(),
            email: normEmail,
          });
        } else {
          if (verificationCode.trim().length < 6) {
            throw new Error('Please enter the 6-digit verification code sent to your email.');
          }
          const pwCheck = validateStrongPassword(password);
          if (!pwCheck.valid) {
            throw new Error(pwCheck.error || 'Password does not meet security requirements.');
          }
          const signupToken = await verifySignUpCode(normEmail, verificationCode.trim());
          await signUp(cleanUsername, normEmail, password, displayName || undefined, signupToken);
          resetSignupFlow();
        }
      } else {
        await signIn(email, password);
      }
    } catch (err: any) {
      let msg = err.message || 'Authentication failed. Please check your details.';
      if (err?.code === 'EMAIL_SERVICE_NOT_CONFIGURED' || msg.includes('EMAIL_SERVICE_NOT_CONFIGURED')) {
        if (mode === 'forgot') setShowFirebaseResetBackup(true);
        msg = t('emailServiceNotConfigured');
      } else if (err?.code === 'FIREBASE_ADMIN_IAM_REQUIRED') {
        setShowFirebaseResetBackup(true);
      } else if (msg.includes('DEVICE_ACCOUNT_LIMIT_REACHED')) {
        msg = t('deviceAccountLimitReached');
      } else if (msg.includes('USERNAME_ALREADY_IN_USE')) {
        msg = t('usernameAlreadyInUse');
      } else if (msg.includes('SIGNUP_VERIFICATION_REQUIRED')) {
        msg = t('signupVerificationRequired');
      } else if (err?.pendingEmailLinkConfirmation) {
        msg = t('emailLoginNeedsConfirmationLink').replace(/\{email\}/g, email.trim().toLowerCase());
      } else if (msg.includes('auth/invalid-credential') || msg.includes('auth/user-not-found') || msg.includes('auth/wrong-password')) {
        msg = 'Invalid email or password. Please check your credentials or continue with Google.';
      } else if (msg.includes('auth/email-already-in-use') || msg.includes('EMAIL_ALREADY_IN_USE')) {
        msg = t('emailAlreadyInUse');
      }
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResendSignUpCode = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      const cleanUsername = username.trim().replace(/^@+/, '').toLowerCase();
      const normEmail = email.trim().toLowerCase();
      await requestSignUpCode(cleanUsername, normEmail);
      setSuccessMsg(t('signupCodeSentNotice'));
      savePendingSignupFlow({
        signupStep: 'code',
        username: cleanUsername,
        displayName: displayName.trim(),
        email: normEmail,
      });
    } catch (err: any) {
      let msg = err?.message || 'Could not resend verification code.';
      if (err?.code === 'EMAIL_SERVICE_NOT_CONFIGURED' || msg.includes('EMAIL_SERVICE_NOT_CONFIGURED')) {
        msg = t('emailServiceNotConfigured');
      } else if (msg.includes('EMAIL_ALREADY_IN_USE')) {
        msg = t('emailAlreadyInUse');
      }
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleFirebaseResetBackup = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      await resetPassword(email);
      setSuccessMsg(t('resetEmailSent'));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not send reset email.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleError = (err: any) => {
    let msg = err?.message || 'Google sign-in was cancelled';
    if (msg.includes('DEVICE_ACCOUNT_LIMIT_REACHED')) {
      msg = t('deviceAccountLimitReached');
    } else if (msg.includes('EMAIL_ALREADY_IN_USE') || msg.includes('auth/email-already-in-use')) {
      msg = t('emailAlreadyInUse');
    }
    setErrorMsg(msg);
  };

  useEffect(() => {
    if (!showGoogleChooser) {
      setGisButtonMounted(false);
      return;
    }
    let cancelled = false;
    void preloadGoogleIdentity().then(() => {
      if (cancelled || !gisButtonRef.current) return;
      const rendered = renderInAppGoogleButton(gisButtonRef.current, async (idToken) => {
        setErrorMsg(null);
        setLoading(true);
        try {
          await signInWithGoogleCredential(idToken);
          setShowGoogleChooser(false);
        } catch (err: any) {
          handleGoogleError(err);
        } finally {
          setLoading(false);
        }
      });
      setGisButtonMounted(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [showGoogleChooser]);

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      // 1. Trigger in-app Google One Tap / FedCM chooser directly inside the app
      const res = await promptInAppGoogleChooser();
      if (res.status === 'credential') {
        try {
          await signInWithGoogleCredential(res.idToken);
          return;
        } catch {
          // If Firebase rejects token audience or needs fallback chooser, show in-app chooser
          setShowGoogleChooser(true);
          return;
        }
      }
      if (res.status === 'dismissed') {
        return;
      }
      // 2. Fallback: open in-app Google Account Sheet (saved emails + embedded GIS button + account picker)
      setShowGoogleChooser(true);
    } catch (err: any) {
      handleGoogleError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDirectGoogleSelectAccount = async (loginHint?: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      await signInWithGoogle(loginHint);
      setShowGoogleChooser(false);
    } catch (err: any) {
      handleGoogleError(err);
    } finally {
      setLoading(false);
    }
  };

  const activePwChecks = evaluatePasswordStrength(
    mode === 'forgot' && forgotStep === 'new_password' ? newPassword : password
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-300">
      <div className="relative bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 overflow-hidden flex flex-col max-h-[95vh] overflow-y-auto">
        {onClose && (
          <button
            type="button"
            onClick={() => {
              clearPendingForgotPwFlow();
              clearPendingSignupFlow();
              onClose();
            }}
            className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-950/40 z-10"
            title="Cancel Add Account"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Brand Banner */}
        <div className="pt-7 pb-4 px-6 text-center bg-gradient-to-b from-[#7560DF]/15 via-transparent to-transparent flex flex-col items-center">
          <div className="w-16 h-16 rounded-3xl p-1 bg-gradient-to-tr from-[#7560DF] to-[#A494FA] shadow-xl shadow-[#7560DF]/30 mb-2.5 flex items-center justify-center bg-white overflow-hidden">
            <img
              src="/assets/aistudio/20261111_152710_57efcc53.png"
              alt="Ethio Chat Logo"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>

          <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
            ETHIO CHAT
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-xs font-medium">
            Modern Ethiopian Social Media & Real-Time Messenger
          </p>

          {mode !== 'forgot' && (
            <button
              type="button"
              disabled={loading}
              onClick={handleGoogleSignIn}
              className="w-full mt-4 py-2.5 px-4 rounded-2xl bg-white dark:bg-[#201c38] hover:bg-slate-50 dark:hover:bg-[#272244] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-purple-950/60 font-bold text-xs sm:text-sm flex items-center justify-center gap-2.5 shadow-sm transition-all"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>Continue with Google</span>
            </button>
          )}

          <div className="flex items-center gap-2 w-full my-3">
            <div className="h-px bg-slate-200 dark:bg-purple-950/50 flex-1" />
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              {mode === 'forgot'
                ? forgotStep === 'email'
                  ? '1. Send Email Code'
                  : forgotStep === 'code'
                  ? '2. Verify Code'
                  : '3. New Password'
                : mode === 'signup' && signupStep === 'code'
                ? '2. Verify Email Code'
                : 'Or Use Email & Password'}
            </span>
            <div className="h-px bg-slate-200 dark:bg-purple-950/50 flex-1" />
          </div>

          {mode !== 'forgot' && (
            <div className="p-1 bg-slate-100 dark:bg-[#201c38] rounded-2xl flex items-center w-full border border-slate-200/60 dark:border-purple-950/40">
              <button
                type="button"
                onClick={() => {
                  clearPendingForgotPwFlow();
                  resetSignupFlow();
                  setMode('signin');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
                  mode === 'signin'
                    ? 'bg-white dark:bg-[#7560DF] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
                }`}
              >
                Log In
              </button>
              <button
                type="button"
                onClick={() => {
                  clearPendingForgotPwFlow();
                  setMode('signup');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
                  mode === 'signup'
                    ? 'bg-white dark:bg-[#7560DF] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
                }`}
              >
                Sign Up
              </button>
            </div>
          )}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="px-6 pb-5 space-y-3">
          {pendingReauth && mode === 'signin' && (
            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 text-xs flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
                <span>
                  {pendingReauth.reason === 'session_required'
                    ? 'Please sign in once with your password or Google to activate your verified Firebase session on this device.'
                    : t('passwordChangedRelogin')}
                </span>
              </div>
              <button
                type="button"
                onClick={clearPendingReauth}
                className="text-amber-600 dark:text-amber-300 hover:opacity-75 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {mode === 'signup' && signupStep === 'details' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Username (@handle)
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={30}
                    value={username}
                    onChange={(e) =>
                      setUsername(e.target.value.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, ''))
                    }
                    placeholder="e.g. abel_tadesse"
                    className={`w-full pl-10 pr-4 py-2 rounded-2xl bg-slate-50 dark:bg-[#201c38] border text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 ${
                      usernameStatus === 'taken'
                        ? 'border-rose-400 focus:ring-rose-500'
                        : usernameStatus === 'available'
                        ? 'border-emerald-400 focus:ring-emerald-500'
                        : 'border-slate-200 dark:border-purple-900/50 focus:ring-[#7560DF]'
                    }`}
                  />
                </div>
                {usernameStatus === 'checking' && (
                  <p className="text-[11px] text-slate-400 flex items-center gap-1 px-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{t('checkingUsername')}</span>
                  </p>
                )}
                {usernameStatus === 'taken' && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1 px-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{t('usernameAlreadyInUse')}</span>
                  </p>
                )}
                {usernameStatus === 'available' && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 px-1">
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    <span>{t('usernameAvailable')}</span>
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Full Display Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Abel Tadesse"
                    className="w-full pl-10 pr-4 py-2 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
                  />
                </div>
              </div>
            </>
          )}

          {/* Email field */}
          {((mode === 'signin') || (mode === 'signup' && signupStep === 'details') || (mode === 'forgot' && forgotStep === 'email')) && (
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-10 pr-4 py-2 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
                />
              </div>
            </div>
          )}

          {/* Sign Up Step 2: 6-Digit Email Verification Code */}
          {mode === 'signup' && signupStep === 'code' && (
            <div className="space-y-2.5">
              <div className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#201c38] text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-bold text-slate-800 dark:text-white">@{username}</span>
                  <span className="mx-1.5 text-slate-400">•</span>
                  <span className="truncate font-semibold">{email}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    resetSignupFlow();
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className="text-[#7560DF] dark:text-[#A798F8] font-bold hover:underline shrink-0"
                >
                  Change
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('verificationCodeLabel')}
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    maxLength={8}
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-base font-mono tracking-[0.35em] text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Forgot Step 2: 6-Digit Verification Code Input */}
          {mode === 'forgot' && forgotStep === 'code' && (
            <div className="space-y-2">
              <div className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#201c38] text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{email}</span>
                <button
                  type="button"
                  onClick={() => {
                    clearPendingForgotPwFlow();
                    setForgotStep('email');
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className="text-[#7560DF] dark:text-[#A798F8] font-bold hover:underline shrink-0"
                >
                  Change
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('verificationCodeLabel')}
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    maxLength={8}
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-base font-mono tracking-[0.35em] text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Forgot Step 3: New Password Form */}
          {mode === 'forgot' && forgotStep === 'new_password' && (
            <div className="space-y-2.5">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('newPasswordLabel')}
                </label>
                <div className="relative">
                  <ShieldCheck className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-500" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="8+ chars (A-Z, a-z, 0-9, symbol)"
                    className="w-full pl-10 pr-4 py-2 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('confirmPasswordLabel')}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full pl-10 pr-4 py-2 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1 px-1 text-[11px]">
                <span className={activePwChecks.minLength ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                  {activePwChecks.minLength ? '✓' : '○'} 8+ characters
                </span>
                <span className={activePwChecks.hasUppercase ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                  {activePwChecks.hasUppercase ? '✓' : '○'} Uppercase (A-Z)
                </span>
                <span className={activePwChecks.hasLowercase ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                  {activePwChecks.hasLowercase ? '✓' : '○'} Lowercase (a-z)
                </span>
                <span className={activePwChecks.hasNumber ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                  {activePwChecks.hasNumber ? '✓' : '○'} Number (0-9)
                </span>
                <span className={activePwChecks.hasSymbol ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                  {activePwChecks.hasSymbol ? '✓' : '○'} Symbol (!@#$...)
                </span>
              </div>
            </div>
          )}

          {/* Regular Password (also shown in signup 'code' step if mobile browser discarded page memory and restored from storage) */}
          {(mode === 'signin' || (mode === 'signup' && (signupStep === 'details' || restoredSignupFromStorage))) && (
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  required
                  minLength={mode === 'signup' ? 8 : 6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? '8+ chars (A-Z, a-z, 0-9, symbol)' : '••••••••'}
                  className="w-full pl-10 pr-4 py-2 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
                />
              </div>
              {mode === 'signup' && (
                <div className="grid grid-cols-2 gap-1 pt-1 px-1 text-[11px]">
                  <span className={activePwChecks.minLength ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {activePwChecks.minLength ? '✓' : '○'} 8+ characters
                  </span>
                  <span className={activePwChecks.hasUppercase ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {activePwChecks.hasUppercase ? '✓' : '○'} Uppercase (A-Z)
                  </span>
                  <span className={activePwChecks.hasLowercase ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {activePwChecks.hasLowercase ? '✓' : '○'} Lowercase (a-z)
                  </span>
                  <span className={activePwChecks.hasNumber ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {activePwChecks.hasNumber ? '✓' : '○'} Number (0-9)
                  </span>
                  <span className={activePwChecks.hasSymbol ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {activePwChecks.hasSymbol ? '✓' : '○'} Symbol (!@#$...)
                  </span>
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-sm shadow-md shadow-[#7560DF]/25 transition-all flex items-center justify-center gap-2 mt-1"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <span>
                  {mode === 'forgot'
                    ? forgotStep === 'email'
                      ? t('sendCodeBtn')
                      : forgotStep === 'code'
                      ? t('verifyCodeBtn')
                      : t('updatePasswordBtn')
                    : mode === 'signup'
                    ? signupStep === 'details'
                      ? t('sendCodeBtn')
                      : t('verifyAndCreateAccountBtn')
                    : 'Log In to Ethio Chat'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          {mode === 'signup' && signupStep === 'code' && (
            <button
              type="button"
              disabled={loading}
              onClick={handleResendSignUpCode}
              className="w-full py-2 rounded-2xl border border-[#7560DF]/40 text-[#7560DF] dark:text-[#B09EFC] font-bold text-xs hover:bg-[#7560DF]/10 transition-colors"
            >
              {t('resendCodeBtn')}
            </button>
          )}

          {mode === 'forgot' && showFirebaseResetBackup && (
            <button
              type="button"
              disabled={loading || !email.trim()}
              onClick={handleFirebaseResetBackup}
              className="w-full py-2 rounded-2xl border border-[#7560DF]/40 text-[#7560DF] dark:text-[#B09EFC] font-bold text-xs hover:bg-[#7560DF]/10 transition-colors"
            >
              {t('sendResetLink')} (Firebase)
            </button>
          )}

          {mode === 'signin' && (
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => {
                  setMode('forgot');
                  resetForgotFlow();
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className="text-xs font-bold text-[#7560DF] dark:text-[#A798F8] hover:underline"
              >
                {t('forgotPassword')}
              </button>
            </div>
          )}

          {mode === 'forgot' && (
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  resetForgotFlow();
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-[#7560DF] hover:underline"
              >
                {t('backToLogin')}
              </button>
            </div>
          )}
        </form>

        {/* In-App Google Account Chooser Overlay */}
        {showGoogleChooser && (
          <div
            onClick={() => setShowGoogleChooser(false)}
            className="absolute inset-0 z-30 bg-slate-950/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-white dark:bg-[#1a1633] rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-purple-900/60 shadow-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-white dark:bg-[#231e45] border border-slate-200 dark:border-purple-900/50 flex items-center justify-center shadow-sm">
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">
                      Choose an account
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Sign in to Ethio Chat right inside the app
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGoogleChooser(false)}
                  className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {savedAccounts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">
                    Accounts on this device
                  </p>
                  <div className="space-y-1.5">
                    {savedAccounts.map((acc) => {
                      const isCurrent = acc.uid === currentUser?.uid;
                      return (
                        <button
                          key={acc.uid}
                          type="button"
                          disabled={loading || isCurrent}
                          onClick={async () => {
                            setErrorMsg(null);
                            setLoading(true);
                            try {
                              await switchSavedAccount(acc);
                              setShowGoogleChooser(false);
                              onClose?.();
                            } catch {
                              await handleDirectGoogleSelectAccount(acc.email);
                            } finally {
                              setLoading(false);
                            }
                          }}
                          className="w-full p-2.5 rounded-2xl border border-slate-200 dark:border-purple-900/50 hover:bg-slate-50 dark:hover:bg-[#231e45] flex items-center gap-3 text-left transition-colors disabled:opacity-60"
                        >
                          <img
                            src={acc.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${acc.username}`}
                            alt={acc.displayName}
                            className="w-9 h-9 rounded-full object-cover shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {acc.displayName}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {acc.email}
                            </p>
                          </div>
                          {isCurrent ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#7560DF]/15 text-[#7560DF]">
                              Active
                            </span>
                          ) : (
                            <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Embedded Google Identity Services personalized chooser button */}
              <div
                ref={gisButtonRef}
                className={gisButtonMounted ? 'flex justify-center pt-1' : 'hidden'}
              />

              <button
                type="button"
                disabled={loading}
                onClick={() => handleDirectGoogleSelectAccount()}
                className="w-full py-2.5 px-4 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] disabled:opacity-60 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-[#7560DF]/20 transition-all"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4" />
                )}
                <span>
                  {savedAccounts.length > 0
                    ? 'Choose another Google email'
                    : 'Choose Google account'}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
