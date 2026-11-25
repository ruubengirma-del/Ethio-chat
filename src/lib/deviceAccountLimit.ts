import { db } from './firebase';
import { doc, getDoc, getDocFromServer, setDoc } from 'firebase/firestore';

export const MAX_ACCOUNTS_PER_DEVICE = 5;

const DEVICE_ID_STORAGE_KEY = 'ethio_chat_device_id_v1';
const CREATED_UIDS_STORAGE_KEY = 'ethio_device_created_uids_v1';
const DEVICE_COOKIE_NAME = 'ethio_dev_id';
const CREATED_UIDS_COOKIE_NAME = 'ethio_dev_uids';
const IDB_NAME = 'ethio_chat_device_guard_v1';
const IDB_STORE = 'device_guard';

function readCookie(name: string): string | null {
  try {
    if (typeof document === 'undefined') return null;
    const prefix = `${encodeURIComponent(name)}=`;
    const parts = document.cookie.split(';');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        return decodeURIComponent(trimmed.slice(prefix.length));
      }
    }
    return null;
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string): void {
  try {
    if (typeof document === 'undefined') return;
    const maxAge = 60 * 60 * 24 * 365 * 5; // 5 years
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  } catch {
    // ignore cookie failures
  }
}

function openGuardDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(IDB_STORE)) {
          database.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const database = await openGuardDb();
  if (!database) return null;
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => database.close();
    } catch {
      database.close();
      resolve(null);
    }
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const database = await openGuardDb();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = database.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(value, key);
      tx.oncomplete = () => {
        database.close();
        resolve();
      };
      tx.onerror = () => {
        database.close();
        resolve();
      };
    } catch {
      database.close();
      resolve();
    }
  });
}

function sanitizeUidList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim().length > 0 && !seen.has(item.trim())) {
      seen.add(item.trim());
      out.push(item.trim());
    }
  }
  return out;
}

export async function getPersistentDeviceId(): Promise<string> {
  let lsId: string | null = null;
  try {
    lsId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  } catch {}
  const cookieId = readCookie(DEVICE_COOKIE_NAME);
  const idbId = await idbGet<string>(DEVICE_ID_STORAGE_KEY);

  const existing = lsId || idbId || cookieId;
  if (existing && /^[a-zA-Z0-9_-]{4,128}$/.test(existing)) {
    try {
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, existing);
    } catch {}
    writeCookie(DEVICE_COOKIE_NAME, existing);
    if (!idbId) {
      await idbSet(DEVICE_ID_STORAGE_KEY, existing);
    }
    return existing;
  }

  const created = `dev_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  try {
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
  } catch {}
  writeCookie(DEVICE_COOKIE_NAME, created);
  await idbSet(DEVICE_ID_STORAGE_KEY, created);
  return created;
}

async function readLocalCreatedUids(deviceId: string): Promise<string[]> {
  let lsList: string[] = [];
  try {
    const raw = localStorage.getItem(CREATED_UIDS_STORAGE_KEY);
    if (raw) lsList = sanitizeUidList(JSON.parse(raw));
  } catch {}

  let cookieList: string[] = [];
  try {
    const rawCookie = readCookie(CREATED_UIDS_COOKIE_NAME);
    if (rawCookie) cookieList = sanitizeUidList(JSON.parse(rawCookie));
  } catch {}

  const idbList = sanitizeUidList(await idbGet<string[]>(`uids_${deviceId}`));
  return sanitizeUidList([...lsList, ...cookieList, ...idbList]);
}

async function persistLocalCreatedUids(deviceId: string, uids: string[]): Promise<void> {
  const clean = sanitizeUidList(uids);
  try {
    localStorage.setItem(CREATED_UIDS_STORAGE_KEY, JSON.stringify(clean));
  } catch {}
  try {
    writeCookie(CREATED_UIDS_COOKIE_NAME, JSON.stringify(clean));
  } catch {}
  await idbSet(`uids_${deviceId}`, clean);
}

export async function assertDeviceCanCreateAccount(options: {
  bypassForOwnerOrAdmin: boolean;
}): Promise<{ deviceId: string; existingUids: string[] }> {
  const deviceId = await getPersistentDeviceId();
  const localUids = await readLocalCreatedUids(deviceId);

  let remoteUids: string[] = [];
  try {
    const lockRef = doc(db, 'deviceAccountLocks', deviceId);
    const snap = await getDocFromServer(lockRef).catch(() => getDoc(lockRef));
    if (snap && snap.exists()) {
      const data = snap.data() as { accountUids?: unknown };
      remoteUids = sanitizeUidList(data?.accountUids);
    }
  } catch {
    // offline or rules fallback — local persistent registry still guards cleanly
  }

  const combined = sanitizeUidList([...localUids, ...remoteUids]);
  if (combined.length > localUids.length) {
    await persistLocalCreatedUids(deviceId, combined);
  }

  if (!options.bypassForOwnerOrAdmin && combined.length >= MAX_ACCOUNTS_PER_DEVICE) {
    throw new Error('DEVICE_ACCOUNT_LIMIT_REACHED');
  }

  return { deviceId, existingUids: combined };
}

export async function recordDeviceCreatedAccount(params: {
  deviceId: string;
  userId: string;
  bypassForOwnerOrAdmin: boolean;
  existingUids?: string[];
}): Promise<void> {
  if (!params.deviceId || !params.userId) return;

  // Owner and Admin creations are unlimited and do not consume regular device account slots
  if (params.bypassForOwnerOrAdmin) {
    return;
  }

  const base = params.existingUids || (await readLocalCreatedUids(params.deviceId));
  const next = sanitizeUidList([...base, params.userId]);
  await persistLocalCreatedUids(params.deviceId, next);

  const now = new Date().toISOString();
  try {
    const lockRef = doc(db, 'deviceAccountLocks', params.deviceId);
    const snap = await getDoc(lockRef).catch(() => null);
    const remoteExisting = snap?.exists()
      ? sanitizeUidList((snap.data() as { accountUids?: unknown })?.accountUids)
      : [];
    const merged = sanitizeUidList([...remoteExisting, ...next]);
    await setDoc(lockRef, {
      deviceId: params.deviceId,
      accountUids: merged,
      accountCount: merged.length,
      createdAt:
        snap?.exists() && typeof snap.data()?.createdAt === 'string'
          ? snap.data().createdAt
          : now,
      updatedAt: now,
    });
  } catch {
    // local persistent store still tracks this UID even if offline
  }
}
