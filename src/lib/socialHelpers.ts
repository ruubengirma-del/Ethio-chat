import { auth, db } from './firebase';
import {
  doc,
  setDoc,
  updateDoc,
  increment,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  runTransaction,
  serverTimestamp,
  limit,
} from 'firebase/firestore';
import { AppNotification, AudienceVisibility, NotificationType, Post, UserProfile } from '../types';

export const PINNED_ALL_USER_EMAILS = [
  'ruubengirma@gmail.com',
  'ruubewallaga@gmail.com',
  'ruubenajjo@gmail.com',
  'ruubeoro@gmail.com',
] as const;

export function getPinnedAllUserRank(email?: string | null): number {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return -1;
  return PINNED_ALL_USER_EMAILS.indexOf(
    normalized as (typeof PINNED_ALL_USER_EMAILS)[number]
  );
}

export function isPinnedAllUser(user?: Pick<UserProfile, 'email'> | null): boolean {
  return getPinnedAllUserRank(user?.email) !== -1;
}

export function sortUsersWithPinnedFirst(users: UserProfile[]): UserProfile[] {
  return [...users].sort((a, b) => {
    const rankA = getPinnedAllUserRank(a.email);
    const rankB = getPinnedAllUserRank(b.email);
    const isPinnedA = rankA !== -1;
    const isPinnedB = rankB !== -1;
    if (isPinnedA && isPinnedB) return rankA - rankB;
    if (isPinnedA) return -1;
    if (isPinnedB) return 1;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
}

export function toNotificationMillis(value: unknown): number {
  if (value == null) return Date.now();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value === 'string') {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value === 'object') {
    const ts = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof ts.toMillis === 'function') {
      const ms = ts.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof ts.seconds === 'number') {
      const ns = typeof ts.nanoseconds === 'number' ? ts.nanoseconds : 0;
      return ts.seconds * 1000 + Math.floor(ns / 1_000_000);
    }
  }
  return 0;
}

export function extractMentionUsernames(text: string): string[] {
  if (!text) return [];
  const regex = /@(\w+)/g;
  const seen = new Set<string>();
  const handles: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      handles.push(raw);
    }
  }
  return handles;
}

export function extractMentionedUsers(text: string, allUsers: UserProfile[]): UserProfile[] {
  const handles = extractMentionUsernames(text);
  if (handles.length === 0) return [];
  const lowerSet = new Set(handles.map((h) => h.toLowerCase()));
  return allUsers.filter((u) => lowerSet.has((u.username || '').toLowerCase()));
}

async function resolveUserByMentionUsername(
  rawHandle: string,
  knownUsers?: UserProfile[]
): Promise<{ userId: string; username: string; displayName?: string; photoURL?: string } | null> {
  const trimmed = rawHandle.trim();
  if (!trimmed) return null;

  const variants = Array.from(new Set([trimmed, trimmed.toLowerCase()]));
  for (const candidate of variants) {
    try {
      const snap = await getDocs(
        query(collection(db, 'users'), where('username', '==', candidate), limit(1))
      );
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        const data = docSnap.data() as Partial<UserProfile>;
        const userId = data.userId || docSnap.id;
        return {
          userId,
          username: data.username || candidate,
          displayName: data.displayName,
          photoURL: data.photoURL,
        };
      }
    } catch {
      // fall through to local knownUsers fallback
    }
  }

  if (knownUsers && knownUsers.length > 0) {
    const lower = trimmed.toLowerCase();
    const matched = knownUsers.find((u) => (u.username || '').toLowerCase() === lower);
    if (matched) {
      return {
        userId: matched.userId,
        username: matched.username,
        displayName: matched.displayName,
        photoURL: matched.photoURL,
      };
    }
  }

  return null;
}

async function triggerMentionPushNotification(payload: {
  toUserId: string;
  fromUsername: string;
  postId: string;
  commentId?: string;
  text: string;
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

export async function dispatchMentionNotifications(params: {
  text: string;
  postId: string;
  commentId?: string;
  actor: {
    userId: string;
    username: string;
    displayName: string;
    photoURL?: string;
  };
  knownUsers?: UserProfile[];
  onlyHandles?: string[];
}): Promise<string[]> {
  const handles =
    params.onlyHandles && params.onlyHandles.length > 0
      ? params.onlyHandles
      : extractMentionUsernames(params.text);
  if (handles.length === 0 || !params.postId || !params.actor?.userId) return [];

  const resolvedTargets = await Promise.all(
    handles.map((handle) => resolveUserByMentionUsername(handle, params.knownUsers))
  );

  const uniqueRecipientIds = new Set<string>();
  const notificationsToCreate: Array<{
    notificationId: string;
    toUserId: string;
    docData: AppNotification;
  }> = [];

  for (const target of resolvedTargets) {
    if (!target || !target.userId) continue;
    // Skip self-mention
    if (target.userId === params.actor.userId) continue;
    if (uniqueRecipientIds.has(target.userId)) continue;
    uniqueRecipientIds.add(target.userId);

    const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const mentionText = `@${params.actor.username} mentioned you`;
    const docData: AppNotification = {
      notificationId,
      recipientId: target.userId,
      toUserId: target.userId,
      actorId: params.actor.userId,
      fromUserId: params.actor.userId,
      actorUsername: params.actor.username,
      fromUsername: params.actor.username,
      actorDisplayName: params.actor.displayName,
      ...(params.actor.photoURL ? { actorPhotoURL: params.actor.photoURL } : {}),
      type: 'mention',
      postId: params.postId,
      ...(params.commentId ? { commentId: params.commentId } : {}),
      text: mentionText,
      read: false,
      createdAt: serverTimestamp() as unknown as AppNotification['createdAt'],
    };

    notificationsToCreate.push({ notificationId, toUserId: target.userId, docData });
  }

  await Promise.all(
    notificationsToCreate.map(async ({ notificationId, toUserId, docData }) => {
      await setDoc(doc(db, 'notifications', notificationId), docData).catch(() => {});
      void triggerMentionPushNotification({
        toUserId,
        fromUsername: params.actor.username,
        postId: params.postId,
        ...(params.commentId ? { commentId: params.commentId } : {}),
        text: docData.text || `@${params.actor.username} mentioned you`,
      });
    })
  );

  return Array.from(uniqueRecipientIds);
}

export async function createAppNotification(params: {
  recipientId: string;
  actor: {
    userId: string;
    username: string;
    displayName: string;
    photoURL?: string;
  };
  type: NotificationType;
  postId?: string;
  commentId?: string;
  chatId?: string;
  text?: string;
}): Promise<void> {
  if (!params.recipientId || params.recipientId === params.actor.userId) return;

  const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const payload: AppNotification = {
    notificationId,
    recipientId: params.recipientId,
    toUserId: params.recipientId,
    actorId: params.actor.userId,
    fromUserId: params.actor.userId,
    actorUsername: params.actor.username,
    fromUsername: params.actor.username,
    actorDisplayName: params.actor.displayName,
    ...(params.actor.photoURL ? { actorPhotoURL: params.actor.photoURL } : {}),
    type: params.type,
    ...(params.postId ? { postId: params.postId } : {}),
    ...(params.commentId ? { commentId: params.commentId } : {}),
    ...(params.chatId ? { chatId: params.chatId } : {}),
    ...(params.text ? { text: params.text.slice(0, 300) } : {}),
    read: false,
    createdAt: new Date().toISOString(),
  };

  await setDoc(doc(db, 'notifications', notificationId), payload).catch(() => {});
}

const recordedSessionViews = new Set<string>();
const inFlightViews = new Map<string, Promise<void>>();
const LOCAL_VIEWS_STORAGE_KEY = 'ethio_unique_views_v1';

function buildUniqueViewStatId(
  kind: 'profile' | 'post' | 'story',
  targetId: string,
  viewerId: string
): string {
  const safeKind = kind.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeTarget = targetId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeViewer = viewerId.replace(/[^a-zA-Z0-9_-]/g, '');
  const candidate = `uv_${safeKind}_${safeTarget}_${safeViewer}`;
  if (candidate.length > 0 && candidate.length <= 120) return candidate;

  let h1 = 2166136261;
  let h2 = 0x811c9dc5;
  const raw = `${kind}:${targetId}:${viewerId}`;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 16777619);
    h2 = (Math.imul(h2, 31) + ch) | 0;
  }
  return `uv_${safeKind}_${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}`;
}

function hasLocalRecordedView(dedupeKey: string): boolean {
  try {
    const raw = localStorage.getItem(LOCAL_VIEWS_STORAGE_KEY);
    if (!raw) return false;
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.includes(dedupeKey);
  } catch {
    return false;
  }
}

function markLocalRecordedView(dedupeKey: string): void {
  try {
    const raw = localStorage.getItem(LOCAL_VIEWS_STORAGE_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) {
      localStorage.setItem(LOCAL_VIEWS_STORAGE_KEY, JSON.stringify([dedupeKey]));
      return;
    }
    if (!list.includes(dedupeKey)) {
      list.push(dedupeKey);
      const trimmed = list.length > 2500 ? list.slice(list.length - 2500) : list;
      localStorage.setItem(LOCAL_VIEWS_STORAGE_KEY, JSON.stringify(trimmed));
    }
  } catch {
    // ignore storage quota errors
  }
}

export async function recordViewStat(params: {
  targetUserId: string;
  viewerId: string;
  kind: 'profile' | 'post' | 'story';
  targetId: string;
}): Promise<void> {
  if (!params.targetUserId || !params.viewerId || !params.targetId) return;

  const dedupeKey = `${params.kind}:${params.targetId}:${params.viewerId}`;
  if (recordedSessionViews.has(dedupeKey) || hasLocalRecordedView(dedupeKey)) {
    recordedSessionViews.add(dedupeKey);
    return;
  }

  const existingPromise = inFlightViews.get(dedupeKey);
  if (existingPromise) {
    return existingPromise;
  }

  const runPromise = (async () => {
    try {
      const statId = buildUniqueViewStatId(params.kind, params.targetId, params.viewerId);
      const statRef = doc(db, 'viewStats', statId);

      // 1. Fast check on deterministic per-account view doc
      const directSnap = await getDoc(statRef).catch(() => null);
      if (directSnap && directSnap.exists()) {
        recordedSessionViews.add(dedupeKey);
        markLocalRecordedView(dedupeKey);
        return;
      }

      // 2. Check existing viewStats for this targetId to detect legacy duplicate docs or reconcile counts
      const existingSnap = await getDocs(
        query(collection(db, 'viewStats'), where('targetId', '==', params.targetId))
      ).catch(() => null);

      const uniqueViewerIds = new Set<string>();
      let totalEventsForKind = 0;

      if (existingSnap) {
        existingSnap.forEach((d) => {
          const data = d.data() as { kind?: string; viewerId?: string };
          if (data.kind === params.kind && data.viewerId) {
            totalEventsForKind++;
            uniqueViewerIds.add(data.viewerId);
          }
        });
      }

      if (uniqueViewerIds.has(params.viewerId)) {
        // Viewer already counted previously under a legacy stat doc — never increment again
        if ((params.kind === 'post' || params.kind === 'story') && totalEventsForKind > uniqueViewerIds.size) {
          const colName = params.kind === 'post' ? 'posts' : 'stories';
          await updateDoc(doc(db, colName, params.targetId), {
            viewsCount: uniqueViewerIds.size,
          }).catch(() => {});
        }
        recordedSessionViews.add(dedupeKey);
        markLocalRecordedView(dedupeKey);
        return;
      }

      // 3. Atomic transaction ensures strictly 1 stat doc & 1 increment per unique account
      const createdNow = await runTransaction(db, async (tx) => {
        const snap = await tx.get(statRef);
        if (snap.exists()) return false;
        tx.set(statRef, {
          statId,
          targetUserId: params.targetUserId,
          viewerId: params.viewerId,
          kind: params.kind,
          targetId: params.targetId,
          createdAt: new Date().toISOString(),
        });
        return true;
      }).catch(() => false);

      recordedSessionViews.add(dedupeKey);
      markLocalRecordedView(dedupeKey);

      if (!createdNow) return;

      const hadLegacyDuplicates = totalEventsForKind > uniqueViewerIds.size;
      const nextUniqueTotal = uniqueViewerIds.size + 1;

      if (params.kind === 'profile') {
        await updateDoc(doc(db, 'users', params.targetUserId), {
          profileViewsCount: increment(1),
        }).catch(() => {});
      } else if (params.kind === 'post') {
        await updateDoc(doc(db, 'posts', params.targetId), {
          viewsCount: hadLegacyDuplicates ? nextUniqueTotal : increment(1),
        }).catch(() => {});
      } else if (params.kind === 'story') {
        await updateDoc(doc(db, 'stories', params.targetId), {
          viewsCount: hadLegacyDuplicates ? nextUniqueTotal : increment(1),
        }).catch(() => {});
      }
    } finally {
      inFlightViews.delete(dedupeKey);
    }
  })();

  inFlightViews.set(dedupeKey, runPromise);
  return runPromise;
}

export function isAudienceVisibleToUser(
  item: {
    authorId: string;
    visibility?: AudienceVisibility;
    excludedUserIds?: string[];
    allowedUserIds?: string[];
  },
  viewerId?: string | null
): boolean {
  if (!viewerId) {
    return !item.visibility || item.visibility === 'public';
  }
  if (item.authorId === viewerId) return true;

  const vis = item.visibility || 'public';
  if (vis === 'public') return true;
  if (vis === 'private') return false;
  if (vis === 'close_friends') {
    // Hidden from selected Close Friends list
    return !(item.excludedUserIds || []).includes(viewerId);
  }
  if (vis === 'select_friends') {
    // Visible ONLY to selected friends
    return (item.allowedUserIds || []).includes(viewerId);
  }
  return true;
}

export function getOrCreateDeviceId(): string {
  const KEY = 'ethio_chat_device_id_v1';
  const COOKIE_KEY = 'ethio_dev_id=';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    if (typeof document !== 'undefined') {
      const hit = document.cookie
        .split(';')
        .map((p) => p.trim())
        .find((p) => p.startsWith(COOKIE_KEY));
      if (hit) {
        const cookieVal = decodeURIComponent(hit.slice(COOKIE_KEY.length));
        if (cookieVal && /^[a-zA-Z0-9_-]{4,128}$/.test(cookieVal)) {
          localStorage.setItem(KEY, cookieVal);
          return cookieVal;
        }
      }
    }
    const created = `dev_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    localStorage.setItem(KEY, created);
    if (typeof document !== 'undefined') {
      document.cookie = `${COOKIE_KEY}${encodeURIComponent(created)}; path=/; max-age=${60 * 60 * 24 * 365 * 5}; SameSite=Lax`;
    }
    return created;
  } catch {
    return `dev_${Date.now().toString(36)}`;
  }
}

export function getClientDeviceDetails(): { deviceName: string; platform: string; browser: string } {
  if (typeof navigator === 'undefined') {
    return { deviceName: 'Web Browser', platform: 'Web', browser: 'Unknown' };
  }
  const ua = navigator.userAgent || '';
  let platform = 'Desktop';
  if (/Android/i.test(ua)) platform = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) platform = 'iOS';
  else if (/Windows/i.test(ua)) platform = 'Windows';
  else if (/Mac/i.test(ua)) platform = 'macOS';
  else if (/Linux/i.test(ua)) platform = 'Linux';

  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';

  return {
    deviceName: `${platform} (${browser})`,
    platform,
    browser,
  };
}

export function isUserOnlineNow(user?: Pick<UserProfile, 'hideOnlineStatus' | 'lastSeenAt'> | null): boolean {
  if (!user || user.hideOnlineStatus) return false;
  if (!user.lastSeenAt) return true;
  const diffMs = Date.now() - new Date(user.lastSeenAt).getTime();
  return diffMs >= 0 && diffMs < 3 * 60 * 1000;
}

export function formatLastSeen(isoString?: string): string {
  if (!isoString) return 'Last seen recently';
  try {
    const date = new Date(isoString);
    const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diffSec < 120) return 'Online now';
    if (diffSec < 3600) return `Last seen ${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) {
      return `Last seen today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return `Last seen ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return 'Last seen recently';
  }
}

export interface ChatWallpaperOption {
  id: string;
  label: string;
  className: string;
  previewBg: string;
}

export const CHAT_WALLPAPERS: ChatWallpaperOption[] = [
  {
    id: 'default',
    label: 'Classic Clean',
    className: 'bg-slate-50/40 dark:bg-[#0f0d1a]',
    previewBg: 'linear-gradient(135deg, #f8fafc 0%, #ede9fe 100%)',
  },
  {
    id: 'violet_mist',
    label: 'Rub Violet Mist',
    className: 'bg-gradient-to-br from-[#f3efff] via-[#faf8ff] to-[#e9e2ff] dark:from-[#171230] dark:via-[#110d24] dark:to-[#221947]',
    previewBg: 'linear-gradient(135deg, #7560DF 0%, #B8AAFA 100%)',
  },
  {
    id: 'ethio_sunrise',
    label: 'Ethiopian Sunrise',
    className: 'bg-gradient-to-br from-emerald-50 via-amber-50/70 to-rose-50 dark:from-[#0e2218] dark:via-[#1e1a0e] dark:to-[#271118]',
    previewBg: 'linear-gradient(135deg, #10b981 0%, #f59e0b 50%, #f43f5e 100%)',
  },
  {
    id: 'ocean_breeze',
    label: 'Blue Nile',
    className: 'bg-gradient-to-br from-sky-50 via-cyan-50 to-indigo-50 dark:from-[#0c1c2e] dark:via-[#0f172a] dark:to-[#18163b]',
    previewBg: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
  },
  {
    id: 'midnight_stars',
    label: 'Midnight Slate',
    className: 'bg-gradient-to-b from-slate-200/80 to-slate-100 dark:from-[#090714] dark:to-[#191433]',
    previewBg: 'linear-gradient(135deg, #1e293b 0%, #090714 100%)',
  },
  {
    id: 'soft_rose',
    label: 'Blossom Rose',
    className: 'bg-gradient-to-br from-rose-50 via-pink-50 to-purple-50 dark:from-[#26111e] dark:via-[#1a1026] dark:to-[#130f24]',
    previewBg: 'linear-gradient(135deg, #fb7185 0%, #c084fc 100%)',
  },
];

export const REACTION_EMOJIS_8 = [
  { emoji: '😂', label: 'Joy' },
  { emoji: '❤️', label: 'Love' },
  { emoji: '😢', label: 'Sad' },
  { emoji: '🙏', label: 'Thanks' },
  { emoji: '😮', label: 'Wow' },
  { emoji: '🔥', label: 'Fire' },
  { emoji: '👏', label: 'Clap' },
  { emoji: '🎉', label: 'Celebrate' },
];

export interface FontStyleOption {
  id: string;
  name: string;
  tagline: string;
  stack: string;
}

export const FONT_STYLES: FontStyleOption[] = [
  {
    id: 'plus_jakarta',
    name: 'Plus Jakarta Sans',
    tagline: 'Modern & Crisp (Default)',
    stack: "'Plus Jakarta Sans', 'Inter', 'Noto Sans Ethiopic', system-ui, sans-serif",
  },
  {
    id: 'poppins',
    name: 'Poppins',
    tagline: 'Geometric & Smooth',
    stack: "'Poppins', 'Noto Sans Ethiopic', system-ui, sans-serif",
  },
  {
    id: 'montserrat',
    name: 'Montserrat',
    tagline: 'Bold Contemporary',
    stack: "'Montserrat', 'Noto Sans Ethiopic', system-ui, sans-serif",
  },
  {
    id: 'playfair',
    name: 'Playfair Display',
    tagline: 'Classic Editorial Serif',
    stack: "'Playfair Display', 'Noto Sans Ethiopic', Georgia, serif",
  },
  {
    id: 'lora',
    name: 'Lora',
    tagline: 'Warm Elegant Serif',
    stack: "'Lora', 'Noto Sans Ethiopic', Georgia, serif",
  },
  {
    id: 'nunito',
    name: 'Nunito',
    tagline: 'Friendly Rounded Sans',
    stack: "'Nunito', 'Noto Sans Ethiopic', system-ui, sans-serif",
  },
  {
    id: 'raleway',
    name: 'Raleway',
    tagline: 'Stylish Sleek Lines',
    stack: "'Raleway', 'Noto Sans Ethiopic', system-ui, sans-serif",
  },
  {
    id: 'merriweather',
    name: 'Merriweather',
    tagline: 'Rich Book Serif',
    stack: "'Merriweather', 'Noto Sans Ethiopic', Georgia, serif",
  },
  {
    id: 'quicksand',
    name: 'Quicksand',
    tagline: 'Soft & Airy Rounded',
    stack: "'Quicksand', 'Noto Sans Ethiopic', system-ui, sans-serif",
  },
  {
    id: 'space_grotesk',
    name: 'Space Grotesk',
    tagline: 'Futuristic Tech Display',
    stack: "'Space Grotesk', 'Noto Sans Ethiopic', system-ui, sans-serif",
  },
];

export function getFontStack(fontId?: string): string {
  const found = FONT_STYLES.find((f) => f.id === fontId);
  return found ? found.stack : FONT_STYLES[0].stack;
}

function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuffer(str: string): ArrayBuffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function isPlatformBiometricAvailable(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function registerBiometricCredential(
  userId: string,
  username: string
): Promise<{ credentialId: string; nativeWebAuthn: boolean }> {
  try {
    if (typeof window !== 'undefined' && window.PublicKeyCredential && navigator.credentials?.create) {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const userBytes = new TextEncoder().encode(userId);
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Ethio Chat' },
          user: {
            id: userBytes,
            name: username,
            displayName: username,
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
          },
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;

      if (cred?.rawId) {
        return { credentialId: bufferToBase64Url(cred.rawId), nativeWebAuthn: true };
      }
    }
  } catch (err) {
    console.warn('WebAuthn biometric registration fallback notice:', err);
  }
  return { credentialId: `bio_${userId}`, nativeWebAuthn: false };
}

export async function verifyBiometricCredential(
  credentialId?: string
): Promise<{ verified: boolean; nativeWebAuthn: boolean; error?: string }> {
  if (!credentialId || credentialId.startsWith('bio_')) {
    return { verified: true, nativeWebAuthn: false };
  }
  try {
    if (typeof window !== 'undefined' && window.PublicKeyCredential && navigator.credentials?.get) {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [
            {
              id: base64UrlToBuffer(credentialId),
              type: 'public-key',
              transports: ['internal'],
            },
          ],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      if (assertion) {
        return { verified: true, nativeWebAuthn: true };
      }
    }
  } catch (err: any) {
    return {
      verified: false,
      nativeWebAuthn: true,
      error: err?.name === 'NotAllowedError' ? 'Fingerprint scan cancelled or not recognized.' : err?.message,
    };
  }
  return { verified: false, nativeWebAuthn: false, error: 'Fingerprint sensor unavailable.' };
}

export function emailToRegistryId(email: string): string {
  const norm = email.trim().toLowerCase();
  const bytes = new TextEncoder().encode(norm);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  const safe = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `em_${safe.slice(0, 120)}`;
}

export function normalizeSearchText(input: string): string {
  return (input || '')
    .toLowerCase()
    .trim()
    .replace(/^@+/, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function diceBigrams(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const mapA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    mapA.set(bg, (mapA.get(bg) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = mapA.get(bg) || 0;
    if (count > 0) {
      hits++;
      mapA.set(bg, count - 1);
    }
  }
  return (2 * hits) / (a.length - 1 + (b.length - 1));
}

function isOrderedSubsequence(needle: string, haystack: string): boolean {
  if (!needle || needle.length > haystack.length) return false;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (needle[i] === haystack[j]) i++;
  }
  return i === needle.length;
}

export function computeStringSimilarity(queryRaw: string, targetRaw: string): number {
  const q = normalizeSearchText(queryRaw);
  const t = normalizeSearchText(targetRaw);
  if (!q || !t) return 0;
  if (t === q) return 1;
  if (t.includes(q)) return 0.92;

  const qCompact = q.replace(/\s+/g, '');
  const tCompact = t.replace(/\s+/g, '');
  if (tCompact.includes(qCompact)) return 0.9;

  let best = 0;
  const qWords = q.split(' ').filter(Boolean);
  const tWords = t.split(' ').filter(Boolean);

  for (const qw of qWords) {
    if (qw.length < 2) continue;
    for (const tw of tWords) {
      if (tw.startsWith(qw)) {
        best = Math.max(best, 0.86);
        continue;
      }
      if (tw.includes(qw)) {
        best = Math.max(best, 0.82);
        continue;
      }
      // Compare against full target word and prefix slice of target word
      const sliced = tw.slice(0, Math.min(tw.length, qw.length + 2));
      const maxLen = Math.max(qw.length, tw.length);
      const levFull = maxLen > 0 ? 1 - levenshteinDistance(qw, tw) / maxLen : 0;
      const maxSliceLen = Math.max(qw.length, sliced.length);
      const levSlice = maxSliceLen > 0 ? 1 - levenshteinDistance(qw, sliced) / maxSliceLen : 0;
      const dice = diceBigrams(qw, tw);
      const subseq = qw.length >= 3 && isOrderedSubsequence(qw, tw) ? 0.58 : 0;
      best = Math.max(best, levFull, levSlice * 0.95, dice * 0.92, subseq);
    }
  }

  // Also compare compact whole strings
  const maxC = Math.max(qCompact.length, tCompact.length);
  if (maxC > 0 && Math.abs(qCompact.length - tCompact.length) <= Math.max(4, qCompact.length)) {
    const levCompact = 1 - levenshteinDistance(qCompact, tCompact) / maxC;
    best = Math.max(best, levCompact);
  }
  if (qCompact.length >= 2 && tCompact.length >= 2) {
    best = Math.max(best, diceBigrams(qCompact, tCompact) * 0.9);
  }

  return best;
}

export function searchUsersWithFallback(
  queryText: string,
  users: UserProfile[]
): { exactMatches: UserProfile[]; similarMatches: UserProfile[] } {
  const clean = normalizeSearchText(queryText);
  const compact = clean.replace(/\s+/g, '');
  if (!clean) {
    return { exactMatches: users, similarMatches: [] };
  }

  const exactMatches = users.filter((u) => {
    const uname = normalizeSearchText(u.username);
    const dname = normalizeSearchText(u.displayName);
    const bio = normalizeSearchText(u.bio || '');
    return (
      uname.includes(clean) ||
      uname.replace(/\s+/g, '').includes(compact) ||
      dname.includes(clean) ||
      dname.replace(/\s+/g, '').includes(compact) ||
      bio.includes(clean)
    );
  });

  if (exactMatches.length > 0) {
    exactMatches.sort((a, b) => {
      const aStarts =
        normalizeSearchText(a.username).startsWith(clean) ||
        normalizeSearchText(a.displayName).startsWith(clean)
          ? 1
          : 0;
      const bStarts =
        normalizeSearchText(b.username).startsWith(clean) ||
        normalizeSearchText(b.displayName).startsWith(clean)
          ? 1
          : 0;
      return bStarts - aStarts;
    });
    return { exactMatches, similarMatches: [] };
  }

  const scored = users
    .map((u) => {
      const score = Math.max(
        computeStringSimilarity(clean, u.username),
        computeStringSimilarity(clean, u.displayName),
        computeStringSimilarity(clean, u.bio || '') * 0.85
      );
      return { user: u, score };
    })
    .filter((entry) => entry.score >= 0.42)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map((entry) => entry.user);

  return { exactMatches: [], similarMatches: scored };
}

export function searchPostsWithFallback(
  queryText: string,
  posts: Post[]
): { exactMatches: Post[]; similarMatches: Post[] } {
  const clean = normalizeSearchText(queryText);
  const compact = clean.replace(/\s+/g, '');
  if (!clean) {
    return { exactMatches: [], similarMatches: [] };
  }

  const qWords = clean.split(' ').filter(Boolean);
  const exactMatches = posts.filter((p) => {
    const content = normalizeSearchText(p.content || '');
    const authorName = normalizeSearchText(p.authorDisplayName || '');
    const authorHandle = normalizeSearchText(p.authorUsername || '');
    const combined = `${content} ${authorName} ${authorHandle}`;
    if (
      content.includes(clean) ||
      authorName.includes(clean) ||
      authorHandle.includes(clean) ||
      authorHandle.replace(/\s+/g, '').includes(compact)
    ) {
      return true;
    }
    return qWords.length > 1 && qWords.every((w) => combined.includes(w));
  });

  if (exactMatches.length > 0) {
    return { exactMatches, similarMatches: [] };
  }

  const scored = posts
    .map((p) => {
      const score = Math.max(
        computeStringSimilarity(clean, p.content || ''),
        computeStringSimilarity(clean, p.authorDisplayName || ''),
        computeStringSimilarity(clean, p.authorUsername || '')
      );
      return { post: p, score };
    })
    .filter((entry) => entry.score >= 0.42)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map((entry) => entry.post);

  return { exactMatches: [], similarMatches: scored };
}

export const ADMIN_MODERATION_EMAIL = 'Ruubengirma@gmail.com';

export const REPORT_REASONS = [
  'Violates app rules',
  'Content violates laws or community standards',
  'Scammer or fraudulent behavior',
  'Fake account or impersonating someone else',
  'Harms or exploits children under 17',
] as const;

export function getCurrentMonthKey(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export async function saveMediaToDevice(
  url: string,
  filename: string,
  mimeType?: string
): Promise<'shared' | 'downloaded'> {
  try {
    // For large server-streamed videos, stream directly via native download if larger than 45 MB or non-shareable
    if (url.startsWith('/api/media/stream/')) {
      try {
        const headResp = await fetch(url, { method: 'HEAD' });
        const lenHeader = headResp.headers.get('content-length');
        const sizeBytes = lenHeader ? Number(lenHeader) : 0;
        if (sizeBytes > 45 * 1024 * 1024) {
          const dlLink = document.createElement('a');
          dlLink.href = `${url}?download=1`;
          dlLink.download = filename;
          document.body.appendChild(dlLink);
          dlLink.click();
          document.body.removeChild(dlLink);
          return 'downloaded';
        }
      } catch {
        // fallback to normal fetch below
      }
    }

    const response = await fetch(url);
    const blob = await response.blob();
    const resolvedType = mimeType || blob.type || 'application/octet-stream';
    const file = new File([blob], filename, { type: resolvedType });

    const isTouchDevice =
      typeof navigator !== 'undefined' &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

    if (
      isTouchDevice &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({
          files: [file],
          title: filename,
        });
        return 'shared';
      } catch (shareErr: any) {
        if (shareErr?.name === 'AbortError') {
          return 'shared';
        }
      }
    }

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 6000);
    return 'downloaded';
  } catch {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return 'downloaded';
  }
}

export function saveTextToDevice(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 6000);
}



