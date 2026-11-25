import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Crown,
  ExternalLink,
  ImagePlus,
  Loader2,
  QrCode,
  Send,
  ShieldAlert,
  Smartphone,
  Upload,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import { PaymentMethod, PaymentRequest, SubscriptionPackage } from '../../types';
import {
  PAYMENT_CONFIRMATION_MESSAGE,
  formatCurrencyEtb,
  formatCurrencyUsd,
  isSubscriptionActive,
  submitSubscriptionPayment,
} from '../../lib/subscriptionHelpers';
import { GoldVerifiedBadge } from '../common/GoldVerifiedBadge';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({ isOpen, onClose }) => {
  const {
    currentUser,
    userProfile,
    subscriptionConfig,
    getUserSubscription,
    hasVerifiedFirebaseSession,
  } = useAuth();

  const [selectedPackage, setSelectedPackage] = useState<SubscriptionPackage | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('telebirr');
  const [transactionId, setTransactionId] = useState('');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submittedConfirmation, setSubmittedConfirmation] = useState<PaymentRequest | null>(null);
  const [userPayments, setUserPayments] = useState<PaymentRequest[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    const q = query(
      collection(db, 'premium_payment_requests'),
      where('userId', '==', currentUser.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: PaymentRequest[] = [];
        snap.forEach((d) => rows.push(d.data() as PaymentRequest));
        rows.sort(
          (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
        );
        setUserPayments(rows);
      },
      () => {
        // ignore if user lacks auth session token
      }
    );
    return () => unsub();
  }, [isOpen, currentUser?.uid]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedPackage(null);
      setPaymentMethod('telebirr');
      setTransactionId('');
      setScreenshotFile(null);
      setScreenshotPreview('');
      setErrorMsg('');
      setSubmittedConfirmation(null);
      setCopiedKey(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const activeSubscription = getUserSubscription(currentUser?.uid);
  const isCurrentlyPremium = isSubscriptionActive(activeSubscription);
  const pendingPayment =
    userPayments.find((p) => String(p.status || '').toLowerCase() === 'pending') || null;
  const latestRejectedPayment =
    !pendingPayment && String(userPayments[0]?.status || '').toLowerCase() === 'rejected'
      ? userPayments[0]
      : null;

  const handleCopy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // ignore clipboard restriction
    }
  };

  const handlePickScreenshot = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid image file (PNG, JPG, WEBP) for your screenshot.');
      return;
    }
    setErrorMsg('');
    setScreenshotFile(file);
    const url = URL.createObjectURL(file);
    setScreenshotPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  const handleMethodChange = (next: PaymentMethod) => {
    setPaymentMethod(next);
    setErrorMsg('');
    if (next === 'binance') {
      setTransactionId('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !selectedPackage) return;
    setErrorMsg('');
    setSubmitting(true);

    try {
      const created = await submitSubscriptionPayment({
        userProfile,
        selectedPackage,
        method: paymentMethod,
        transactionId: paymentMethod === 'binance' ? undefined : transactionId,
        screenshotFile,
        requireScreenshot: subscriptionConfig.requireScreenshot !== false,
      });
      setSubmittedConfirmation(created);
      setTransactionId('');
      setScreenshotFile(null);
      if (screenshotPreview) {
        URL.revokeObjectURL(screenshotPreview);
        setScreenshotPreview('');
      }
    } catch (err: any) {
      setErrorMsg(
        err?.message || 'Unable to submit payment request. Please check your details and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white dark:bg-[#131024] w-full sm:max-w-xl h-[92dvh] sm:h-auto sm:max-h-[90dvh] rounded-t-3xl sm:rounded-3xl border border-slate-200/80 dark:border-purple-950/60 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-purple-950/50 flex items-center justify-between gap-3 bg-white dark:bg-[#16132b] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {selectedPackage && !submittedConfirmation ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedPackage(null);
                  setErrorMsg('');
                }}
                className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#221d3d] hover:bg-slate-200 dark:hover:bg-[#2d264f] flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors"
                aria-label="Back to packages"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
                <Crown className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                <span>{selectedPackage ? 'Complete Payment' : 'Subscription'}</span>
                <GoldVerifiedBadge forceShow size="sm" />
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {selectedPackage
                  ? `${selectedPackage.label} · ${formatCurrencyUsd(selectedPackage.priceUsd)} (${formatCurrencyEtb(selectedPackage.priceEtb)})`
                  : 'Premium membership & Gold Verified Badge'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#221d3d] hover:bg-slate-200 dark:hover:bg-[#2d264f] flex items-center justify-center text-slate-500 dark:text-slate-300 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Active Subscription Card */}
          {isCurrentlyPremium && activeSubscription && (
            <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/15 via-amber-400/10 to-yellow-500/5 border border-amber-500/35 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GoldVerifiedBadge forceShow size="md" />
                  <span className="font-extrabold text-sm text-amber-700 dark:text-amber-300">
                    Gold Verified · ACTIVE
                  </span>
                </div>
                <span className="text-xs font-bold text-amber-700 dark:text-amber-300 tabular-nums">
                  {activeSubscription.packageLabel}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-300 pt-1">
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                    Start Date
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatDate(activeSubscription.premiumStartDate || activeSubscription.startDate)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                    Expires On
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatDate(activeSubscription.premiumExpiryDate || activeSubscription.expiresAt)}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-amber-700/90 dark:text-amber-200/80 pt-0.5">
                Renewing early extends your subscription directly from {formatDate(activeSubscription.premiumExpiryDate || activeSubscription.expiresAt)} once approved.
              </p>
            </div>
          )}

          {/* Expired Subscription Card */}
          {activeSubscription && !isCurrentlyPremium && (
            <div className="p-4 rounded-2xl bg-slate-100 dark:bg-[#1c1836] border border-slate-300/80 dark:border-purple-900/60 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  <span className="font-extrabold text-sm text-slate-800 dark:text-slate-200">
                    Subscription Status · EXPIRED
                  </span>
                </div>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                  {activeSubscription.packageLabel}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300 pt-1">
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                    Start Date
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatDate(activeSubscription.premiumStartDate || activeSubscription.startDate)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                    Expired On
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatDate(activeSubscription.premiumExpiryDate || activeSubscription.expiresAt)}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Your Gold Verified Badge has been removed automatically. Subscribe below to renew your Premium access.
              </p>
            </div>
          )}

          {/* Confirmation Screen after Payment Submission */}
          {submittedConfirmation ? (
            <div className="py-6 px-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  Payment Submitted · PENDING
                </h3>
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed max-w-md mx-auto">
                  {PAYMENT_CONFIRMATION_MESSAGE}
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-white/80 dark:bg-[#191532] border border-slate-200/80 dark:border-purple-950/50 text-left text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Package</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {submittedConfirmation.packageLabel}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Method</span>
                  <span className="font-bold uppercase text-slate-900 dark:text-white">
                    {submittedConfirmation.method === 'cbe'
                      ? 'CBE Bank'
                      : submittedConfirmation.method === 'binance'
                      ? 'Binance Pay'
                      : 'Telebirr'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Amount</span>
                  <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                    {formatCurrencyUsd(submittedConfirmation.amountUsd)} (
                    {formatCurrencyEtb(submittedConfirmation.amountEtb)})
                  </span>
                </div>
                {submittedConfirmation.transactionId && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Transaction ID</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {submittedConfirmation.transactionId}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Status</span>
                  <span className="font-extrabold text-amber-600 dark:text-amber-400">
                    PENDING VERIFICATION
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-sm transition-colors"
              >
                Done
              </button>
            </div>
          ) : pendingPayment ? (
            /* Pending Payment Lock Banner */
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/35 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="space-y-1 min-w-0">
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                    Payment Verification · PENDING
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {PAYMENT_CONFIRMATION_MESSAGE}
                  </p>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/80 dark:bg-[#191532] border border-slate-200/70 dark:border-purple-950/50 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Selected Plan</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {pendingPayment.packageLabel}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Payment Method</span>
                  <span className="font-bold uppercase text-slate-900 dark:text-white">
                    {pendingPayment.method === 'cbe'
                      ? 'CBE Bank'
                      : pendingPayment.method === 'binance'
                      ? 'Binance Pay'
                      : 'Telebirr'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Amount</span>
                  <span className="font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatCurrencyUsd(pendingPayment.amountUsd)} (
                    {formatCurrencyEtb(pendingPayment.amountEtb)})
                  </span>
                </div>
                {pendingPayment.transactionId && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Transaction ID</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {pendingPayment.transactionId}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Submitted</span>
                  <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                    {formatDate(pendingPayment.submittedAt)}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Duplicate requests cannot be submitted while a payment is PENDING. Your Gold
                Verified Badge activates automatically as soon as your payment is approved.
              </p>
            </div>
          ) : !selectedPackage ? (
            /* Step 1: Subscription Packages List */
            <div className="space-y-4">
              {latestRejectedPayment && (
                <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2.5 text-xs">
                  <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-rose-600 dark:text-rose-400">
                      Previous payment request · REJECTED
                    </p>
                    {latestRejectedPayment.rejectionReason && (
                      <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                        Reason: {latestRejectedPayment.rejectionReason}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {!subscriptionConfig.subscriptionsEnabled && (
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs">
                  <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-slate-700 dark:text-slate-200">
                    New subscription submissions are temporarily paused by the Owner.
                  </p>
                </div>
              )}

              {!currentUser || !hasVerifiedFirebaseSession && !currentUser ? null : null}

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#1b1733] border border-slate-200/80 dark:border-purple-950/50 space-y-2">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="w-5 h-5 text-amber-500" />
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                    Unlock Your Gold Verified Badge
                  </h3>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Stand out across Profiles, Posts, Comments, and Chats with an official Gold
                  Verified Badge. Choose a package below and pay via Telebirr, CBE Bank, or Binance
                  Pay.
                </p>
              </div>

              <div className="space-y-3">
                {subscriptionConfig.packages.map((pkg) => {
                  const isBestValue = pkg.months >= 12;
                  return (
                    <div
                      key={pkg.id}
                      className={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                        isBestValue
                          ? 'bg-gradient-to-r from-amber-500/10 via-[#7560DF]/5 to-transparent border-amber-500/45 shadow-sm'
                          : 'bg-white dark:bg-[#191532] border-slate-200 dark:border-purple-950/50 hover:border-[#7560DF]/60'
                      }`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-extrabold text-slate-900 dark:text-white">
                            {pkg.label}
                          </h4>
                          {isBestValue && (
                            <span className="text-[10px] font-extrabold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                              Best Value
                            </span>
                          )}
                        </div>
                        <p className="text-base font-extrabold text-[#7560DF] dark:text-[#B09EFC] tabular-nums">
                          {formatCurrencyUsd(pkg.priceUsd)}{' '}
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                            ({formatCurrencyEtb(pkg.priceEtb)})
                          </span>
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={!subscriptionConfig.subscriptionsEnabled}
                        onClick={() => {
                          setSelectedPackage(pkg);
                          setErrorMsg('');
                        }}
                        className="px-4 py-2.5 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs sm:text-sm shrink-0 shadow-sm shadow-[#7560DF]/25 transition-colors"
                      >
                        {isCurrentlyPremium ? 'Renew' : activeSubscription ? 'Renew' : 'Subscribe'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Step 2: Payment Page (Telebirr / CBE Bank / Binance Pay) */
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Payment Option Selector */}
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Choose Payment Method
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'telebirr', label: 'Telebirr', icon: Smartphone },
                      { id: 'cbe', label: 'CBE Bank', icon: Building2 },
                      { id: 'binance', label: 'Binance', icon: Wallet },
                    ] as const
                  ).map((opt) => {
                    const Icon = opt.icon;
                    const active = paymentMethod === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleMethodChange(opt.id)}
                        className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center gap-1.5 ${
                          active
                            ? 'bg-[#7560DF] text-white border-[#7560DF] shadow-md shadow-[#7560DF]/25'
                            : 'bg-slate-50 dark:bg-[#1c1836] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-purple-950/50 hover:border-[#7560DF]/50'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="text-xs font-extrabold">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Payment Instructions Box */}
              {paymentMethod === 'telebirr' && (
                <div className="p-4 rounded-2xl bg-emerald-500/8 border border-emerald-500/30 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                      Telebirr Payment Details
                    </span>
                    <span className="text-xs font-extrabold tabular-nums text-slate-900 dark:text-white">
                      {formatCurrencyEtb(selectedPackage.priceEtb)}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-[#17132e] border border-slate-200/80 dark:border-purple-950/50">
                      <div>
                        <span className="text-[11px] text-slate-500 block">Account Number</span>
                        <span className="font-mono font-extrabold text-sm text-slate-900 dark:text-white tabular-nums">
                          {subscriptionConfig.telebirrAccountNumber}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopy(subscriptionConfig.telebirrAccountNumber, 'telebirr')
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#252046] hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-bold text-[11px] flex items-center gap-1"
                      >
                        {copiedKey === 'telebirr' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="flex items-center justify-between px-1">
                      <span className="text-slate-500 dark:text-slate-400">Account Name</span>
                      <span className="font-extrabold text-slate-900 dark:text-white">
                        {subscriptionConfig.telebirrAccountName}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {paymentMethod === 'cbe' && (
                <div className="p-4 rounded-2xl bg-purple-500/8 border border-purple-500/30 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-purple-700 dark:text-purple-300">
                      CBE Bank Transfer Details
                    </span>
                    <span className="text-xs font-extrabold tabular-nums text-slate-900 dark:text-white">
                      {formatCurrencyEtb(selectedPackage.priceEtb)}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-[#17132e] border border-slate-200/80 dark:border-purple-950/50">
                      <div>
                        <span className="text-[11px] text-slate-500 block">Account Number</span>
                        <span className="font-mono font-extrabold text-sm text-slate-900 dark:text-white tabular-nums">
                          {subscriptionConfig.cbeAccountNumber}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(subscriptionConfig.cbeAccountNumber, 'cbe')}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#252046] hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-bold text-[11px] flex items-center gap-1"
                      >
                        {copiedKey === 'cbe' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="flex items-center justify-between px-1">
                      <span className="text-slate-500 dark:text-slate-400">Account Name</span>
                      <span className="font-extrabold text-slate-900 dark:text-white">
                        {subscriptionConfig.cbeAccountName}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {paymentMethod === 'binance' && (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/35 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                      Binance Pay Details
                    </span>
                    <span className="text-xs font-extrabold tabular-nums text-slate-900 dark:text-white">
                      {formatCurrencyUsd(selectedPackage.priceUsd)} USDT
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-slate-500 dark:text-slate-400">Payment Method</span>
                      <span className="font-extrabold text-slate-900 dark:text-white">
                        Binance Pay
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-[#17132e] border border-slate-200/80 dark:border-purple-950/50">
                      <div className="min-w-0">
                        <span className="text-[11px] text-slate-500 block">Binance Email</span>
                        <span className="font-mono font-extrabold text-sm text-slate-900 dark:text-white break-all">
                          {subscriptionConfig.binanceUid}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(subscriptionConfig.binanceUid, 'binance')}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-[11px] flex items-center gap-1 transition-colors shrink-0"
                      >
                        {copiedKey === 'binance' ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>

                    {subscriptionConfig.binancePaymentLink && (
                      <a
                        href={subscriptionConfig.binancePaymentLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-2.5 px-3 rounded-xl bg-white dark:bg-[#17132e] border border-amber-500/40 hover:border-amber-500 text-amber-700 dark:text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Open Binance Payment Link</span>
                      </a>
                    )}

                    {subscriptionConfig.binanceQrCodeUrl && (
                      <div className="p-3 rounded-xl bg-white dark:bg-[#17132e] border border-slate-200/80 dark:border-purple-950/50 flex flex-col items-center gap-2">
                        <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                          <QrCode className="w-3.5 h-3.5" />
                          Scan Binance Pay QR Code
                        </span>
                        <img
                          src={subscriptionConfig.binanceQrCodeUrl}
                          alt="Binance Pay QR Code"
                          className="w-40 h-40 object-contain rounded-lg bg-white p-1"
                        />
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    Please send the exact{' '}
                    <span className="font-bold tabular-nums">
                      {formatCurrencyUsd(selectedPackage.priceUsd)} USDT
                    </span>{' '}
                    payment using <strong>Binance Pay</strong> to{' '}
                    <span className="font-mono font-bold break-all">{subscriptionConfig.binanceUid}</span>,
                    then upload your payment confirmation screenshot below. Payments stay{' '}
                    <strong>PENDING</strong> until our Owner or Admin verifies the transfer directly
                    in Binance.
                  </p>
                </div>
              )}

              {/* Transaction ID input ONLY for Telebirr and CBE Bank */}
              {(paymentMethod === 'telebirr' || paymentMethod === 'cbe') && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                    Transaction ID <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                    placeholder={
                      paymentMethod === 'telebirr'
                        ? 'Enter Telebirr Transaction ID (e.g. BL74K92X1M)'
                        : 'Enter CBE Transaction / Reference ID'
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#1d1936] border border-slate-200 dark:border-purple-950/60 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7560DF] font-mono"
                    required
                  />
                </div>
              )}

              {/* Payment Screenshot Upload */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                  Payment Screenshot{' '}
                  {subscriptionConfig.requireScreenshot !== false && (
                    <span className="text-rose-500">*</span>
                  )}
                </label>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePickScreenshot}
                  className="hidden"
                />

                {screenshotPreview ? (
                  <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-purple-950/60 bg-slate-100 dark:bg-[#1b1733]">
                    <img
                      src={screenshotPreview}
                      alt="Payment screenshot preview"
                      className="w-full max-h-56 object-contain"
                    />
                    <div className="p-2.5 bg-white/90 dark:bg-[#16132b]/90 border-t border-slate-200/70 dark:border-purple-950/50 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                        {screenshotFile?.name || 'Screenshot ready'}
                      </span>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs font-bold text-[#7560DF] dark:text-[#B09EFC] flex items-center gap-1"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Replace</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-6 px-4 rounded-2xl border-2 border-dashed border-slate-300 dark:border-purple-900/70 hover:border-[#7560DF] bg-slate-50/70 dark:bg-[#191532] flex flex-col items-center justify-center gap-2 text-center transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#7560DF]/15 text-[#7560DF] flex items-center justify-center">
                      <ImagePlus className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        Tap to upload payment screenshot
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        PNG, JPG or WEBP · Automatically compressed for secure review
                      </p>
                    </div>
                  </button>
                )}
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] disabled:opacity-60 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#7560DF]/25 transition-colors"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Submitting Payment...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Send</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
