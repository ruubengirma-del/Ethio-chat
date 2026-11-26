import { getApp } from 'firebase/app';
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  MessagePayload,
} from 'firebase/messaging';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

export interface ForegroundPushEventDetail {
  title: string;
  body: string;
  postId?: string;
  commentId?: string;
  chatId?: string;
  callId?: string;
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

/**
 * Displays a real OS/system notification outside the app (via ServiceWorkerRegistration on Android/TWA/PWA,
 * with a fallback to window.Notification on desktop browsers).
 */
export async function showSystemNotification(opts: {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  requireInteraction?: boolean;
  vibrate?: number[];
  data?: Record<string, string>;
}): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;

    const notificationOptions: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
      body: opts.body,
      icon: '/assets/aistudio/20261111_152710_57efcc53.png',
      badge: '/assets/aistudio/20261111_152710_57efcc53.png',
      tag: opts.tag || `ethio_${Date.now()}`,
      requireInteraction: Boolean(opts.requireInteraction),
      ...(opts.vibrate ? { vibrate: opts.vibrate } : {}),
      ...(opts.tag ? { renotify: true } : {}),
      data: {
        url: opts.url || '/',
        ...(opts.data || {}),
      },
    };

    if ('serviceWorker' in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 900)),
      ]);
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(opts.title, notificationOptions);
        return true;
      }
    }

    const nativeNotif = new Notification(opts.title, notificationOptions);
    nativeNotif.onclick = () => {
      try {
        window.focus();
      } catch {}
      const targetUrl = opts.url || '/';
      if (targetUrl && targetUrl !== '/') {
        window.dispatchEvent(
          new CustomEvent('ethio-open-notification-url', { detail: { url: targetUrl, ...(opts.data || {}) } })
        );
      }
      nativeNotif.close();
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort server push dispatch for incoming calls, messages, and comments when the recipient is closed/offline.
 */
export async function dispatchPushNotification(payload: {
  type: 'call' | 'message' | 'comment' | 'mention';
  toUserId: string;
  fromUsername: string;
  title?: string;
  text: string;
  postId?: string;
  commentId?: string;
  chatId?: string;
  callId?: string;
}): Promise<void> {
  try {
    const idToken = await auth.currentUser?.getIdToken().catch(() => null);
    if (!idToken) return;
    await fetch('/api/notifications/send-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    // non-fatal push dispatch
  }
}

export async function registerAndSyncPushToken(
  userId: string,
  opts?: { requestPermission?: boolean }
): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;

    let permission = Notification.permission;
    if (permission === 'default' && opts?.requestPermission) {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return false;

    const supported = await isPushEnvironmentSupported();
    if (!supported) return true;

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
        const chatId = payload.data?.chatId ? String(payload.data.chatId) : undefined;
        const callId = payload.data?.callId ? String(payload.data.callId) : undefined;
        const title = payload.notification?.title || payload.data?.title || 'Ethio Chat';
        const body =
          payload.notification?.body ||
          payload.data?.body ||
          (payload.data?.fromUsername
            ? `@${payload.data.fromUsername} mentioned you`
            : 'New notification');

        if (typeof document !== 'undefined' && (document.hidden || !document.hasFocus())) {
          void showSystemNotification({
            title,
            body,
            url: payload.data?.url || '/',
            requireInteraction: payload.data?.type === 'call',
            data: {
              ...(postId ? { postId } : {}),
              ...(commentId ? { commentId } : {}),
              ...(chatId ? { chatId } : {}),
              ...(callId ? { callId } : {}),
            },
          });
        }

        window.dispatchEvent(
          new CustomEvent<ForegroundPushEventDetail>('ethio-foreground-push', {
            detail: { title, body, postId, commentId, chatId, callId },
          })
        );
      });
    }

    return Boolean(token) || permission === 'granted';
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
