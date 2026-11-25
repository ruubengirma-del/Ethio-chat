import { getApp } from 'firebase/app';
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  MessagePayload,
} from 'firebase/messaging';
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export interface ForegroundPushEventDetail {
  title: string;
  body: string;
  postId?: string;
  commentId?: string;
}

function hashTokenId(token: string): string {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fcm_${(h >>> 0).toString(36)}`;
}

let activeForegroundUnsub: (() => void) | null = null;

async function saveFcmTokenForUser(userId: string, token: string): Promise<void> {
  if (!userId || !token) return;
  const tokenId = hashTokenId(token);
  const now = new Date().toISOString();
  await setDoc(
    doc(db, 'users', userId, 'fcmTokens', tokenId),
    {
      tokenId,
      userId,
      token,
      platform: typeof navigator !== 'undefined' ? (navigator.userAgent || 'web').slice(0, 75) : 'web',
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  ).catch(() => {});
}

export async function isPushEnvironmentSupported(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
      return false;
    }
    return await isSupported();
  } catch {
    return false;
  }
}

export async function registerAndSyncPushToken(
  userId: string,
  opts?: { requestPermission?: boolean }
): Promise<boolean> {
  try {
    const supported = await isPushEnvironmentSupported();
    if (!supported) return false;

    let permission = Notification.permission;
    if (permission === 'default' && opts?.requestPermission) {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return false;

    const app = getApp();
    const messaging = getMessaging(app);
    const swReg = await navigator.serviceWorker
      .register('/firebase-messaging-sw.js', {
        scope: '/firebase-cloud-messaging-push-scope',
      })
      .catch(() => undefined);

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
    const token = await getToken(messaging, {
      ...(vapidKey ? { vapidKey } : {}),
      ...(swReg ? { serviceWorkerRegistration: swReg } : {}),
    }).catch(() => null);

    if (token) {
      await saveFcmTokenForUser(userId, token);
    }

    if (!activeForegroundUnsub) {
      activeForegroundUnsub = onMessage(messaging, (payload: MessagePayload) => {
        const postId = payload.data?.postId ? String(payload.data.postId) : undefined;
        const commentId = payload.data?.commentId ? String(payload.data.commentId) : undefined;
        const title = payload.notification?.title || 'Ethio Chat';
        const body =
          payload.notification?.body ||
          payload.data?.body ||
          (payload.data?.fromUsername
            ? `@${payload.data.fromUsername} si @mention godhe`
            : 'New mention notification');

        window.dispatchEvent(
          new CustomEvent<ForegroundPushEventDetail>('ethio-foreground-push', {
            detail: { title, body, postId, commentId },
          })
        );
      });
    }

    return Boolean(token);
  } catch {
    return false;
  }
}

export function cleanupPushListeners(): void {
  if (activeForegroundUnsub) {
    try {
      activeForegroundUnsub();
    } catch {
      // ignore
    }
    activeForegroundUnsub = null;
  }
}
