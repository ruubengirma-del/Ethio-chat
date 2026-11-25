import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Crown,
  Eye,
  History,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sliders,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import {
  PaymentAuditLog,
  PaymentRequest,
  SubscriptionConfig,
  SubscriptionPackage,
  UserProfile,
  UserSubscription,
} from '../../types';
import {
  DEFAULT_ADMIN_EMAIL,
  OWNER_EMAIL,
  approvePaymentRequest,
  compressReceiptImage,
  fetchPaymentScreenshot,
  formatCurrencyEtb,
  formatCurrencyUsd,
  getRemainingDays,
  isSubscriptionActive,
  isSubscriptionExpiringSoon,
  rejectPaymentRequest,
  revokeUserSubscription,
  saveOwnerAdminRoles,
  saveOwnerSubscriptionConfig,
  syncExpiredSubscriptions,
  syncSubscriptionLifecycleViaServer,
} from '../../lib/subscriptionHelpers';
import { GoldVerifiedBadge } from '../common/GoldVerifiedBadge';

interface AdminPaymentDashboardProps {
  isOpen: boolean;
  standalone?: boolean;
  onClose?: () => void;
}

type DashboardTab = 'payments' | 'members' | 'history' | 'owner_config';
type PaymentFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED';
type MemberFilter = 'ALL' | 'ACTIVE' | 'UPCOMING' | 'EXPIRED';

export const AdminPaymentDashboard: React.FC<AdminPaymentDashboardProps> = ({
  isOpen,
  standalone = false,
  onClose,
}) => {
  const {
    currentUser,
    userProfile,
    userRole,
    isOwner,
    isAdmin,
    hasVerifiedFirebaseSession,
    subscriptionConfig,
    adminEmails,
    subscriptionsMap,
    allUsers,
    signOut,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<DashboardTab>('payments');
  const [statusFilter, setStatusFilter] = useState<PaymentFilter>('PENDING');
  const [memberFilter, setMemberFilter] = useState<MemberFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedVerifiedUserId, setSelectedVerifiedUserId] = useState<string | null>(null);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [showAllRejectedPanel, setShowAllRejectedPanel] = useState(false);

  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<PaymentAuditLog[]>([]);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState('');
  const [bannerSuccess, setBannerSuccess] = useState('');

  // Screenshot lightbox state
  const [screenshotModal, setScreenshotModal] = useState<{
    payment: PaymentRequest;
    loading: boolean;
    imageUrl: string | null;
    error: string;
  } | null>(null);

  // Reject reason modal state
  const [rejectTarget, setRejectTarget] = useState<PaymentRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Revoke active verification modal state
  const [revokeTarget, setRevokeTarget] = useState<UserSubscription | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  // Owner Config editor state (Strictly used when isOwner === true)
  const [draftConfig, setDraftConfig] = useState<SubscriptionConfig>(subscriptionConfig);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const qrInputRef = useRef<HTMLInputElement | null>(null);

  const canAccess = isOwner || isAdmin;

  useEffect(() => {
    if (!isOpen) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  useEffect(() => {
    setDraftConfig(subscriptionConfig);
  }, [subscriptionConfig]);

  // Ensure Admin cannot switch into owner_config tab
  useEffect(() => {
    if (!isOwner && activeTab === 'owner_config') {
      setActiveTab('payments');
    }
  }, [isOwner, activeTab]);

  useEffect(() => {
    if (!isOpen || !canAccess) return;

    const qPayments = query(
      collection(db, 'premium_payment_requests'),
      orderBy('submittedAt', 'desc')
    );
    const unsubPayments = onSnapshot(
      qPayments,
      (snap) => {
        const list: PaymentRequest[] = [];
        snap.forEach((d) => list.push(d.data() as PaymentRequest));
        setPayments(list);
      },
      (err) => {
        setBannerError(
          err?.message || 'Unable to load payment requests.'
        );
      }
    );

    const qLogs = query(collection(db, 'paymentAuditLogs'), orderBy('createdAt', 'desc'));
    const unsubLogs = onSnapshot(
      qLogs,
      (snap) => {
        const list: PaymentAuditLog[] = [];
        snap.forEach((d) => list.push(d.data() as PaymentAuditLog));
        setAuditLogs(list);
      },
      () => {
        // ignore transient error
      }
    );

    return () => {
      unsubPayments();
      unsubLogs();
    };
  }, [isOpen, canAccess]);

  // Trigger lifecycle expiration & upcoming-reminder check when dashboard opens with a verified session
  useEffect(() => {
    if (!isOpen || !canAccess || !hasVerifiedFirebaseSession || !currentUser?.uid) return;
    syncSubscriptionLifecycleViaServer(currentUser.uid).catch(() => {});
  }, [isOpen, canAccess, hasVerifiedFirebaseSession, currentUser?.uid]);

  const usersById = useMemo(() => {
    const map = new Map<string, UserProfile>();
    allUsers.forEach((u) => {
      if (u?.userId) map.set(u.userId, u);
    });
    return map;
  }, [allUsers]);

  const resolveUserIdentity = React.useCallback(
    (
      userId?: string,
      fallbackDisplayName?: string,
      fallbackUsername?: string,
      fallbackEmail?: string,
      fallbackPhotoURL?: string
    ) => {
      const profile = userId ? usersById.get(userId) : undefined;
      const cleanEmail = (profile?.email || fallbackEmail || '').trim();
      const emailLocal = cleanEmail ? cleanEmail.split('@')[0] : '';
      const rawProfileUsername = (profile?.username || '').trim();
      const rawFallbackUsername = (fallbackUsername || '').trim();
      const cleanUsername =
        (rawProfileUsername && rawProfileUsername !== userId ? rawProfileUsername : '') ||
        (rawFallbackUsername && rawFallbackUsername !== 'user' && rawFallbackUsername !== userId
          ? rawFallbackUsername
          : '') ||
        emailLocal ||
        'user';
      const rawProfileName = (profile?.displayName || '').trim();
      const rawFallbackName = (fallbackDisplayName || '').trim();
      const displayName =
        (rawProfileName && rawProfileName !== userId ? rawProfileName : '') ||
        (rawFallbackName && rawFallbackName !== userId ? rawFallbackName : '') ||
        cleanUsername ||
        'User';
      return {
        displayName,
        username: cleanUsername,
        email: cleanEmail,
        photoURL: profile?.photoURL || fallbackPhotoURL || '',
      };
    },
    [usersById]
  );

  const paymentsByUserId = useMemo(() => {
    const map = new Map<string, PaymentRequest[]>();
    payments.forEach((p) => {
      if (!p.userId) return;
      const list = map.get(p.userId) || [];
      list.push(p);
      map.set(p.userId, list);
    });
    return map;
  }, [payments]);

  const rejectedPayments = useMemo(
    () => payments.filter((p) => String(p.status || '').toLowerCase() === 'rejected'),
    [payments]
  );

  const subscriptionsList = useMemo(
    () =>
      Object.values(subscriptionsMap).sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
      ),
    [subscriptionsMap]
  );

  const activeVerifiedMembers = useMemo(
    () => subscriptionsList.filter((s) => isSubscriptionActive(s, nowMs)),
    [subscriptionsList, nowMs]
  );

  const metrics = useMemo(() => {
    const pendingCount = payments.filter(
      (p) => String(p.status || '').toLowerCase() === 'pending'
    ).length;
    const approvedPayments = payments.filter(
      (p) => String(p.status || '').toLowerCase() === 'approved'
    );
    const rejectedCount = rejectedPayments.length;

    const activeMembersCount = activeVerifiedMembers.length;
    const upcomingMembersCount = subscriptionsList.filter((s) =>
      isSubscriptionExpiringSoon(s, nowMs)
    ).length;
    const expiredMembersCount = subscriptionsList.filter(
      (s) => !isSubscriptionActive(s, nowMs)
    ).length;

    const totalRevenueEtb = approvedPayments.reduce(
      (sum, p) => sum + Number(p.amountEtb || 0),
      0
    );
    const totalRevenueUsd = approvedPayments.reduce(
      (sum, p) => sum + Number(p.amountUsd || 0),
      0
    );

    return {
      pendingCount,
      approvedCount: approvedPayments.length,
      rejectedCount,
      activeMembersCount,
      upcomingMembersCount,
      expiredMembersCount,
      totalRevenueEtb,
      totalRevenueUsd,
    };
  }, [payments, rejectedPayments.length, activeVerifiedMembers.length, subscriptionsList, nowMs]);

  const filteredMembers = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return subscriptionsList.filter((sub) => {
      const active = isSubscriptionActive(sub, nowMs);
      const upcoming = isSubscriptionExpiringSoon(sub, nowMs);
      if (memberFilter === 'ACTIVE' && !active) return false;
      if (memberFilter === 'UPCOMING' && !upcoming) return false;
      if (memberFilter === 'EXPIRED' && active) return false;
      if (!term) return true;
      const person = resolveUserIdentity(sub.userId, sub.displayName, sub.username);
      return (
        person.username.toLowerCase().includes(term) ||
        person.displayName.toLowerCase().includes(term) ||
        person.email.toLowerCase().includes(term) ||
        sub.userId?.toLowerCase().includes(term) ||
        sub.packageLabel?.toLowerCase().includes(term) ||
        sub.approvedPaymentId?.toLowerCase().includes(term)
      );
    });
  }, [subscriptionsList, memberFilter, searchQuery, nowMs, resolveUserIdentity]);

  const filteredPayments = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return payments.filter((p) => {
      if (
        statusFilter !== 'ALL' &&
        String(p.status || '').toLowerCase() !== statusFilter.toLowerCase()
      ) {
        return false;
      }
      if (!term) return true;
      const person = resolveUserIdentity(p.userId, p.displayName, p.username, p.email, p.photoURL);
      return (
        person.username.toLowerCase().includes(term) ||
        person.displayName.toLowerCase().includes(term) ||
        person.email.toLowerCase().includes(term) ||
        p.userId?.toLowerCase().includes(term) ||
        p.transactionId?.toLowerCase().includes(term) ||
        p.method?.toLowerCase().includes(term) ||
        p.packageLabel?.toLowerCase().includes(term)
      );
    });
  }, [payments, statusFilter, searchQuery, resolveUserIdentity]);

  if (!isOpen || !canAccess) return null;

  const handleViewScreenshot = async (payment: PaymentRequest) => {
    setBannerError('');
    if (payment.screenshotUrl) {
      setScreenshotModal({
        payment,
        loading: false,
        imageUrl: payment.screenshotUrl,
        error: '',
      });
      return;
    }

    setScreenshotModal({
      payment,
      loading: true,
      imageUrl: null,
      error: '',
    });
    try {
      const rec = await fetchPaymentScreenshot(payment.screenshotId || payment.paymentId);
      if (!rec || !rec.imageDataUrl) {
        setScreenshotModal({
          payment,
          loading: false,
          imageUrl: null,
          error: 'No payment screenshot was attached to this submission.',
        });
        return;
      }
      setScreenshotModal({
        payment,
        loading: false,
        imageUrl: rec.imageDataUrl,
        error: '',
      });
    } catch (err: any) {
      setScreenshotModal({
        payment,
        loading: false,
        imageUrl: null,
        error: err?.message || 'Unable to load payment screenshot.',
      });
    }
  };

  const handleApprove = async (payment: PaymentRequest) => {
    setBannerError('');
    setBannerSuccess('');
    setActionBusyId(payment.paymentId);
    const person = resolveUserIdentity(
      payment.userId,
      payment.displayName,
      payment.username,
      payment.email
    );
    try {
      await approvePaymentRequest(
        {
          ...payment,
          displayName: person.displayName,
          username: person.username,
        },
        currentUser?.uid
      );
      setBannerSuccess(
        `Approved ${person.displayName} (@${person.username})'s ${payment.packageLabel} payment. Gold Verified Badge activated.`
      );
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to approve payment request.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    setBannerError('');
    setBannerSuccess('');
    setActionBusyId(rejectTarget.paymentId);
    const person = resolveUserIdentity(
      rejectTarget.userId,
      rejectTarget.displayName,
      rejectTarget.username,
      rejectTarget.email
    );
    try {
      await rejectPaymentRequest(rejectTarget, rejectReason, currentUser?.uid);
      setBannerSuccess(`Rejected ${person.displayName} (@${person.username})'s payment request.`);
      setRejectTarget(null);
      setRejectReason('');
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to reject payment request.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleConfirmRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokeTarget) return;
    setBannerError('');
    setBannerSuccess('');
    setActionBusyId(revokeTarget.userId);
    const person = resolveUserIdentity(
      revokeTarget.userId,
      revokeTarget.displayName,
      revokeTarget.username
    );
    try {
      await revokeUserSubscription(revokeTarget, revokeReason, currentUser?.uid);
      setBannerSuccess(
        `Rejected/revoked Gold Verification for ${person.displayName} (@${person.username}).`
      );
      setRevokeTarget(null);
      setRevokeReason('');
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to revoke verified status.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleSyncExpired = async () => {
    if (!currentUser || (!isOwner && !isAdmin)) return;
    setBannerError('');
    setBannerSuccess('');
    try {
      const count = await syncExpiredSubscriptions(subscriptionsList, {
        uid: currentUser.uid,
        email: userProfile?.email || currentUser.email || '',
        role: isOwner ? 'owner' : 'admin',
      });
      setBannerSuccess(
        count > 0
          ? `Synchronized ${count} expired subscription record(s).`
          : 'All subscription records are already up to date.'
      );
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to synchronize expired records.');
    }
  };

  const handleUpdatePackageField = (
    pkgId: string,
    field: keyof SubscriptionPackage,
    value: string | number
  ) => {
    setDraftConfig((prev) => ({
      ...prev,
      packages: prev.packages.map((p) =>
        p.id === pkgId ? { ...p, [field]: value } : p
      ),
    }));
  };

  const handleUploadBinanceQr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressReceiptImage(file);
      setDraftConfig((prev) => ({ ...prev, binanceQrCodeUrl: compressed.dataUrl }));
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to process QR code image.');
    }
  };

  const handleSaveOwnerConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setBannerError('');
    setBannerSuccess('');
    setSavingConfig(true);
    try {
      await saveOwnerSubscriptionConfig({
        packages: draftConfig.packages.map((p) => ({
          ...p,
          months: Number(p.months),
          priceUsd: Number(p.priceUsd),
          priceEtb: Number(p.priceEtb),
        })),
        telebirrAccountNumber: draftConfig.telebirrAccountNumber.trim(),
        telebirrAccountName: draftConfig.telebirrAccountName.trim(),
        cbeAccountNumber: draftConfig.cbeAccountNumber.trim(),
        cbeAccountName: draftConfig.cbeAccountName.trim(),
        binanceUid: draftConfig.binanceUid.trim(),
        binancePaymentLink: (draftConfig.binancePaymentLink || '').trim(),
        binanceQrCodeUrl: (draftConfig.binanceQrCodeUrl || '').trim(),
        subscriptionsEnabled: Boolean(draftConfig.subscriptionsEnabled),
        requireScreenshot: Boolean(draftConfig.requireScreenshot),
      });
      setBannerSuccess('Owner subscription & payment configuration saved.');
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to save Owner configuration.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    const clean = newAdminEmail.trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      setBannerError('Please enter a valid Admin email address.');
      return;
    }
    if (clean === OWNER_EMAIL) {
      setBannerError('Owner already has full system access.');
      return;
    }
    setBannerError('');
    setBannerSuccess('');
    setSavingConfig(true);
    try {
      await saveOwnerAdminRoles([...adminEmails, clean], 'ADMIN_ADDED', clean);
      setNewAdminEmail('');
      setBannerSuccess(`Granted Admin dashboard access to ${clean}.`);
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to add Admin.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleRemoveAdmin = async (targetEmail: string) => {
    if (!isOwner) return;
    const clean = targetEmail.trim().toLowerCase();
    if (clean === DEFAULT_ADMIN_EMAIL) return;
    setBannerError('');
    setBannerSuccess('');
    setSavingConfig(true);
    try {
      await saveOwnerAdminRoles(
        adminEmails.filter((e) => e !== clean),
        'ADMIN_REMOVED',
        clean
      );
      setBannerSuccess(`Removed Admin access for ${clean}.`);
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to remove Admin.');
    } finally {
      setSavingConfig(false);
    }
  };

  const formatDateTime = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderMethodLabel = (method: PaymentRequest['method']) => {
    if (method === 'telebirr') return 'Telebirr';
    if (method === 'cbe') return 'CBE Bank';
    return 'Binance Pay';
  };

  const content = (
    <div
      className={
        standalone
          ? 'min-h-[100dvh] w-full bg-slate-50 dark:bg-[#0d0a1c] text-slate-900 dark:text-white flex flex-col'
          : 'bg-white dark:bg-[#131024] w-full max-w-5xl h-[94dvh] sm:h-[90dvh] rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-purple-950/60 shadow-2xl flex flex-col overflow-hidden'
      }
    >
      {/* Top Bar */}
      <header className="px-4 sm:px-6 py-4 border-b border-slate-200/80 dark:border-purple-950/50 bg-white dark:bg-[#16132b] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#221d3d] hover:bg-slate-200 dark:hover:bg-[#2d264f] flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors shrink-0"
              aria-label="Back to Settings"
              title="Back to Settings"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
              isOwner
                ? 'bg-amber-500/15 text-amber-500'
                : 'bg-[#7560DF]/15 text-[#7560DF]'
            }`}
          >
            {isOwner ? <Crown className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white truncate">
                {isOwner ? 'Premium Payment Management' : 'Admin Payment Dashboard'}
              </h1>
              <span
                className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                  isOwner
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                    : 'bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC]'
                }`}
              >
                {userRole}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Signed in as {userProfile?.email || currentUser?.email}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSyncExpired}
            title="Sync expired memberships"
            className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#221d3d] hover:bg-slate-200 dark:hover:bg-[#2d264f] text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sync Expiry</span>
          </button>

          {standalone ? (
            <button
              type="button"
              onClick={() => signOut()}
              className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log Out</span>
            </button>
          ) : (
            onClose && (
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#221d3d] hover:bg-slate-200 dark:hover:bg-[#2d264f] flex items-center justify-center text-slate-500 dark:text-slate-300 transition-colors"
                aria-label="Close dashboard"
              >
                <X className="w-4 h-4" />
              </button>
            )
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 max-w-6xl w-full mx-auto">
        {!hasVerifiedFirebaseSession && (
          <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-start gap-2.5 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5 text-slate-800 dark:text-amber-100">
              <p className="font-extrabold">Verified Firebase Session Required for Approvals</p>
              <p>
                Security rules & server verification require a live verified Google or Email
                Firebase session. If approvals return permission denied, please sign out and log in
                using Google Sign-In with your verified account.
              </p>
            </div>
          </div>
        )}

        {bannerError && (
          <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/35 text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center justify-between gap-2">
            <span>{bannerError}</span>
            <button type="button" onClick={() => setBannerError('')}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {bannerSuccess && (
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/35 text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2">
            <span>{bannerSuccess}</span>
            <button type="button" onClick={() => setBannerSuccess('')}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 6 KPI Summary Cards */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <button
            type="button"
            onClick={() => {
              setActiveTab('payments');
              setStatusFilter('PENDING');
            }}
            className="text-left p-3.5 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 hover:border-amber-500/50 transition-colors"
          >
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">
              Pending Payments
            </span>
            <span className="text-2xl font-extrabold text-amber-600 dark:text-amber-400 tabular-nums mt-1 block">
              {metrics.pendingCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('payments');
              setStatusFilter('APPROVED');
            }}
            className="text-left p-3.5 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 hover:border-emerald-500/50 transition-colors"
          >
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">
              Approved Payments
            </span>
            <span className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1 block">
              {metrics.approvedCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowAllRejectedPanel((prev) => !prev);
              setActiveTab('payments');
              setStatusFilter('REJECTED');
            }}
            className="text-left p-3.5 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 hover:border-rose-500/50 transition-colors"
          >
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">
              Rejected Payments
            </span>
            <span className="text-2xl font-extrabold text-rose-600 dark:text-rose-400 tabular-nums mt-1 block">
              {metrics.rejectedCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('members');
              setMemberFilter('ACTIVE');
            }}
            className="text-left p-3.5 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 hover:border-[#7560DF]/60 transition-colors"
          >
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">
              Active Verified
            </span>
            <span className="text-2xl font-extrabold text-[#7560DF] dark:text-[#B09EFC] tabular-nums mt-1 block">
              {metrics.activeMembersCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('members');
              setMemberFilter('EXPIRED');
            }}
            className="text-left p-3.5 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 hover:border-slate-400/60 transition-colors"
          >
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">
              Expired / Revoked
            </span>
            <span className="text-2xl font-extrabold text-slate-600 dark:text-slate-300 tabular-nums mt-1 block">
              {metrics.expiredMembersCount}
            </span>
          </button>

          <div className="p-3.5 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">
              Total Revenue
            </span>
            <span className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums mt-1 block truncate">
              {formatCurrencyEtb(metrics.totalRevenueEtb)}
            </span>
            <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
              {formatCurrencyUsd(metrics.totalRevenueUsd)}
            </span>
          </div>
        </section>

        {/* Verified Members Directory Strip: shows count + verified names; tap a member or Rejected toggle to view rejected items underneath */}
        <section className="p-4 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <GoldVerifiedBadge forceShow size="md" />
              <div className="min-w-0">
                <h2 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                  Verified Members ({activeVerifiedMembers.length})
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Tap any verified name to view rejected requests &amp; details underneath
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAllRejectedPanel((prev) => !prev)}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-colors ${
                showAllRejectedPanel
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400'
              }`}
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Rejected ({rejectedPayments.length})</span>
              {showAllRejectedPanel ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {activeVerifiedMembers.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No active Gold Verified users right now.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {activeVerifiedMembers.map((sub) => {
                const person = resolveUserIdentity(sub.userId, sub.displayName, sub.username);
                const isSelected = selectedVerifiedUserId === sub.userId;
                const userRejectedCount = (paymentsByUserId.get(sub.userId) || []).filter(
                  (p) => String(p.status || '').toLowerCase() === 'rejected'
                ).length;
                const daysLeft = getRemainingDays(sub, nowMs);
                return (
                  <button
                    key={sub.userId}
                    type="button"
                    onClick={() =>
                      setSelectedVerifiedUserId((prev) => (prev === sub.userId ? null : sub.userId))
                    }
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-[#7560DF]/12 border-[#7560DF] ring-2 ring-[#7560DF]/25'
                        : 'bg-slate-50 dark:bg-[#1e193a] border-slate-200/80 dark:border-purple-950/60 hover:border-[#7560DF]/60'
                    }`}
                  >
                    {person.photoURL ? (
                      <img
                        src={person.photoURL}
                        alt={person.displayName}
                        className="w-7 h-7 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-[#7560DF]/20 text-[#7560DF] dark:text-[#B09EFC] font-extrabold text-xs flex items-center justify-center shrink-0">
                        {person.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-extrabold text-slate-900 dark:text-white truncate max-w-[140px]">
                          {person.displayName}
                        </span>
                        <GoldVerifiedBadge forceShow size="sm" />
                      </div>
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 block">
                        @{person.username} · {sub.packageLabel} · {daysLeft}d left
                        {userRejectedCount > 0 ? ` · ${userRejectedCount} rejected` : ''}
                      </span>
                    </div>
                    {isSelected ? (
                      <ChevronUp className="w-3.5 h-3.5 text-[#7560DF] shrink-0" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Underneath Panel for Tapped Verified User (Rejected requests + Revoke option) */}
          {selectedVerifiedUserId && (() => {
            const sub = subscriptionsMap[selectedVerifiedUserId];
            if (!sub) return null;
            const person = resolveUserIdentity(sub.userId, sub.displayName, sub.username);
            const userPayments = paymentsByUserId.get(sub.userId) || [];
            const userRejected = userPayments.filter(
              (p) => String(p.status || '').toLowerCase() === 'rejected'
            );
            return (
              <div className="mt-2 p-3.5 rounded-xl bg-slate-50 dark:bg-[#131024] border border-slate-200 dark:border-purple-950/60 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                        {person.displayName}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        @{person.username}
                      </span>
                      {person.email && (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          · {person.email}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Plan: <span className="font-bold text-[#7560DF] dark:text-[#B09EFC]">{sub.packageLabel}</span> · Expires{' '}
                      {formatDateTime(sub.premiumExpiryDate || sub.expiresAt)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setRevokeTarget(sub);
                      setRevokeReason('');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1.5"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Reject / Revoke Verification</span>
                  </button>
                </div>

                <div className="space-y-2 border-t border-slate-200/80 dark:border-purple-950/50 pt-2.5">
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                    Rejected Payments ({userRejected.length})
                  </p>
                  {userRejected.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No rejected payment submissions for {person.displayName}.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {userRejected.map((rej) => (
                        <div
                          key={rej.paymentId}
                          className="p-2.5 rounded-lg bg-rose-500/8 border border-rose-500/25 text-xs space-y-0.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-900 dark:text-white">
                              {rej.packageLabel} · {renderMethodLabel(rej.method)} ({formatCurrencyUsd(rej.amountUsd)} / {formatCurrencyEtb(rej.amountEtb)})
                            </span>
                            <span className="text-[11px] text-slate-500 tabular-nums">
                              {formatDateTime(rej.reviewedAt || rej.submittedAt)}
                            </span>
                          </div>
                          {rej.rejectionReason && (
                            <p className="text-rose-600 dark:text-rose-400 font-semibold">
                              Reason: {rej.rejectionReason}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Underneath Panel showing All Rejected Payments when Rejected toggle is clicked */}
          {showAllRejectedPanel && (
            <div className="mt-2 p-3.5 rounded-xl bg-rose-500/5 border border-rose-500/30 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-extrabold text-rose-600 dark:text-rose-400">
                  All Rejected Payment Submissions ({rejectedPayments.length})
                </p>
                <button
                  type="button"
                  onClick={() => setShowAllRejectedPanel(false)}
                  className="text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  Close
                </button>
              </div>
              {rejectedPayments.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No rejected payments found.
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {rejectedPayments.map((rej) => {
                    const person = resolveUserIdentity(
                      rej.userId,
                      rej.displayName,
                      rej.username,
                      rej.email,
                      rej.photoURL
                    );
                    return (
                      <div
                        key={rej.paymentId}
                        className="p-2.5 rounded-lg bg-white dark:bg-[#17132d] border border-rose-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-extrabold text-slate-900 dark:text-white truncate">
                            {person.displayName}{' '}
                            <span className="font-semibold text-slate-500 dark:text-slate-400">
                              (@{person.username})
                            </span>
                          </p>
                          {rej.rejectionReason && (
                            <p className="text-rose-600 dark:text-rose-400 font-semibold">
                              Reason: {rej.rejectionReason}
                            </p>
                          )}
                        </div>
                        <div className="text-left sm:text-right text-[11px] text-slate-500 shrink-0">
                          <p className="font-bold text-slate-700 dark:text-slate-200">
                            {rej.packageLabel} · {renderMethodLabel(rej.method)}
                          </p>
                          <p className="tabular-nums">
                            {formatDateTime(rej.reviewedAt || rej.submittedAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Workspace Navigation Tabs */}
        <nav className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setActiveTab('payments')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 shrink-0 transition-colors ${
              activeTab === 'payments'
                ? 'bg-[#7560DF] text-white'
                : 'bg-white dark:bg-[#17132d] text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-purple-950/50'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Payment Requests ({payments.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('members')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 shrink-0 transition-colors ${
              activeTab === 'members'
                ? 'bg-[#7560DF] text-white'
                : 'bg-white dark:bg-[#17132d] text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-purple-950/50'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Premium Members ({subscriptionsList.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 shrink-0 transition-colors ${
              activeTab === 'history'
                ? 'bg-[#7560DF] text-white'
                : 'bg-white dark:bg-[#17132d] text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-purple-950/50'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Audit History ({auditLogs.length})</span>
          </button>

          {isOwner && (
            <button
              type="button"
              onClick={() => setActiveTab('owner_config')}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 shrink-0 transition-colors ${
                activeTab === 'owner_config'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-white dark:bg-[#17132d] text-amber-600 dark:text-amber-300 border border-amber-500/40'
              }`}
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>Owner Configuration</span>
            </button>
          )}
        </nav>

        {/* Tab 1: Payment Requests */}
        {activeTab === 'payments' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as PaymentFilter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setStatusFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${
                      statusFilter === f
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950'
                        : 'bg-white dark:bg-[#17132d] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-purple-950/50'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search user, email, ID, TX ID..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white dark:bg-[#17132d] border border-slate-200 dark:border-purple-950/60 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7560DF]"
                />
              </div>
            </div>

            {filteredPayments.length === 0 ? (
              <div className="p-10 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 text-center text-sm text-slate-500">
                No {statusFilter === 'ALL' ? '' : statusFilter.toLowerCase()} payment requests found.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredPayments.map((req) => {
                  const busy = actionBusyId === req.paymentId;
                  const normStatus = String(req.status || '').toLowerCase();
                  const statusLabel = normStatus.toUpperCase();
                  const person = resolveUserIdentity(
                    req.userId,
                    req.displayName,
                    req.username,
                    req.email,
                    req.photoURL
                  );
                  return (
                    <div
                      key={req.paymentId}
                      className="p-4 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 shadow-sm space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          {person.photoURL ? (
                            <img
                              src={person.photoURL}
                              alt={person.displayName}
                              className="w-10 h-10 rounded-full object-cover shrink-0 border border-slate-200 dark:border-purple-900/60"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] font-extrabold text-sm flex items-center justify-center shrink-0">
                              {person.displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                                {person.displayName}
                              </span>
                              <span className="text-xs font-bold text-[#7560DF] dark:text-[#B09EFC]">
                                @{person.username}
                              </span>
                              <span
                                className={`text-[11px] font-extrabold ${
                                  normStatus === 'pending'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : normStatus === 'approved'
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                · {statusLabel}
                              </span>
                            </div>
                            {person.email && (
                              <p className="text-xs text-slate-600 dark:text-slate-300 break-all">
                                {person.email}
                              </p>
                            )}
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate">
                              Ref: {req.paymentId}
                            </p>
                          </div>
                        </div>

                        <div className="text-left sm:text-right shrink-0">
                          <p className="text-sm font-extrabold text-[#7560DF] dark:text-[#B09EFC] tabular-nums">
                            {formatCurrencyUsd(req.amountUsd)} · {formatCurrencyEtb(req.amountEtb)}
                          </p>
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                            {req.packageLabel} · {renderMethodLabel(req.method)}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-[#1e193a] text-xs">
                        <div>
                          <span className="text-[11px] text-slate-500 block">Transaction ID</span>
                          <span className="font-mono font-bold text-slate-900 dark:text-white break-all">
                            {req.method === 'binance'
                              ? 'Binance Pay (Screenshot check)'
                              : req.transactionId || '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-500 block">Submission Date</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                            {formatDateTime(req.submittedAt)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-500 block">Review Status</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {req.reviewedByEmail
                              ? `${statusLabel} by ${req.reviewedByEmail}`
                              : 'Awaiting manual verification'}
                          </span>
                        </div>
                      </div>

                      {req.rejectionReason && (
                        <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold">
                          Rejection reason: {req.rejectionReason}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleViewScreenshot(req)}
                          className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-[#241f46] hover:bg-slate-200 dark:hover:bg-[#2f2859] text-slate-800 dark:text-slate-100 font-bold text-xs flex items-center gap-1.5 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Screenshot</span>
                        </button>

                        {normStatus === 'pending' && (
                          <div className="flex items-center gap-2 ml-auto">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setRejectTarget(req);
                                setRejectReason('');
                              }}
                              className="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 font-bold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>

                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleApprove(req)}
                              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
                            >
                              {busy ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              )}
                              <span>Approve</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Premium Members */}
        {activeTab === 'members' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {(
                  [
                    { id: 'ALL', label: `ALL (${subscriptionsList.length})` },
                    { id: 'ACTIVE', label: `ACTIVE (${metrics.activeMembersCount})` },
                    { id: 'UPCOMING', label: `UPCOMING 7D (${metrics.upcomingMembersCount})` },
                    { id: 'EXPIRED', label: `EXPIRED (${metrics.expiredMembersCount})` },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setMemberFilter(f.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${
                      memberFilter === f.id
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950'
                        : 'bg-white dark:bg-[#17132d] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-purple-950/50'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search member, UID, plan..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white dark:bg-[#17132d] border border-slate-200 dark:border-purple-950/60 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7560DF]"
                />
              </div>
            </div>

            {filteredMembers.length === 0 ? (
              <div className="p-10 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 text-center text-sm text-slate-500">
                No {memberFilter === 'ALL' ? '' : memberFilter.toLowerCase()} Premium members found.
              </div>
            ) : (
              filteredMembers.map((sub: UserSubscription) => {
                const active = isSubscriptionActive(sub, nowMs);
                const upcoming = isSubscriptionExpiringSoon(sub, nowMs);
                const daysLeft = getRemainingDays(sub, nowMs);
                const person = resolveUserIdentity(sub.userId, sub.displayName, sub.username);
                const isExpanded = expandedMemberId === sub.userId;
                const userPayments = paymentsByUserId.get(sub.userId) || [];
                const userRejected = userPayments.filter(
                  (p) => String(p.status || '').toLowerCase() === 'rejected'
                );
                const statusBadgeLabel =
                  sub.status === 'revoked'
                    ? 'REVOKED'
                    : upcoming
                    ? `EXPIRING IN ${daysLeft}D`
                    : active
                    ? 'ACTIVE'
                    : 'EXPIRED';

                return (
                  <div
                    key={sub.userId}
                    className="rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedMemberId((prev) => (prev === sub.userId ? null : sub.userId))
                      }
                      className="w-full p-4 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-[#1c1736] transition-colors"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {person.photoURL ? (
                          <img
                            src={person.photoURL}
                            alt={person.displayName}
                            className="w-10 h-10 rounded-full object-cover shrink-0 border border-slate-200 dark:border-purple-900/60"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] font-extrabold text-sm flex items-center justify-center shrink-0">
                            {person.displayName.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                              {person.displayName}
                            </span>
                            {active && <GoldVerifiedBadge forceShow size="sm" />}
                            <span
                              className={`text-[11px] font-extrabold ${
                                sub.status === 'revoked'
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : upcoming
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : active
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              · {statusBadgeLabel}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300 truncate">
                            @{person.username}
                            {person.email ? ` · ${person.email}` : ''}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Approved by {sub.approvedByEmail} ({sub.approvedByRole})
                            {userRejected.length > 0 && (
                              <span className="text-rose-600 dark:text-rose-400 font-bold">
                                {' '}
                                · {userRejected.length} rejected
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <div className="text-left sm:text-right text-xs space-y-0.5">
                          <p className="font-extrabold text-[#7560DF] dark:text-[#B09EFC]">
                            {sub.packageLabel} ({sub.subscriptionDuration || sub.durationMonths} mo)
                          </p>
                          <p className="text-slate-600 dark:text-slate-300 tabular-nums">
                            Started: {formatDateTime(sub.premiumStartDate || sub.startDate)}
                          </p>
                          <p className="text-slate-600 dark:text-slate-300 tabular-nums">
                            Expires: {formatDateTime(sub.premiumExpiryDate || sub.expiresAt)}
                          </p>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                      </div>
                    </button>

                    {/* Expanded Underneath Panel: Shows Rejected Payments + Option to Reject/Revoke */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-3 border-t border-slate-100 dark:border-purple-950/50 bg-slate-50/70 dark:bg-[#131024] space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                            Rejected History ({userRejected.length})
                          </span>
                          {active && (
                            <button
                              type="button"
                              onClick={() => {
                                setRevokeTarget(sub);
                                setRevokeReason('');
                              }}
                              className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1.5"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Reject / Revoke Verification</span>
                            </button>
                          )}
                        </div>

                        {userRejected.length === 0 ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            No rejected payments recorded for {person.displayName}.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {userRejected.map((rej) => (
                              <div
                                key={rej.paymentId}
                                className="p-2.5 rounded-xl bg-rose-500/8 border border-rose-500/25 text-xs space-y-0.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-bold text-slate-900 dark:text-white">
                                    {rej.packageLabel} · {renderMethodLabel(rej.method)} ({formatCurrencyUsd(rej.amountUsd)} / {formatCurrencyEtb(rej.amountEtb)})
                                  </span>
                                  <span className="text-[11px] text-slate-500 tabular-nums">
                                    {formatDateTime(rej.reviewedAt || rej.submittedAt)}
                                  </span>
                                </div>
                                {rej.rejectionReason && (
                                  <p className="text-rose-600 dark:text-rose-400 font-semibold">
                                    Reason: {rej.rejectionReason}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Tab 3: Payment & Config Audit History */}
        {activeTab === 'history' && (
          <div className="space-y-2.5">
            {auditLogs.length === 0 ? (
              <div className="p-10 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 text-center text-sm text-slate-500">
                No payment or configuration audit logs recorded yet.
              </div>
            ) : (
              auditLogs.map((log) => {
                const targetPerson = log.targetUserId
                  ? resolveUserIdentity(log.targetUserId, undefined, log.targetUsername)
                  : null;
                return (
                  <div
                    key={log.logId}
                    className="p-3.5 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-slate-900 dark:text-white">
                          {log.action.replace(/_/g, ' ')}
                        </span>
                        {targetPerson ? (
                          <span className="text-[#7560DF] dark:text-[#B09EFC] font-bold">
                            {targetPerson.displayName} (@{targetPerson.username})
                          </span>
                        ) : (
                          log.targetUsername && (
                            <span className="text-[#7560DF] dark:text-[#B09EFC] font-bold">
                              @{log.targetUsername}
                            </span>
                          )
                        )}
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">{log.details}</p>
                      {log.rejectionReason && (
                        <p className="text-rose-500">Reason: {log.rejectionReason}</p>
                      )}
                    </div>
                    <div className="text-left sm:text-right text-[11px] text-slate-500 shrink-0">
                      <p className="font-semibold">
                        {log.actorEmail} ({log.actorRole})
                      </p>
                      <p className="tabular-nums">{formatDateTime(log.createdAt)}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Tab 4: Owner Configuration (Strictly Invisible & Inaccessible to Admin) */}
        {isOwner && activeTab === 'owner_config' && (
          <div className="space-y-5">
            <form
              onSubmit={handleSaveOwnerConfig}
              className="p-5 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 space-y-5"
            >
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-purple-950/40 pb-3">
                <Sliders className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  Packages, Pricing & Payment Accounts (Owner Only)
                </h3>
              </div>

              {/* Subscription Packages */}
              <div className="space-y-3">
                <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  Subscription Package Prices
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {draftConfig.packages.map((pkg) => (
                    <div
                      key={pkg.id}
                      className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1e193a] border border-slate-200/80 dark:border-purple-950/50 space-y-2.5"
                    >
                      <input
                        type="text"
                        value={pkg.label}
                        onChange={(e) => handleUpdatePackageField(pkg.id, 'label', e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#141028] border border-slate-200 dark:border-purple-950/60 text-xs font-bold"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-1">USD ($)</label>
                          <input
                            type="number"
                            min={1}
                            value={pkg.priceUsd}
                            onChange={(e) =>
                              handleUpdatePackageField(pkg.id, 'priceUsd', Number(e.target.value))
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#141028] border border-slate-200 dark:border-purple-950/60 text-xs font-bold tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-1">ETB</label>
                          <input
                            type="number"
                            min={1}
                            value={pkg.priceEtb}
                            onChange={(e) =>
                              handleUpdatePackageField(pkg.id, 'priceEtb', Number(e.target.value))
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#141028] border border-slate-200 dark:border-purple-950/60 text-xs font-bold tabular-nums"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment Receiving Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1e193a] space-y-2.5">
                  <p className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                    Telebirr Receiving Account
                  </p>
                  <input
                    type="text"
                    value={draftConfig.telebirrAccountNumber}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        telebirrAccountNumber: e.target.value,
                      }))
                    }
                    placeholder="Telebirr Number"
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#141028] border border-slate-200 dark:border-purple-950/60 text-xs font-mono"
                  />
                  <input
                    type="text"
                    value={draftConfig.telebirrAccountName}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({ ...prev, telebirrAccountName: e.target.value }))
                    }
                    placeholder="Telebirr Account Name"
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#141028] border border-slate-200 dark:border-purple-950/60 text-xs"
                  />
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1e193a] space-y-2.5">
                  <p className="text-xs font-extrabold text-purple-600 dark:text-purple-400">
                    CBE Bank Receiving Account
                  </p>
                  <input
                    type="text"
                    value={draftConfig.cbeAccountNumber}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({ ...prev, cbeAccountNumber: e.target.value }))
                    }
                    placeholder="CBE Account Number"
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#141028] border border-slate-200 dark:border-purple-950/60 text-xs font-mono"
                  />
                  <input
                    type="text"
                    value={draftConfig.cbeAccountName}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({ ...prev, cbeAccountName: e.target.value }))
                    }
                    placeholder="CBE Account Name"
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#141028] border border-slate-200 dark:border-purple-950/60 text-xs"
                  />
                </div>
              </div>

              {/* Binance Pay Settings */}
              <div className="p-4 rounded-xl bg-amber-500/8 border border-amber-500/30 space-y-3">
                <p className="text-xs font-extrabold text-amber-700 dark:text-amber-300">
                  Binance Pay Configuration (Email / UID, Payment Link &amp; QR Code)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
                      Binance Email / UID
                    </label>
                    <input
                      type="text"
                      value={draftConfig.binanceUid}
                      onChange={(e) =>
                        setDraftConfig((prev) => ({ ...prev, binanceUid: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#141028] border border-slate-200 dark:border-purple-950/60 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
                      Binance Payment Link (Optional)
                    </label>
                    <input
                      type="url"
                      value={draftConfig.binancePaymentLink || ''}
                      onChange={(e) =>
                        setDraftConfig((prev) => ({ ...prev, binancePaymentLink: e.target.value }))
                      }
                      placeholder="https://app.binance.com/..."
                      className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#141028] border border-slate-200 dark:border-purple-950/60 text-xs"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={qrInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleUploadBinanceQr}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => qrInputRef.current?.click()}
                    className="px-3 py-2 rounded-lg bg-white dark:bg-[#141028] border border-slate-200 dark:border-purple-950/60 text-xs font-bold flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>
                      {draftConfig.binanceQrCodeUrl ? 'Replace Binance QR Code' : 'Upload Binance QR Code'}
                    </span>
                  </button>
                  {draftConfig.binanceQrCodeUrl && (
                    <>
                      <img
                        src={draftConfig.binanceQrCodeUrl}
                        alt="Binance QR"
                        className="w-12 h-12 rounded-lg object-contain bg-white p-0.5 border border-slate-200"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDraftConfig((prev) => ({ ...prev, binanceQrCodeUrl: '' }))
                        }
                        className="text-xs font-bold text-rose-500"
                      >
                        Remove QR
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Toggles */}
              <div className="flex flex-wrap gap-6 pt-1">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftConfig.subscriptionsEnabled}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        subscriptionsEnabled: e.target.checked,
                      }))
                    }
                    className="rounded border-slate-300 text-[#7560DF]"
                  />
                  <span>Subscriptions Enabled</span>
                </label>

                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftConfig.requireScreenshot}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        requireScreenshot: e.target.checked,
                      }))
                    }
                    className="rounded border-slate-300 text-[#7560DF]"
                  />
                  <span>Require Payment Screenshot</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={savingConfig}
                className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs sm:text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {savingConfig ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>Save Owner Configuration</span>
              </button>
            </form>

            {/* Admin Account Management (Owner Only) */}
            <div className="p-5 rounded-2xl bg-white dark:bg-[#17132d] border border-slate-200/80 dark:border-purple-950/50 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-purple-950/40 pb-3">
                <BadgeCheck className="w-4 h-4 text-[#7560DF]" />
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  Manage Admin Accounts (Owner Only)
                </h3>
              </div>

              <form onSubmit={handleAddAdmin} className="flex gap-2">
                <input
                  type="email"
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  placeholder="Add Admin email address..."
                  className="flex-1 px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-[#1e193a] border border-slate-200 dark:border-purple-950/60 text-xs"
                />
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-4 py-2 rounded-xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-xs flex items-center gap-1.5 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Admin</span>
                </button>
              </form>

              <div className="space-y-2">
                {adminEmails.map((email) => {
                  const isDefault = email.toLowerCase() === DEFAULT_ADMIN_EMAIL;
                  return (
                    <div
                      key={email}
                      className="px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#1e193a] flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-bold text-slate-900 dark:text-white break-all">
                          {email}
                        </span>
                        <span className="text-[11px] text-slate-500 ml-2">
                          {isDefault ? '(Primary Admin · Verification Only)' : '(Admin · Verification Only)'}
                        </span>
                      </div>
                      {!isDefault && (
                        <button
                          type="button"
                          onClick={() => handleRemoveAdmin(email)}
                          className="text-rose-500 hover:text-rose-600 p-1"
                          title="Remove Admin"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* View Screenshot Modal */}
      {screenshotModal && (
        <div className="fixed inset-0 z-[60] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#16132b] w-full max-w-lg rounded-3xl border border-slate-200 dark:border-purple-950/60 overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-purple-950/50 flex items-center justify-between">
              <div className="min-w-0">
                {(() => {
                  const modalPerson = resolveUserIdentity(
                    screenshotModal.payment.userId,
                    screenshotModal.payment.displayName,
                    screenshotModal.payment.username,
                    screenshotModal.payment.email
                  );
                  return (
                    <h4 className="font-extrabold text-sm text-slate-900 dark:text-white truncate">
                      Payment Receipt · {modalPerson.displayName} (@{modalPerson.username})
                    </h4>
                  );
                })()}
                <p className="text-xs text-slate-500 truncate">
                  {renderMethodLabel(screenshotModal.payment.method)} ·{' '}
                  {formatCurrencyUsd(screenshotModal.payment.amountUsd)} (
                  {formatCurrencyEtb(screenshotModal.payment.amountEtb)})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScreenshotModal(null)}
                className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-[#221d3d] flex items-center justify-center text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex items-center justify-center min-h-[260px] bg-slate-50 dark:bg-[#0d0a1c]">
              {screenshotModal.loading ? (
                <Loader2 className="w-8 h-8 animate-spin text-[#7560DF]" />
              ) : screenshotModal.imageUrl ? (
                <img
                  src={screenshotModal.imageUrl}
                  alt="Payment screenshot"
                  className="max-h-[65dvh] w-auto object-contain rounded-xl"
                />
              ) : (
                <p className="text-xs text-rose-500 font-semibold">{screenshotModal.error}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmReject}
            className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl p-5 border border-slate-200 dark:border-purple-950/60 shadow-2xl space-y-4"
          >
            <h4 className="font-extrabold text-base text-slate-900 dark:text-white">
              Reject Payment Request
            </h4>
            {(() => {
              const targetPerson = resolveUserIdentity(
                rejectTarget.userId,
                rejectTarget.displayName,
                rejectTarget.username,
                rejectTarget.email
              );
              return (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Rejecting <span className="font-bold">{targetPerson.displayName}</span> (@{targetPerson.username})&apos;s{' '}
                  {rejectTarget.packageLabel} payment via {renderMethodLabel(rejectTarget.method)}.
                </p>
              );
            })()}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                Rejection Reason
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Payment not received in Binance / Invalid Transaction ID / Blurry screenshot"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#1e193a] border border-slate-200 dark:border-purple-950/60 text-xs text-slate-900 dark:text-white"
                required
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#221d3d] text-slate-700 dark:text-slate-200 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusyId === rejectTarget.paymentId}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5"
              >
                {actionBusyId === rejectTarget.paymentId && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>Confirm Reject</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Revoke / Reject Active Verification Modal */}
      {revokeTarget && (
        <div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmRevoke}
            className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl p-5 border border-slate-200 dark:border-purple-950/60 shadow-2xl space-y-4"
          >
            <h4 className="font-extrabold text-base text-slate-900 dark:text-white">
              Reject / Revoke Gold Verification
            </h4>
            {(() => {
              const targetPerson = resolveUserIdentity(
                revokeTarget.userId,
                revokeTarget.displayName,
                revokeTarget.username
              );
              return (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Revoking Gold Verified status for{' '}
                  <span className="font-bold">{targetPerson.displayName}</span> (@{targetPerson.username}) ·{' '}
                  {revokeTarget.packageLabel}.
                </p>
              );
            })()}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                Reason
              </label>
              <textarea
                rows={3}
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="e.g. Payment reversed / Verification cancelled by administrator"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#1e193a] border border-slate-200 dark:border-purple-950/60 text-xs text-slate-900 dark:text-white"
                required
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setRevokeTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#221d3d] text-slate-700 dark:text-slate-200 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusyId === revokeTarget.userId}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5"
              >
                {actionBusyId === revokeTarget.userId && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>Confirm Reject / Revoke</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );

  if (standalone) {
    return content;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/75 backdrop-blur-sm">
      {content}
    </div>
  );
};
