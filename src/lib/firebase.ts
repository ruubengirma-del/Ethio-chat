import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  Auth,
  User as FirebaseUser,
  getAuth,
  signOut as firebaseSignOut,
  updateCurrentUser,
} from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { 
  getFirestore, 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  doc, 
  getDocFromServer 
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firestore with offline multi-tab persistence and resilient long-polling transport
let firestoreDb;
try {
  firestoreDb = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  }, firebaseConfig.firestoreDatabaseId);
} catch (e) {
  // If already initialized, get standard instance
  firestoreDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = firestoreDb;
export const auth = getAuth(app);
export const storage = getStorage(app);
storage.maxUploadRetryTime = 4500;
storage.maxOperationRetryTime = 4500;

function getAccountVaultAuth(uid: string): Auth {
  const vaultName = `ethio_acct_${uid}`;
  const existingApp: FirebaseApp | undefined = getApps().find((a) => a.name === vaultName);
  const vaultApp = existingApp || initializeApp(firebaseConfig, vaultName);
  return getAuth(vaultApp);
}

export async function backupCurrentFirebaseSession(user: FirebaseUser | null): Promise<void> {
  if (!user?.uid) return;
  try {
    const vaultAuth = getAccountVaultAuth(user.uid);
    await vaultAuth.authStateReady();
    if (
      vaultAuth.currentUser?.uid !== user.uid ||
      vaultAuth.currentUser?.refreshToken !== user.refreshToken ||
      (vaultAuth.currentUser?.email || '').toLowerCase() !== (user.email || '').toLowerCase()
    ) {
      await updateCurrentUser(vaultAuth, user);
    }
  } catch {
    // non-fatal vault backup error
  }
}

export async function restoreAccountFirebaseSession(uid?: string | null): Promise<FirebaseUser | null> {
  if (!uid) return null;
  try {
    await auth.authStateReady();
    if (auth.currentUser && auth.currentUser.uid === uid) {
      await backupCurrentFirebaseSession(auth.currentUser);
      return auth.currentUser;
    }

    const vaultAuth = getAccountVaultAuth(uid);
    await vaultAuth.authStateReady();
    if (vaultAuth.currentUser && vaultAuth.currentUser.uid === uid) {
      try {
        await vaultAuth.currentUser.getIdToken(true);
      } catch (err: any) {
        const code = String(err?.code || '');
        if (
          code.includes('user-token-expired') ||
          code.includes('invalid-refresh-token') ||
          code.includes('user-disabled') ||
          code.includes('user-not-found') ||
          code.includes('invalid-user-token')
        ) {
          await clearAccountVaultSession(uid);
          return null;
        }
      }
      await updateCurrentUser(auth, vaultAuth.currentUser);
      await auth.currentUser?.getIdToken(true).catch(() => {});
      return auth.currentUser;
    }
  } catch {
    // vault session unavailable or revoked
  }
  return null;
}

export async function clearAccountVaultSession(uid?: string | null): Promise<void> {
  if (!uid) return;
  try {
    const vaultName = `ethio_acct_${uid}`;
    const existingApp = getApps().find((a) => a.name === vaultName);
    if (existingApp) {
      await firebaseSignOut(getAuth(existingApp)).catch(() => {});
    }
  } catch {
    // ignore
  }
}

// Standardized error handler as mandated by Firebase Security Guidelines
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Verify connection on boot when browser is online
export async function testConnection() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();
