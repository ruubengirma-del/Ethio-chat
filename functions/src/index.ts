import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const FIRESTORE_DATABASE_ID = 'ai-studio-5aaa3ce5-6e86-4e68-b4fb-8f3678935a86';
const OWNER_UID = 'aDB36ZT1j0QajDvQrMbkY1AGLSt2';
const OWNER_EMAIL = 'ruubengirma@gmail.com';
const DAY_MS = 24 * 60 * 60 * 1000;

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore(getApp(), FIRESTORE_DATABASE_ID);

/**
 * Cloud Scheduler + Cloud Functions v2 automatic Premium expiration & reminder job.
 * Runs every 15 minutes server-side independently of whether users have the app open.
 * Requires Firebase Blaze plan + Cloud Scheduler API enabled when deploying:
 *   cd functions && npm install && npm run deploy
 */
export const scheduledPremiumLifecycle = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'UTC',
    retryCount: 2,
  },
  async () => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const activeSnap = await db
      .collection('subscriptions')
      .where('status', '==', 'active')
      .get();

    if (activeSnap.empty) return;

    for (const subDoc of activeSnap.docs) {
      const sub = subDoc.data() as Record<string, unknown>;
      const userId = String(sub.userId || subDoc.id);
      const username = String(sub.username || 'user');
      const packageLabel = String(sub.packageLabel || 'Premium');
      const expiresAtIso = String(sub.premiumExpiryDate || sub.expiresAt || '');
      const expiresAtMs =
        Number(sub.expiresAtMs || 0) ||
        (expiresAtIso ? new Date(expiresAtIso).getTime() : 0);

      if (!userId || !expiresAtMs) continue;

      const rawPayId = String(sub.approvedPaymentId || sub.paymentId || 'sub');
      const safePayId = rawPayId.replace(/[^a-zA-Z0-9_-]/g, '_');

      if (expiresAtMs <= nowMs) {
        const batch = db.batch();

        batch.update(subDoc.ref, {
          status: 'expired',
          premiumStatus: 'expired',
          expiredAt: nowIso,
          expiredNotifPaymentId: safePayId,
          updatedAt: nowIso,
        });

        batch.set(
          db.collection('users').doc(userId),
          {
            isPremium: false,
            goldVerified: false,
            subscriptionStatus: 'expired',
            premiumStatus: 'expired',
            updatedAt: nowIso,
          },
          { merge: true }
        );

        const logId = `log_exp_${userId.slice(0, 12)}_${safePayId.slice(0, 24)}`;
        batch.set(
          db.collection('paymentAuditLogs').doc(logId),
          {
            logId,
            action: 'SUBSCRIPTION_EXPIRED',
            paymentId: rawPayId,
            targetUserId: userId,
            targetUsername: username,
            actorUserId: OWNER_UID,
            actorEmail: OWNER_EMAIL,
            actorRole: 'owner',
            details: `Cloud Scheduler auto-expired ${packageLabel} subscription after ${expiresAtIso}`,
            createdAt: nowIso,
          },
          { merge: true }
        );

        if (sub.expiredNotifPaymentId !== safePayId) {
          const notifId = `notif_sub_expired_${safePayId}`;
          batch.set(
            db.collection('notifications').doc(notifId),
            {
              notificationId: notifId,
              recipientId: userId,
              actorId: OWNER_UID,
              actorUsername: 'owner',
              actorDisplayName: 'Ethio Chat Premium',
              type: 'subscription',
              text: `Your ${packageLabel} Premium subscription has expired and your Gold Verified Badge has been removed. Renew anytime in Settings > Subscription.`,
              read: false,
              createdAt: nowIso,
            },
            { merge: true }
          );
        }

        await batch.commit();
      } else {
        const remainingMs = expiresAtMs - nowMs;

        if (remainingMs <= DAY_MS && sub.reminder1dPaymentId !== safePayId) {
          const notifId = `notif_sub_1d_${safePayId}`;
          await db.collection('notifications').doc(notifId).set(
            {
              notificationId: notifId,
              recipientId: userId,
              actorId: OWNER_UID,
              actorUsername: 'owner',
              actorDisplayName: 'Ethio Chat Premium',
              type: 'subscription',
              text: `Reminder: Your ${packageLabel} Premium subscription expires in less than 1 day. Renew now to keep your Gold Verified Badge without interruption.`,
              read: false,
              createdAt: nowIso,
            },
            { merge: true }
          );
          await subDoc.ref.update({
            reminder1dPaymentId: safePayId,
            updatedAt: nowIso,
          });
        } else if (
          remainingMs > DAY_MS &&
          remainingMs <= 7 * DAY_MS &&
          sub.reminder7dPaymentId !== safePayId
        ) {
          const daysLeft = Math.ceil(remainingMs / DAY_MS);
          const notifId = `notif_sub_7d_${safePayId}`;
          await db.collection('notifications').doc(notifId).set(
            {
              notificationId: notifId,
              recipientId: userId,
              actorId: OWNER_UID,
              actorUsername: 'owner',
              actorDisplayName: 'Ethio Chat Premium',
              type: 'subscription',
              text: `Reminder: Your ${packageLabel} Premium subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Renew early to extend from your current expiry date.`,
              read: false,
              createdAt: nowIso,
            },
            { merge: true }
          );
          await subDoc.ref.update({
            reminder7dPaymentId: safePayId,
            updatedAt: nowIso,
          });
        }
      }
    }
  }
);
