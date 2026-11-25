import {
  doc,
  getDoc,
  runTransaction,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  auth,
  db,
  restoreAccountFirebaseSession,
  storage,
} from './firebase';
import { compressImage } from './mediaCompression';
import {
  AdminRolesConfig,
  AppRole,
  PaymentAuditLog,
  PaymentMethod,
  PaymentRequest,
  PaymentScreenshotRecord,
  SubscriptionConfig,
  SubscriptionPackage,
  UserProfile,
  UserSubscription,
} from '../types';

export const OWNER_EMAIL = 'ruubengirma@gmail.com';
export const DEFAULT_ADMIN_EMAIL = 'ruubewallagga@gmail.com';
export const PREMIUM_PAYMENT_REQUESTS_COLLECTION = 'premium_payment_requests';

export const PAYMENT_CONFIRMATION_MESSAGE =
  'Your payment has been submitted successfully. Please wait while our team verifies your payment.';

export const DEFAULT_PACKAGES: SubscriptionPackage[] = [
  { id: 'pkg_3m', months: 3, label: '3 Months', priceUsd: 6, priceEtb: 1080 },
  { id: 'pkg_6m', months: 6, label: '6 Months', priceUsd: 12, priceEtb: 2160 },
  { id: 'pkg_12m', months: 12, label: '12 Months', priceUsd: 24, priceEtb: 4320 },
];

export const DEFAULT_SUBSCRIPTION_CONFIG: SubscriptionConfig = {
  configId: 'subscription',
  packages: DEFAULT_PACKAGES,
  telebirrAccountNumber: '0952972408',
  telebirrAccountName: 'Roben Girma',
  cbeAccountNumber: '1000767624728',
  cbeAccountName: 'Ruben Girma',
  binanceUid: 'Ruubewallaga@gmail.com',
  binancePaymentLink: '',
  binanceQrCodeUrl: '',
  subscriptionsEnabled: true,
  requireScreenshot: true,
};

export function getAccountRole(
  email?: string | null,
  adminEmails: string[] = [DEFAULT_ADMIN_EMAIL]
): AppRole {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return 'user';
  if (normalized === OWNER_EMAIL) return 'owner';
  if (normalized === DEFAULT_ADMIN_EMAIL) return 'admin';
  const normalizedAdmins = adminEmails.map((e) => e.trim().toLowerCase());
  if (normalizedAdmins.includes(normalized)) return 'admin';
  return 'user';
}

export function addCalendarMonths(startDate: Date, months: number): Date {
  const result = new Date(startDate.getTime());
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, daysInTargetMonth));
  return result;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const UPCOMING_EXPIRATION_DAYS = 7;

export function getSubscriptionExpiryMs(sub?: UserSubscription | null): number {
  if (!sub) return 0;
  if (typeof sub.expiresAtMs === 'number' && Number.isFinite(sub.expiresAtMs) && sub.expiresAtMs > 0) {
    return sub.expiresAtMs;
  }
  const iso = sub.premiumExpiryDate || sub.expiresAt;
  if (!iso) return 0;
  const parsed = new Date(iso).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isSubscriptionActive(
  sub?: UserSubscription | null,
  nowMs: number = Date.now()
): boolean {
  if (!sub) return false;
  if (sub.status !== 'active') return false;
  if (sub.premiumStatus && sub.premiumStatus !== 'active') return false;
  return getSubscriptionExpiryMs(sub) > nowMs;
}

export function isSubscriptionExpiringSoon(
  sub?: UserSubscription | null,
  nowMs: number = Date.now(),
  withinDays: number = UPCOMING_EXPIRATION_DAYS
): boolean {
  if (!isSubscriptionActive(sub, nowMs)) return false;
  const remaining = getSubscriptionExpiryMs(sub) - nowMs;
  return remaining > 0 && remaining <= withinDays * DAY_MS;
}

export function getRemainingDays(
  sub?: UserSubscription | null,
  nowMs: number = Date.now()
): number {
  const remaining = getSubscriptionExpiryMs(sub) - nowMs;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / DAY_MS);
}

export function normalizeTransactionId(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9_-]/g, '');
}

export function buildTransactionLockId(
  method: 'telebirr' | 'cbe',
  normalizedTxId: string
): string {
  return `${method}_${normalizedTxId}`;
}

export function formatCurrencyEtb(amount: number): string {
  return `ETB ${Math.round(amount).toLocaleString('en-US')}`;
}

export function formatCurrencyUsd(amount: number): string {
  const num = Number(amount);
  if (Number.isInteger(num)) return `$${num.toLocaleString('en-US')}`;
  return `$${num.toFixed(2)}`;
}

export async function compressReceiptImage(file: File): Promise<{
  dataUrl: string;
  mimeType: string;
  fileSize: number;
}> {
  let compressed = await compressImage(file, 1080, 1080, 0.72);
  if (compressed.sizeBytes > 480000) {
    compressed = await compressImage(file, 860, 860, 0.56);
  }
  if (compressed.sizeBytes > 650000) {
    compressed = await compressImage(file, 720, 720, 0.45);
  }
  if (compressed.sizeBytes > 880000) {
    throw new Error('Screenshot image is too large. Please choose a smaller image.');
  }
  return {
    dataUrl: compressed.dataUrl,
    mimeType: 'image/jpeg',
    fileSize: compressed.sizeBytes,
  };
}

function dataUrlToBlob(dataUrl: string, fallbackMime = 'image/jpeg'): Blob {
  const parts = dataUrl.split(',');
  const header = parts[0] || '';
  const base64 = parts[1] || '';
  const mimeMatch = header.match(/data:([^;]+);base64/);
  const mime = mimeMatch?.[1] || fallbackMime;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

async function tryUploadScreenshotToStorage(
  uid: string,
  paymentId: string,
  blob: Blob,
  mimeType: string
): Promise<{ downloadUrl: string; storagePath: string } | null> {
  const storagePath = `payment_screenshots/${uid}/${paymentId}.jpg`;
  const storageRef = ref(storage, storagePath);

  try {
    const uploadPromise = (async () => {
      await uploadBytes(storageRef, blob, { contentType: mimeType });
      const downloadUrl = await getDownloadURL(storageRef);
      return { downloadUrl, storagePath };
    })();

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 5000);
    });

    return await Promise.race([uploadPromise, timeoutPromise]);
  } catch (err) {
    console.warn('Firebase Storage upload unavailable, using Firestore receipt storage fallback:', err);
    return null;
  }
}

export async function getVerifiedIdToken(expectedUid?: string | null): Promise<string> {
  await auth.authStateReady();
  let user = auth.currentUser;
  if (!user || (expectedUid && user.uid !== expectedUid)) {
    const targetUid = expectedUid || user?.uid;
    if (targetUid) {
      const restored = await restoreAccountFirebaseSession(targetUid);
      if (restored) {
        user = restored;
      }
    }
  }
  if (!user) {
    throw new Error(
      'Your authentication session is not active. Please sign out and log in again.'
    );
  }
  return user.getIdToken(true);
}

export async function fetchVerifiedServerRole(expectedUid?: string | null): Promise<{
  uid: string;
  email: string;
  emailVerified: boolean;
  role: AppRole;
} | null> {
  await auth.authStateReady();
  let user = auth.currentUser;
  if ((!user || (expectedUid && user.uid !== expectedUid)) && expectedUid) {
    user = await restoreAccountFirebaseSession(expectedUid);
  }
  if (!user) return null;
  try {
    const tokenResult = await user.getIdTokenResult(true);
    const claims = (tokenResult.claims || {}) as Record<string, unknown>;
    const claimRoleRaw = String(claims.role || '').trim().toLowerCase();
    const claimRole: AppRole =
      claimRoleRaw === 'owner' || claims.owner === true
        ? 'owner'
        : claimRoleRaw === 'admin' || claims.admin === true
        ? 'admin'
        : 'user';

    const resp = await fetch('/api/subscription/role', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenResult.token}`,
      },
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        return null;
      }
      return {
        uid: user.uid,
        email: (user.email || '').trim().toLowerCase(),
        emailVerified: Boolean(user.emailVerified),
        role: claimRole,
      };
    }
    return (await resp.json()) as {
      uid: string;
      email: string;
      emailVerified: boolean;
      role: AppRole;
    };
  } catch {
    return null;
  }
}

export async function submitSubscriptionPayment(params: {
  userProfile: UserProfile;
  selectedPackage: SubscriptionPackage;
  method: PaymentMethod;
  transactionId?: string;
  screenshotFile?: File | null;
  requireScreenshot: boolean;
}): Promise<PaymentRequest> {
  await auth.authStateReady();
  let firebaseUser = auth.currentUser;
  if ((!firebaseUser || firebaseUser.uid !== params.userProfile.userId) && params.userProfile.userId) {
    firebaseUser = await restoreAccountFirebaseSession(params.userProfile.userId);
  }
  if (!firebaseUser) {
    throw new Error(
      'Your login session has expired. Please sign out and log in again before submitting a payment.'
    );
  }

  const uid = firebaseUser.uid;
  const { selectedPackage, method, requireScreenshot } = params;

  // Validate Transaction ID strictly for Telebirr & CBE; never allow/require for Binance
  let cleanTransactionId: string | undefined;
  let normalizedTxId: string | undefined;
  let txLockId: string | undefined;

  if (method === 'telebirr' || method === 'cbe') {
    const rawTx = (params.transactionId || '').trim();
    const norm = normalizeTransactionId(rawTx);
    if (!rawTx || norm.length < 3 || norm.length > 120) {
      throw new Error(
        `Please enter a valid ${method === 'telebirr' ? 'Telebirr' : 'CBE Bank'} Transaction ID.`
      );
    }
    cleanTransactionId = rawTx.slice(0, 120);
    normalizedTxId = norm;
    txLockId = buildTransactionLockId(method, norm);
  }

  if (requireScreenshot && !params.screenshotFile) {
    throw new Error('Please upload your payment screenshot before submitting.');
  }

  let screenshotPayload: { dataUrl: string; mimeType: string; fileSize: number } | null = null;
  if (params.screenshotFile) {
    screenshotPayload = await compressReceiptImage(params.screenshotFile);
  } else if (requireScreenshot) {
    throw new Error('Please upload a payment screenshot.');
  }

  // Fast pre-checks for clearer messages before transaction
  const pendingLockRef = doc(db, 'userPendingLocks', uid);
  const existingPendingLock = await getDoc(pendingLockRef).catch(() => null);
  if (existingPendingLock && existingPendingLock.exists()) {
    throw new Error(
      'You already have a pending payment verification request. Please wait for our team to review it.'
    );
  }

  if (txLockId) {
    const txLockSnap = await getDoc(doc(db, 'transactionLocks', txLockId)).catch(() => null);
    if (txLockSnap && txLockSnap.exists()) {
      throw new Error(
        'This Transaction ID has already been used. Duplicate transaction IDs are not permitted.'
      );
    }
  }

  const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  let uploadedStorageUrl = '';
  let uploadedStoragePath = '';
  if (screenshotPayload) {
    const blob = dataUrlToBlob(screenshotPayload.dataUrl, screenshotPayload.mimeType);
    const storageRes = await tryUploadScreenshotToStorage(
      uid,
      paymentId,
      blob,
      screenshotPayload.mimeType
    );
    if (storageRes) {
      uploadedStorageUrl = storageRes.downloadUrl;
      uploadedStoragePath = storageRes.storagePath;
    }
  }

  // Always provide a valid screenshotUrl (Firebase Storage download URL when provisioned,
  // or compressed image dataUrl fallback stored within Firestore document size limits)
  const resolvedScreenshotUrl =
    uploadedStorageUrl ||
    (screenshotPayload && screenshotPayload.dataUrl.length <= 550000
      ? screenshotPayload.dataUrl
      : '');

  const fallbackHandle = (firebaseUser.email || params.userProfile.email || '')
    .split('@')[0]
    ?.trim() || 'user';
  const resolvedUsername = (params.userProfile.username || fallbackHandle)
    .trim()
    .slice(0, 50) || 'user';
  const rawProfileName = (params.userProfile.displayName || '').trim();
  const rawAuthName = (firebaseUser.displayName || '').trim();
  const resolvedDisplayName = (
    (rawProfileName && rawProfileName !== uid ? rawProfileName : '') ||
    (rawAuthName && rawAuthName !== uid ? rawAuthName : '') ||
    resolvedUsername
  ).slice(0, 100);

  const paymentRecord: PaymentRequest = {
    paymentId,
    uid,
    userId: uid,
    username: resolvedUsername,
    displayName: resolvedDisplayName,
    email: (firebaseUser.email || params.userProfile.email || '')
      .trim()
      .toLowerCase()
      .slice(0, 200),
    ...(params.userProfile.photoURL && params.userProfile.photoURL.length <= 200000
      ? { photoURL: params.userProfile.photoURL }
      : {}),
    packageId: selectedPackage.id,
    packageLabel: selectedPackage.label,
    durationMonths: Number(selectedPackage.months),
    method,
    amountUsd: Number(selectedPackage.priceUsd),
    amountEtb: Number(selectedPackage.priceEtb),
    ...(cleanTransactionId ? { transactionId: cleanTransactionId } : {}),
    ...(normalizedTxId ? { normalizedTransactionId: normalizedTxId } : {}),
    ...(resolvedScreenshotUrl ? { screenshotUrl: resolvedScreenshotUrl } : {}),
    ...(uploadedStoragePath ? { screenshotStoragePath: uploadedStoragePath } : {}),
    screenshotId: screenshotPayload ? paymentId : '',
    status: 'pending',
    submittedAt: nowIso,
    submittedAtMs: nowMs,
  };

  const screenshotRecord: PaymentScreenshotRecord | null = screenshotPayload
    ? {
        paymentId,
        userId: uid,
        imageDataUrl: uploadedStorageUrl || screenshotPayload.dataUrl,
        mimeType: screenshotPayload.mimeType,
        fileSize: screenshotPayload.fileSize,
        createdAt: nowIso,
      }
    : null;

  await runTransaction(db, async (tx) => {
    const lockSnap = await tx.get(pendingLockRef);
    if (lockSnap.exists()) {
      throw new Error(
        'You already have a pending payment verification request. Duplicate submissions are blocked.'
      );
    }

    if (txLockId && normalizedTxId && (method === 'telebirr' || method === 'cbe')) {
      const txLockRef = doc(db, 'transactionLocks', txLockId);
      const txSnap = await tx.get(txLockRef);
      if (txSnap.exists()) {
        throw new Error(
          'This Transaction ID has already been submitted. Duplicate transaction IDs are not allowed.'
        );
      }
      tx.set(txLockRef, {
        txKey: txLockId,
        method,
        normalizedTxId,
        userId: uid,
        paymentId,
        createdAt: nowIso,
      });
    }

    tx.set(pendingLockRef, {
      userId: uid,
      paymentId,
      createdAt: nowIso,
    });

    if (screenshotRecord) {
      tx.set(doc(db, 'paymentScreenshots', paymentId), screenshotRecord);
    }
    tx.set(doc(db, PREMIUM_PAYMENT_REQUESTS_COLLECTION, paymentId), paymentRecord);
  });

  return paymentRecord;
}

export async function approvePaymentRequest(
  payment: PaymentRequest,
  expectedUid?: string | null
): Promise<UserSubscription> {
  const idToken = await getVerifiedIdToken(expectedUid);

  const authResp = await fetch('/api/subscription/authorize-review', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      paymentId: payment.paymentId,
      decision: 'APPROVED',
      durationMonths: payment.durationMonths,
    }),
  });

  const authData = await authResp.json().catch(() => ({}));
  if (!authResp.ok || !authData.authorized) {
    throw new Error(
      authData.error || 'Unauthorized: Could not verify your Owner/Admin permissions.'
    );
  }

  const role = authData.role as 'owner' | 'admin';
  const reviewerUid = String(authData.reviewerUid);
  const reviewerEmail = String(authData.reviewerEmail);
  const reviewedAt = String(authData.reviewedAt);

  const paymentRef = doc(db, PREMIUM_PAYMENT_REQUESTS_COLLECTION, payment.paymentId);
  const subRef = doc(db, 'subscriptions', payment.userId);
  const userRef = doc(db, 'users', payment.userId);
  const pendingLockRef = doc(db, 'userPendingLocks', payment.userId);
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const logRef = doc(db, 'paymentAuditLogs', logId);

  let savedSub!: UserSubscription;

  await runTransaction(db, async (tx) => {
    const paySnap = await tx.get(paymentRef);
    if (!paySnap.exists()) {
      throw new Error('Payment request no longer exists.');
    }
    const livePay = paySnap.data() as PaymentRequest;
    if (String(livePay.status || '').toLowerCase() !== 'pending') {
      throw new Error(`Payment has already been ${livePay.status}.`);
    }

    const existingSubSnap = await tx.get(subRef);
    const existingSub = existingSubSnap.exists()
      ? (existingSubSnap.data() as UserSubscription)
      : null;
    const userSnap = await tx.get(userRef);

    if (
      existingSub &&
      (existingSub.approvedPaymentId === payment.paymentId ||
        existingSub.paymentId === payment.paymentId)
    ) {
      throw new Error('This payment has already activated a subscription.');
    }

    const nowMs = new Date(authData.startDate).getTime();
    const serverStartDate = String(authData.startDate);
    let effectiveStartDate = serverStartDate;
    let expiresDate: Date;
    let isRenewalExtension = false;

    const existingExpiryMs = getSubscriptionExpiryMs(existingSub);
    if (existingSub && isSubscriptionActive(existingSub, nowMs) && existingExpiryMs > nowMs) {
      // Renewal while active: extend cleanly from existing expiry date using exact calendar months
      expiresDate = addCalendarMonths(new Date(existingExpiryMs), payment.durationMonths);
      effectiveStartDate =
        existingSub.premiumStartDate || existingSub.startDate || serverStartDate;
      isRenewalExtension = true;
    } else {
      expiresDate = new Date(authData.expiresAt);
    }

    const expiryIso = expiresDate.toISOString();

    const nextSub: UserSubscription = {
      userId: payment.userId,
      username: payment.username,
      displayName: payment.displayName,
      packageId: payment.packageId,
      packageLabel: payment.packageLabel,
      durationMonths: payment.durationMonths,
      subscriptionDuration: payment.durationMonths,
      status: 'active',
      premiumStatus: 'active',
      startDate: effectiveStartDate,
      premiumStartDate: effectiveStartDate,
      expiresAt: expiryIso,
      premiumExpiryDate: expiryIso,
      expiresAtMs: expiresDate.getTime(),
      paymentId: payment.paymentId,
      approvedPaymentId: payment.paymentId,
      approvedByUid: reviewerUid,
      approvedByEmail: reviewerEmail,
      approvedByRole: role,
      ...(isRenewalExtension ? { renewedAt: reviewedAt } : {}),
      updatedAt: reviewedAt,
    };

    savedSub = nextSub;

    tx.update(paymentRef, {
      status: 'approved',
      reviewedAt,
      reviewedByUid: reviewerUid,
      reviewedByEmail: reviewerEmail,
      reviewedByRole: role,
      approvedBy: reviewerEmail,
      approvedAt: reviewedAt,
    });

    tx.set(subRef, nextSub);
    if (userSnap.exists()) {
      tx.update(userRef, {
        isPremium: true,
        goldVerified: true,
        subscriptionStatus: 'active',
        premiumStatus: 'active',
        subscriptionPackage: payment.packageLabel,
        subscriptionStartDate: effectiveStartDate,
        premiumStartDate: effectiveStartDate,
        subscriptionExpiresAt: expiryIso,
        premiumExpiryDate: expiryIso,
        subscriptionDuration: payment.durationMonths,
        approvedPaymentId: payment.paymentId,
        updatedAt: reviewedAt,
      });
    }
    tx.delete(pendingLockRef);

    const auditLog: PaymentAuditLog = {
      logId,
      action: 'PAYMENT_APPROVED',
      paymentId: payment.paymentId,
      targetUserId: payment.userId,
      targetUsername: payment.username,
      actorUserId: reviewerUid,
      actorEmail: reviewerEmail,
      actorRole: role,
      details: `${isRenewalExtension ? 'Renewed/extended' : 'Approved'} ${payment.packageLabel} (${payment.method.toUpperCase()} · ${formatCurrencyUsd(payment.amountUsd)} / ${formatCurrencyEtb(payment.amountEtb)}), expires ${expiryIso.slice(0, 10)}`,
      createdAt: reviewedAt,
    };
    tx.set(logRef, auditLog);
  });

  // Deterministic notification ID prevents duplicate activation notifications
  const notifId = `notif_sub_activated_${payment.paymentId}`;
  const formattedExpiry = new Date(savedSub.expiresAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  await setDoc(doc(db, 'notifications', notifId), {
    notificationId: notifId,
    recipientId: payment.userId,
    actorId: reviewerUid,
    actorUsername: role === 'owner' ? 'owner' : 'admin',
    actorDisplayName: 'Ethio Chat Premium',
    type: 'subscription',
    text: `Your ${payment.packageLabel} Premium subscription & Gold Verified Badge are now active until ${formattedExpiry}.`,
    read: false,
    createdAt: reviewedAt,
  }).catch(() => {});

  return savedSub;
}

export async function rejectPaymentRequest(
  payment: PaymentRequest,
  reason: string,
  expectedUid?: string | null
): Promise<void> {
  const idToken = await getVerifiedIdToken(expectedUid);

  const authResp = await fetch('/api/subscription/authorize-review', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      paymentId: payment.paymentId,
      decision: 'REJECTED',
      durationMonths: payment.durationMonths,
    }),
  });

  const authData = await authResp.json().catch(() => ({}));
  if (!authResp.ok || !authData.authorized) {
    throw new Error(
      authData.error || 'Unauthorized: Could not verify your Owner/Admin permissions.'
    );
  }

  const role = authData.role as 'owner' | 'admin';
  const reviewerUid = String(authData.reviewerUid);
  const reviewerEmail = String(authData.reviewerEmail);
  const reviewedAt = String(authData.reviewedAt);
  const cleanReason = (reason || 'Payment verification failed or details mismatched.').trim().slice(0, 500);

  const paymentRef = doc(db, PREMIUM_PAYMENT_REQUESTS_COLLECTION, payment.paymentId);
  const pendingLockRef = doc(db, 'userPendingLocks', payment.userId);
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const logRef = doc(db, 'paymentAuditLogs', logId);

  await runTransaction(db, async (tx) => {
    const paySnap = await tx.get(paymentRef);
    if (!paySnap.exists()) {
      throw new Error('Payment request no longer exists.');
    }
    const livePay = paySnap.data() as PaymentRequest;
    if (String(livePay.status || '').toLowerCase() !== 'pending') {
      throw new Error(`Payment has already been ${livePay.status}.`);
    }

    tx.update(paymentRef, {
      status: 'rejected',
      rejectionReason: cleanReason,
      reviewedAt,
      reviewedByUid: reviewerUid,
      reviewedByEmail: reviewerEmail,
      reviewedByRole: role,
      rejectedBy: reviewerEmail,
      rejectedAt: reviewedAt,
    });

    tx.delete(pendingLockRef);

    const auditLog: PaymentAuditLog = {
      logId,
      action: 'PAYMENT_REJECTED',
      paymentId: payment.paymentId,
      targetUserId: payment.userId,
      targetUsername: payment.username,
      actorUserId: reviewerUid,
      actorEmail: reviewerEmail,
      actorRole: role,
      details: `Rejected ${payment.packageLabel} (${payment.method.toUpperCase()})`,
      rejectionReason: cleanReason,
      createdAt: reviewedAt,
    };
    tx.set(logRef, auditLog);
  });

  // Notify user clearly
  const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await setDoc(doc(db, 'notifications', notifId), {
    notificationId: notifId,
    recipientId: payment.userId,
    actorId: reviewerUid,
    actorUsername: role === 'owner' ? 'owner' : 'admin',
    actorDisplayName: 'Ethio Chat Billing',
    type: 'warning',
    text: `Your ${payment.packageLabel} payment request was rejected: ${cleanReason}`,
    read: false,
    createdAt: reviewedAt,
  }).catch(() => {});
}

export async function syncSubscriptionLifecycleViaServer(
  expectedUid?: string | null,
  options?: { simulateNowIso?: string; targetUserId?: string }
): Promise<{
  ok: boolean;
  expiredCount: number;
  reminded7dCount: number;
  reminded1dCount: number;
}> {
  const idToken = await getVerifiedIdToken(expectedUid);
  const resp = await fetch('/api/subscription/sync-lifecycle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(options || {}),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || 'Failed to synchronize subscription lifecycle.');
  }
  return {
    ok: Boolean(data.ok),
    expiredCount: Number(data.expiredCount || 0),
    reminded7dCount: Number(data.reminded7dCount || 0),
    reminded1dCount: Number(data.reminded1dCount || 0),
  };
}

export async function syncExpiredSubscriptions(
  subs: UserSubscription[],
  actor: { uid: string; email: string; role: 'owner' | 'admin' }
): Promise<number> {
  // Prefer authoritative backend lifecycle sweep first
  try {
    const serverRes = await syncSubscriptionLifecycleViaServer(actor.uid);
    if (serverRes.ok) {
      return serverRes.expiredCount;
    }
  } catch {
    // Fall back to authenticated Owner/Admin Firestore transaction sweep
  }

  await getVerifiedIdToken(actor.uid);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let synced = 0;

  for (const sub of subs) {
    if (sub.status !== 'active') continue;
    const expiryMs = getSubscriptionExpiryMs(sub);
    if (expiryMs <= 0) continue;
    const payId = (sub.approvedPaymentId || sub.paymentId || 'sub').replace(/[^a-zA-Z0-9_-]/g, '_');

    try {
      if (expiryMs <= nowMs) {
        await updateDoc(doc(db, 'subscriptions', sub.userId), {
          status: 'expired',
          premiumStatus: 'expired',
          expiredAt: nowIso,
          expiredNotifPaymentId: payId,
          updatedAt: nowIso,
        });

        await updateDoc(doc(db, 'users', sub.userId), {
          isPremium: false,
          goldVerified: false,
          subscriptionStatus: 'expired',
          premiumStatus: 'expired',
          updatedAt: nowIso,
        }).catch(() => {});

        const logId = `log_exp_${sub.userId.slice(0, 12)}_${payId.slice(0, 24)}`;
        await setDoc(doc(db, 'paymentAuditLogs', logId), {
          logId,
          action: 'SUBSCRIPTION_EXPIRED',
          paymentId: sub.paymentId,
          targetUserId: sub.userId,
          targetUsername: sub.username || 'user',
          actorUserId: actor.uid,
          actorEmail: actor.email,
          actorRole: actor.role,
          details: `Auto-expired ${sub.packageLabel} subscription after ${sub.premiumExpiryDate || sub.expiresAt}`,
          createdAt: nowIso,
        } satisfies PaymentAuditLog).catch(() => {});

        if (sub.expiredNotifPaymentId !== payId) {
          const notifId = `notif_sub_expired_${payId}`;
          await setDoc(doc(db, 'notifications', notifId), {
            notificationId: notifId,
            recipientId: sub.userId,
            actorId: actor.uid,
            actorUsername: actor.role === 'owner' ? 'owner' : 'admin',
            actorDisplayName: 'Ethio Chat Premium',
            type: 'subscription',
            text: `Your ${sub.packageLabel} Premium subscription has expired and your Gold Verified Badge has been removed. Renew anytime in Settings > Subscription.`,
            read: false,
            createdAt: nowIso,
          }).catch(() => {});
        }
        synced += 1;
      } else {
        const remainingMs = expiryMs - nowMs;
        if (remainingMs <= DAY_MS && sub.reminder1dPaymentId !== payId) {
          const notifId = `notif_sub_1d_${payId}`;
          await setDoc(doc(db, 'notifications', notifId), {
            notificationId: notifId,
            recipientId: sub.userId,
            actorId: actor.uid,
            actorUsername: actor.role === 'owner' ? 'owner' : 'admin',
            actorDisplayName: 'Ethio Chat Premium',
            type: 'subscription',
            text: `Reminder: Your ${sub.packageLabel} Premium subscription expires in less than 1 day. Renew now to keep your Gold Verified Badge without interruption.`,
            read: false,
            createdAt: nowIso,
          }).catch(() => {});
          await updateDoc(doc(db, 'subscriptions', sub.userId), {
            reminder1dPaymentId: payId,
            updatedAt: nowIso,
          }).catch(() => {});
        } else if (
          remainingMs > DAY_MS &&
          remainingMs <= 7 * DAY_MS &&
          sub.reminder7dPaymentId !== payId
        ) {
          const daysLeft = Math.ceil(remainingMs / DAY_MS);
          const notifId = `notif_sub_7d_${payId}`;
          await setDoc(doc(db, 'notifications', notifId), {
            notificationId: notifId,
            recipientId: sub.userId,
            actorId: actor.uid,
            actorUsername: actor.role === 'owner' ? 'owner' : 'admin',
            actorDisplayName: 'Ethio Chat Premium',
            type: 'subscription',
            text: `Reminder: Your ${sub.packageLabel} Premium subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Renew early to extend from your current expiry date.`,
            read: false,
            createdAt: nowIso,
          }).catch(() => {});
          await updateDoc(doc(db, 'subscriptions', sub.userId), {
            reminder7dPaymentId: payId,
            updatedAt: nowIso,
          }).catch(() => {});
        }
      }
    } catch {
      // ignore transient offline/permission issues
    }
  }
  return synced;
}

export async function expireOwnSubscriptionIfDue(sub: UserSubscription): Promise<boolean> {
  if (!sub || sub.status !== 'active') return false;
  const expiryMs = getSubscriptionExpiryMs(sub);
  if (!expiryMs || expiryMs > Date.now()) return false;

  await auth.authStateReady();
  const firebaseUser = auth.currentUser;
  if (!firebaseUser || firebaseUser.uid !== sub.userId) return false;

  const nowIso = new Date().toISOString();
  const payId = (sub.approvedPaymentId || sub.paymentId || 'sub').replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    await updateDoc(doc(db, 'subscriptions', sub.userId), {
      status: 'expired',
      premiumStatus: 'expired',
      expiredAt: nowIso,
      expiredNotifPaymentId: payId,
      updatedAt: nowIso,
    });

    await updateDoc(doc(db, 'users', sub.userId), {
      isPremium: false,
      goldVerified: false,
      subscriptionStatus: 'expired',
      premiumStatus: 'expired',
      updatedAt: nowIso,
    }).catch(() => {});

    if (sub.expiredNotifPaymentId !== payId) {
      const notifId = `notif_sub_expired_${payId}`;
      await setDoc(doc(db, 'notifications', notifId), {
        notificationId: notifId,
        recipientId: sub.userId,
        actorId: sub.approvedByUid || sub.userId,
        actorUsername: sub.approvedByRole || 'owner',
        actorDisplayName: 'Ethio Chat Premium',
        type: 'subscription',
        text: `Your ${sub.packageLabel} Premium subscription has expired and your Gold Verified Badge has been removed. Renew anytime in Settings > Subscription.`,
        read: false,
        createdAt: nowIso,
      }).catch(() => {});
    }

    return true;
  } catch {
    return false;
  }
}

export async function revokeUserSubscription(
  sub: UserSubscription,
  reason: string,
  expectedUid?: string | null
): Promise<void> {
  await getVerifiedIdToken(expectedUid);
  const verified = await fetchVerifiedServerRole(expectedUid);
  if (!verified || (verified.role !== 'owner' && verified.role !== 'admin')) {
    throw new Error('Unauthorized: Only verified Owner or Admin accounts can revoke verification.');
  }

  const nowIso = new Date().toISOString();
  const cleanReason = (reason || 'Verification revoked by administrator.').trim().slice(0, 500);

  await updateDoc(doc(db, 'subscriptions', sub.userId), {
    status: 'revoked',
    premiumStatus: 'revoked',
    expiredAt: nowIso,
    updatedAt: nowIso,
  });

  await updateDoc(doc(db, 'users', sub.userId), {
    isPremium: false,
    goldVerified: false,
    subscriptionStatus: 'revoked',
    premiumStatus: 'revoked',
    updatedAt: nowIso,
  }).catch(() => {});

  const logId = `log_rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const auditLog: PaymentAuditLog = {
    logId,
    action: 'SUBSCRIPTION_REVOKED',
    paymentId: sub.approvedPaymentId || sub.paymentId,
    targetUserId: sub.userId,
    targetUsername: sub.username || 'user',
    actorUserId: verified.uid,
    actorEmail: verified.email,
    actorRole: verified.role,
    details: `Revoked ${sub.packageLabel} verified status`,
    rejectionReason: cleanReason,
    createdAt: nowIso,
  };
  await setDoc(doc(db, 'paymentAuditLogs', logId), auditLog).catch(() => {});

  const notifId = `notif_sub_revoked_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await setDoc(doc(db, 'notifications', notifId), {
    notificationId: notifId,
    recipientId: sub.userId,
    actorId: verified.uid,
    actorUsername: verified.role === 'owner' ? 'owner' : 'admin',
    actorDisplayName: 'Ethio Chat Billing',
    type: 'warning',
    text: `Your ${sub.packageLabel} Gold Verified subscription was rejected/revoked: ${cleanReason}`,
    read: false,
    createdAt: nowIso,
  }).catch(() => {});
}

export async function saveOwnerSubscriptionConfig(
  nextConfig: Omit<SubscriptionConfig, 'configId' | 'updatedAt' | 'updatedByEmail'>
): Promise<SubscriptionConfig> {
  const idToken = await getVerifiedIdToken();
  const resp = await fetch('/api/subscription/authorize-owner-config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });
  const authData = await resp.json().catch(() => ({}));
  if (!resp.ok || !authData.authorized) {
    throw new Error(authData.error || 'Forbidden: Owner role required.');
  }

  const user = auth.currentUser!;
  const updatedAt = String(authData.updatedAt || new Date().toISOString());
  const ownerEmail = String(authData.ownerEmail || OWNER_EMAIL);

  const payload: SubscriptionConfig = {
    ...nextConfig,
    configId: 'subscription',
    binancePaymentLink: (nextConfig.binancePaymentLink || '').trim(),
    binanceQrCodeUrl: (nextConfig.binanceQrCodeUrl || '').trim(),
    updatedAt,
    updatedByEmail: ownerEmail,
  };

  await setDoc(doc(db, 'appConfig', 'subscription'), payload);

  const logId = `log_cfg_${Date.now()}`;
  await setDoc(doc(db, 'paymentAuditLogs', logId), {
    logId,
    action: 'CONFIG_UPDATED',
    actorUserId: user.uid,
    actorEmail: ownerEmail,
    actorRole: 'owner',
    details: 'Updated subscription package prices, payment accounts, or Binance settings',
    createdAt: updatedAt,
  } satisfies PaymentAuditLog).catch(() => {});

  return payload;
}

export async function saveOwnerAdminRoles(
  adminEmails: string[],
  auditAction: 'ADMIN_ADDED' | 'ADMIN_REMOVED',
  targetEmail: string
): Promise<AdminRolesConfig> {
  const idToken = await getVerifiedIdToken();
  const resp = await fetch('/api/subscription/authorize-owner-config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });
  const authData = await resp.json().catch(() => ({}));
  if (!resp.ok || !authData.authorized) {
    throw new Error(authData.error || 'Forbidden: Owner role required.');
  }

  const user = auth.currentUser!;
  const updatedAt = String(authData.updatedAt || new Date().toISOString());
  const ownerEmail = String(authData.ownerEmail || OWNER_EMAIL);

  const normalizedSet = new Set<string>([DEFAULT_ADMIN_EMAIL]);
  adminEmails.forEach((e) => {
    const clean = e.trim().toLowerCase();
    if (clean && clean !== OWNER_EMAIL) {
      normalizedSet.add(clean);
    }
  });

  const payload: AdminRolesConfig = {
    configId: 'roles',
    ownerEmail: OWNER_EMAIL,
    adminEmails: Array.from(normalizedSet),
    updatedAt,
    updatedByEmail: ownerEmail,
  };

  await setDoc(doc(db, 'appConfig', 'roles'), payload);

  const logId = `log_role_${Date.now()}`;
  await setDoc(doc(db, 'paymentAuditLogs', logId), {
    logId,
    action: auditAction,
    actorUserId: user.uid,
    actorEmail: ownerEmail,
    actorRole: 'owner',
    details: `${auditAction === 'ADMIN_ADDED' ? 'Added' : 'Removed'} Admin access for ${targetEmail.toLowerCase()}`,
    createdAt: updatedAt,
  } satisfies PaymentAuditLog).catch(() => {});

  return payload;
}

export async function fetchPaymentScreenshot(
  paymentId: string
): Promise<PaymentScreenshotRecord | null> {
  const snap = await getDoc(doc(db, 'paymentScreenshots', paymentId));
  if (!snap.exists()) return null;
  return snap.data() as PaymentScreenshotRecord;
}
