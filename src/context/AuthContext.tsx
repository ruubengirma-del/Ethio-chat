import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut as firebaseSignOut, 
  updateProfile, 
  updateEmail, 
  verifyBeforeUpdateEmail,
  updatePassword,
  signInWithPopup,
  signInWithCredential,
  signInWithCustomToken,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  deleteUser,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
  EmailAuthProvider,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  setDoc, 
  updateDoc, 
  deleteDoc, 
  increment, 
  onSnapshot,
  collection,
  query,
  where
} from 'firebase/firestore';
import {
  auth,
  backupCurrentFirebaseSession,
  clearAccountVaultSession,
  db,
  restoreAccountFirebaseSession,
} from '../lib/firebase';
import { 
  UserProfile, 
  FollowRecord, 
  BlockedUserRecord, 
  DeviceSession, 
  AppNotification, 
  SavedAccount,
  AppRole,
  SubscriptionConfig,
  UserSubscription,
  AdminRolesConfig
} from '../types';
import { 
  createAppNotification, 
  emailToRegistryId,
  getClientDeviceDetails, 
  getOrCreateDeviceId,
  toNotificationMillis,
} from '../lib/socialHelpers';
import {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_SUBSCRIPTION_CONFIG,
  OWNER_EMAIL,
  expireOwnSubscriptionIfDue,
  fetchVerifiedServerRole,
  getAccountRole,
  getSubscriptionExpiryMs,
  isSubscriptionActive,
  syncExpiredSubscriptions,
  syncSubscriptionLifecycleViaServer,
} from '../lib/subscriptionHelpers';
import { validateStrongPassword } from '../lib/passwordValidation';
import {
  assertDeviceCanCreateAccount,
  recordDeviceCreatedAccount,
} from '../lib/deviceAccountLimit';

const SAVED_ACCOUNTS_KEY = 'ethio_chat_saved_accounts_v1';
const LOCAL_SESSION_KEY = 'ethio_chat_local_session';
const PW_VER_PREFIX = 'ethio_pw_ver_';

function getStoredPasswordVersion(uid: string): number {
  try {
    const raw = localStorage.getItem(`${PW_VER_PREFIX}${uid}`);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

function storePasswordVersion(uid: string, version?: number) {
  if (!uid || !version || version <= 0) return;
  try {
    localStorage.setItem(`${PW_VER_PREFIX}${uid}`, String(version));
  } catch {
    // ignore
  }
}

function clearStoredPasswordVersion(uid: string) {
  if (!uid) return;
  try {
    localStorage.removeItem(`${PW_VER_PREFIX}${uid}`);
  } catch {
    // ignore
  }
}

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, pass: string) => Promise<void>;
  signUp: (
    username: string,
    email: string,
    pass: string,
    displayName?: string,
    signupToken?: string
  ) => Promise<void>;
  requestSignUpCode: (
    username: string,
    email: string
  ) => Promise<{ ok: boolean; emailSent?: boolean }>;
  verifySignUpCode: (email: string, code: string) => Promise<string>;
  signInWithGoogle: (loginHint?: string) => Promise<void>;
  signInWithGoogleCredential: (idToken: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  requestPasswordResetCode: (email: string) => Promise<{ ok: boolean; emailSent?: boolean }>;
  verifyPasswordResetCode: (email: string, code: string) => Promise<string>;
  completePasswordResetWithToken: (email: string, resetToken: string, newPassword: string) => Promise<void>;
  checkUsernameAvailability: (
    username: string,
    excludeUid?: string
  ) => Promise<{ available: boolean; normalized: string; reason?: 'invalid_format' | 'taken' }>;
  requestEmailChangeCode: (newEmail: string) => Promise<{ ok: boolean; sentTo: string }>;
  verifyEmailChangeCode: (newEmail: string, code: string) => Promise<string>;
  requiresFreshGoogleReauth: () => boolean;
  reauthenticateWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  updateUserProfileData: (updates: {
    username?: string;
    displayName?: string;
    photoURL?: string;
    coverURL?: string;
    bio?: string;
    email?: string;
    emailChangeToken?: string;
    currentPassword?: string;
    newPassword?: string;
    closeFriendsExcludedIds?: string[];
    selectedFriendIds?: string[];
    lastSeenVisibility?: 'everyone' | 'followers' | 'nobody';
    readReceiptsEnabled?: boolean;
    twoStepEnabled?: boolean;
    twoStepPin?: string;
    appLockEnabled?: boolean;
    appLockPin?: string;
    fontStyle?: string;
    fingerprintLockEnabled?: boolean;
    fingerprintCredentialId?: string;
    chatWallpaper?: string;
    chatFontSize?: 'small' | 'medium' | 'large';
    messageReactionsEnabled?: boolean;
    autoDownloadMedia?: boolean;
    lastBackupAt?: string;
  }) => Promise<{ emailVerificationLinkSent?: boolean } | void>;
  toggleHideOnlineStatus: () => Promise<void>;
  followUser: (targetUserId: string) => Promise<void>;
  unfollowUser: (targetUserId: string) => Promise<void>;
  followingIds: Set<string>;
  followerIds: Set<string>;
  incomingFollowRecords: FollowRecord[];
  allUsers: UserProfile[];
  // Switch / Add Account
  savedAccounts: SavedAccount[];
  isAddingAccount: boolean;
  openAddAccount: () => void;
  closeAddAccount: () => void;
  switchSavedAccount: (account: SavedAccount) => Promise<void>;
  removeSavedAccount: (uid: string) => void;
  pendingReauth: { email: string; reason: 'password_changed' | 'session_required' } | null;
  clearPendingReauth: () => void;
  refreshDirectory: () => Promise<void>;
  // Block System
  blockedUsers: BlockedUserRecord[];
  blockedIds: Set<string>;
  blockUser: (target: { userId: string; username: string; displayName: string; photoURL?: string }) => Promise<void>;
  unblockUser: (targetUserId: string) => Promise<void>;
  // Devices System
  devices: DeviceSession[];
  currentDeviceId: string;
  removeDevice: (deviceId: string) => Promise<void>;
  // Notifications
  notifications: AppNotification[];
  unreadNotificationsCount: number;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  // Premium Subscription, Gold Verified Badge & RBAC
  userRole: AppRole;
  isOwner: boolean;
  isAdmin: boolean;
  hasVerifiedFirebaseSession: boolean;
  subscriptionConfig: SubscriptionConfig;
  adminEmails: string[];
  subscriptionsMap: Record<string, UserSubscription>;
  isUserGoldVerified: (userId?: string | null) => boolean;
  getUserSubscription: (userId?: string | null) => UserSubscription | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function readSavedAccounts(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistSavedAccount(account: SavedAccount): SavedAccount[] {
  const existing = readSavedAccounts();
  const filtered = existing.filter((a) => a.uid !== account.uid);
  const updated = [account, ...filtered].slice(0, 10);
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
  return updated;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [firebaseAuthUser, setFirebaseAuthUser] = useState<FirebaseUser | null>(() => auth.currentUser);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [followerIds, setFollowerIds] = useState<Set<string>>(new Set());
  const [incomingFollowRecords, setIncomingFollowRecords] = useState<FollowRecord[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>(() => readSavedAccounts());
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [pendingReauth, setPendingReauth] = useState<{
    email: string;
    reason: 'password_changed' | 'session_required';
  } | null>(null);

  const [blockedUsers, setBlockedUsers] = useState<BlockedUserRecord[]>([]);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const currentDeviceId = getOrCreateDeviceId();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Subscription, Gold Verified Badge & Role state
  const [subscriptionConfig, setSubscriptionConfig] = useState<SubscriptionConfig>(
    DEFAULT_SUBSCRIPTION_CONFIG
  );
  const [adminEmails, setAdminEmails] = useState<string[]>([DEFAULT_ADMIN_EMAIL]);
  const [serverVerifiedRole, setServerVerifiedRole] = useState<{
    uid: string;
    role: AppRole;
  } | null>(null);
  const [subscriptionsMap, setSubscriptionsMap] = useState<Record<string, UserSubscription>>({});
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());
  const creatingAccountInFlightRef = React.useRef<boolean>(false);
  const interactiveLoginInFlightRef = React.useRef<boolean>(false);

  // Listen to Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        if (creatingAccountInFlightRef.current || interactiveLoginInFlightRef.current) {
          // Wait for signUp / signIn / signInWithGoogle to finish locks, profile write, and passwordVersion sync
          setLoading(false);
          return;
        }
        localStorage.removeItem(LOCAL_SESSION_KEY);
        setFirebaseAuthUser(user);
        setCurrentUser(user);
        backupCurrentFirebaseSession(user).catch(() => {});
      } else {
        const localRaw = localStorage.getItem(LOCAL_SESSION_KEY);
        if (localRaw) {
          try {
            const parsed = JSON.parse(localRaw) as { uid?: string; email?: string };
            if (parsed?.uid) {
              const restored = await restoreAccountFirebaseSession(parsed.uid);
              if (restored && restored.uid === parsed.uid) {
                localStorage.removeItem(LOCAL_SESSION_KEY);
                setFirebaseAuthUser(restored);
                setCurrentUser(restored);
                setLoading(false);
                return;
              }
              const savedAcc = readSavedAccounts().find((a) => a.uid === parsed.uid);
              if (savedAcc) {
                setFirebaseAuthUser(null);
                setServerVerifiedRole(null);
                setPendingReauth(null);
                setCurrentUser({
                  uid: savedAcc.uid,
                  email: savedAcc.email,
                  displayName: savedAcc.displayName,
                  photoURL: savedAcc.photoURL,
                } as unknown as FirebaseUser);
                setLoading(false);
                return;
              }
            }
          } catch {
            // ignore malformed legacy local session
          }
          localStorage.removeItem(LOCAL_SESSION_KEY);
        }
        setFirebaseAuthUser(null);
        setCurrentUser(null);
        setServerVerifiedRole(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Listen to User Profile when currentUser changes
  useEffect(() => {
    if (!currentUser) {
      setUserProfile(null);
      setFollowingIds(new Set());
      setFollowerIds(new Set());
      setIncomingFollowRecords([]);
      setBlockedUsers([]);
      setBlockedIds(new Set());
      setDevices([]);
      setNotifications([]);
      return;
    }

    const userDocRef = doc(db, 'users', currentUser.uid);
    const unsubProfile = onSnapshot(userDocRef, async (snap) => {
      if (snap.exists()) {
        const prof = snap.data() as UserProfile;

        // Cross-device password change check: if another device changed passwordVersion, ask ONCE on this device
        const remoteVer = Number(prof.passwordVersion || 0);
        const localVer = getStoredPasswordVersion(prof.userId);
        if (remoteVer > 0 && localVer > 0 && remoteVer !== localVer) {
          setPendingReauth({ email: prof.email, reason: 'password_changed' });
          localStorage.removeItem(LOCAL_SESSION_KEY);
          clearAccountVaultSession(prof.userId).catch(() => {});
          firebaseSignOut(auth).catch(() => {});
          setCurrentUser(null);
          setUserProfile(null);
          return;
        }
        if (remoteVer > 0 && localVer === 0) {
          storePasswordVersion(prof.userId, remoteVer);
        }

        setUserProfile(prof);
        if (prof.username && /^[a-z0-9_]{3,30}$/.test(prof.username.trim().toLowerCase())) {
          claimUsernameLock(prof.username, prof.userId).catch(() => {});
        }
        // Auto-lift Warning if user reached 400,000+ post shares within the current month
        const nowMonth = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
        if (
          prof.warningActive &&
          prof.monthlySharesMonth === nowMonth &&
          (prof.monthlySharesCount || 0) >= 400000
        ) {
          updateDoc(userDocRef, {
            warningActive: false,
            warningClearedReason: '400k_monthly_shares',
            updatedAt: new Date().toISOString(),
          }).catch(() => {});
        }
        const sessionType: 'local' | 'firebase' = 'firebase';
        setSavedAccounts(
          persistSavedAccount({
            uid: prof.userId,
            email: prof.email,
            username: prof.username,
            displayName: prof.displayName,
            photoURL: prof.photoURL,
            sessionType,
            passwordVersion: remoteVer || localVer || undefined,
          })
        );
      } else {
        if (creatingAccountInFlightRef.current) {
          return;
        }
        const rawFallback = (currentUser.email?.split('@')[0] || `user_${currentUser.uid.slice(0, 6)}`)
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '');
        const username = await findUniqueUsernameForAutoCreate(rawFallback, currentUser.uid);
        const newProfile: UserProfile = {
          userId: currentUser.uid,
          username,
          displayName: currentUser.displayName || username || 'Ethio User',
          email: currentUser.email || '',
          photoURL: currentUser.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`,
          bio: 'Hello! I am using Ethio Chat ✨',
          followersCount: 0,
          followingCount: 0,
          hideOnlineStatus: false,
          profileViewsCount: 0,
          createdAt: new Date().toISOString()
        };
        try {
          await claimUsernameLock(username, currentUser.uid).catch(() => {});
          await setDoc(userDocRef, newProfile);
          setUserProfile(newProfile);
        } catch (err) {
          console.warn('Failed to initialize user document:', err);
        }
      }
    }, (error) => {
      console.warn('Profile listener notice:', error);
    });

    return () => unsubProfile();
  }, [currentUser]);

  // Register & listen to logged-in devices
  useEffect(() => {
    if (!currentUser) return;

    const details = getClientDeviceDetails();
    const deviceRef = doc(db, 'users', currentUser.uid, 'devices', currentDeviceId);
    const now = new Date().toISOString();
    let registeredOnce = false;

    setDoc(
      deviceRef,
      {
        deviceId: currentDeviceId,
        userId: currentUser.uid,
        deviceName: details.deviceName,
        platform: details.platform,
        browser: details.browser,
        lastActiveAt: now,
        createdAt: now,
      },
      { merge: true }
    )
      .then(() => {
        registeredOnce = true;
      })
      .catch(() => {});

    const unsubDevices = onSnapshot(
      collection(db, 'users', currentUser.uid, 'devices'),
      (snapshot) => {
        const list: DeviceSession[] = [];
        snapshot.forEach((d) => list.push(d.data() as DeviceSession));
        list.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
        setDevices(list);

        // If this device was remotely removed after registration, sign out locally
        if (registeredOnce && !list.some((d) => d.deviceId === currentDeviceId)) {
          localStorage.removeItem(LOCAL_SESSION_KEY);
          clearAccountVaultSession(currentUser.uid).catch(() => {});
          firebaseSignOut(auth).catch(() => {});
          setCurrentUser(null);
          setUserProfile(null);
        }
      },
      (err) => console.warn('Devices listener error:', err)
    );

    return () => unsubDevices();
  }, [currentUser, currentDeviceId]);

  // Track real-time Last Seen presence heartbeat
  useEffect(() => {
    if (!currentUser) return;
    const pingLastSeen = () => {
      if (document.visibilityState === 'hidden') return;
      updateDoc(doc(db, 'users', currentUser.uid), {
        lastSeenAt: new Date().toISOString(),
      }).catch(() => {});
    };

    pingLastSeen();
    const interval = setInterval(pingLastSeen, 60000);
    window.addEventListener('focus', pingLastSeen);
    document.addEventListener('visibilitychange', pingLastSeen);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', pingLastSeen);
      document.removeEventListener('visibilitychange', pingLastSeen);
    };
  }, [currentUser]);

  // Reload Firebase Auth user on focus when Firestore email and Firebase Auth email differ
  // (e.g. user tapped Firebase's verifyBeforeUpdateEmail confirmation link in Gmail)
  useEffect(() => {
    if (!currentUser || !userProfile || currentUser.uid !== userProfile.userId) return;
    const syncAuthEmail = async () => {
      if (document.visibilityState === 'hidden') return;
      const fbUser = auth.currentUser;
      if (!fbUser || fbUser.uid !== userProfile.userId) return;
      const fbEmail = (fbUser.email || '').trim().toLowerCase();
      const profEmail = (userProfile.email || '').trim().toLowerCase();
      if (!profEmail || fbEmail === profEmail) return;
      try {
        await fbUser.reload();
        if (auth.currentUser && auth.currentUser.uid === userProfile.userId) {
          setFirebaseAuthUser(auth.currentUser);
          setCurrentUser(auth.currentUser);
          await backupCurrentFirebaseSession(auth.currentUser).catch(() => {});
        }
      } catch {
        // ignore transient reload or expired token notice
      }
    };

    window.addEventListener('focus', syncAuthEmail);
    document.addEventListener('visibilitychange', syncAuthEmail);
    return () => {
      window.removeEventListener('focus', syncAuthEmail);
      document.removeEventListener('visibilitychange', syncAuthEmail);
    };
  }, [currentUser, userProfile?.email, userProfile?.userId]);

  // Listen to blocked users
  useEffect(() => {
    if (!currentUser) return;
    const unsub = onSnapshot(
      collection(db, 'users', currentUser.uid, 'blocked'),
      (snapshot) => {
        const list: BlockedUserRecord[] = [];
        const ids = new Set<string>();
        snapshot.forEach((d) => {
          const item = d.data() as BlockedUserRecord;
          list.push(item);
          ids.add(item.blockedUserId);
        });
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setBlockedUsers(list);
        setBlockedIds(ids);
      },
      (err) => console.warn('Blocked users listener error:', err)
    );
    return () => unsub();
  }, [currentUser]);

  // Listen to notifications for current user in real time (supports both recipientId and toUserId)
  useEffect(() => {
    if (!currentUser) {
      setNotifications([]);
      return;
    }

    const byRecipientMap = new Map<string, AppNotification>();
    const byToUserMap = new Map<string, AppNotification>();

    const syncMerged = () => {
      const merged = new Map<string, AppNotification>();
      byRecipientMap.forEach((val, key) => merged.set(key, val));
      byToUserMap.forEach((val, key) => {
        if (!merged.has(key)) merged.set(key, val);
      });
      const list = Array.from(merged.values());
      list.sort((a, b) => toNotificationMillis(b.createdAt) - toNotificationMillis(a.createdAt));
      setNotifications(list);
    };

    const qRecipient = query(
      collection(db, 'notifications'),
      where('recipientId', '==', currentUser.uid)
    );
    const qToUser = query(
      collection(db, 'notifications'),
      where('toUserId', '==', currentUser.uid)
    );

    const unsubRecipient = onSnapshot(
      qRecipient,
      (snapshot) => {
        byRecipientMap.clear();
        snapshot.forEach((d) => {
          const data = d.data() as AppNotification;
          byRecipientMap.set(d.id, { ...data, notificationId: data.notificationId || d.id });
        });
        syncMerged();
      },
      (err) => console.warn('Notifications listener error:', err)
    );

    const unsubToUser = onSnapshot(
      qToUser,
      (snapshot) => {
        byToUserMap.clear();
        snapshot.forEach((d) => {
          const data = d.data() as AppNotification;
          byToUserMap.set(d.id, { ...data, notificationId: data.notificationId || d.id });
        });
        syncMerged();
      },
      (err) => console.warn('Mention notifications listener notice:', err)
    );

    return () => {
      unsubRecipient();
      unsubToUser();
    };
  }, [currentUser]);

  // Listen to following and followers when logged in
  useEffect(() => {
    if (!currentUser) return;

    const qFollowing = query(collection(db, 'follows'), where('followerId', '==', currentUser.uid));
    const unsubFollowing = onSnapshot(qFollowing, (snapshot) => {
      const set = new Set<string>();
      snapshot.forEach(d => {
        const data = d.data() as FollowRecord;
        set.add(data.followingId);
      });
      setFollowingIds(set);
    }, (err) => {
      console.warn('Following listener error:', err);
    });

    const qFollowers = query(collection(db, 'follows'), where('followingId', '==', currentUser.uid));
    const unsubFollowers = onSnapshot(qFollowers, (snapshot) => {
      const set = new Set<string>();
      const records: FollowRecord[] = [];
      snapshot.forEach(d => {
        const data = d.data() as FollowRecord;
        set.add(data.followerId);
        records.push(data);
      });
      setFollowerIds(set);
      setIncomingFollowRecords(records);
    }, (err) => {
      console.warn('Followers listener error:', err);
    });

    return () => {
      unsubFollowing();
      unsubFollowers();
    };
  }, [currentUser]);

  // Listen to all users for search, group invites & mentions
  useEffect(() => {
    if (!currentUser) return;

    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      const list: UserProfile[] = [];
      snapshot.forEach(d => {
        list.push(d.data() as UserProfile);
      });
      setAllUsers(list);
    }, (err) => {
      console.warn('All users listener error:', err);
    });
    return () => unsub();
  }, [currentUser]);

  // Live clock tick (every 30s) so expired Gold Verified Badges auto-remove immediately
  useEffect(() => {
    const timer = setInterval(() => setNowTickMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Listen to global subscription package & payment config once authenticated
  useEffect(() => {
    if (!currentUser) return;
    const unsub = onSnapshot(
      doc(db, 'appConfig', 'subscription'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<SubscriptionConfig>;
          const rawBinance = typeof data.binanceUid === 'string' ? data.binanceUid.trim() : '';
          const shouldMigrateLegacyBinance = !rawBinance || rawBinance === '1024662988';
          const resolvedBinance = shouldMigrateLegacyBinance
            ? DEFAULT_SUBSCRIPTION_CONFIG.binanceUid
            : rawBinance;

          setSubscriptionConfig({
            ...DEFAULT_SUBSCRIPTION_CONFIG,
            ...data,
            binanceUid: resolvedBinance,
            packages:
              Array.isArray(data.packages) && data.packages.length > 0
                ? data.packages
                : DEFAULT_SUBSCRIPTION_CONFIG.packages,
          });

          if (
            rawBinance === '1024662988' &&
            (auth.currentUser?.email || '').trim().toLowerCase() === OWNER_EMAIL
          ) {
            updateDoc(doc(db, 'appConfig', 'subscription'), {
              binanceUid: DEFAULT_SUBSCRIPTION_CONFIG.binanceUid,
              updatedAt: new Date().toISOString(),
            }).catch(() => {});
          }
        } else {
          setSubscriptionConfig(DEFAULT_SUBSCRIPTION_CONFIG);
        }
      },
      () => {
        setSubscriptionConfig(DEFAULT_SUBSCRIPTION_CONFIG);
      }
    );
    return () => unsub();
  }, [currentUser?.uid]);

  // Listen to authoritative Gold Verified subscriptions map once authenticated
  useEffect(() => {
    if (!currentUser) {
      setSubscriptionsMap({});
      return;
    }
    const unsub = onSnapshot(
      collection(db, 'subscriptions'),
      (snapshot) => {
        const nextMap: Record<string, UserSubscription> = {};
        snapshot.forEach((d) => {
          const sub = d.data() as UserSubscription;
          if (sub?.userId) {
            nextMap[sub.userId] = sub;
          }
        });
        setSubscriptionsMap(nextMap);
      },
      (err) => {
        console.warn('Subscriptions listener notice:', err);
      }
    );
    return () => unsub();
  }, [currentUser?.uid]);

  // Verify caller role strictly with backend Firebase ID token & custom claims
  useEffect(() => {
    const uid = firebaseAuthUser?.uid;
    if (!uid || !currentUser || currentUser.uid !== uid) {
      setServerVerifiedRole(null);
      setAdminEmails([DEFAULT_ADMIN_EMAIL]);
      return;
    }

    let cancelled = false;
    fetchVerifiedServerRole(uid).then((res) => {
      if (cancelled) return;
      if (res && res.uid === uid) {
        setServerVerifiedRole({ uid, role: res.role });
      } else {
        setServerVerifiedRole({ uid, role: 'user' });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [firebaseAuthUser?.uid, currentUser?.uid]);

  // Listen to appConfig/roles only after server role is verified as owner or admin
  useEffect(() => {
    const verifiedRole =
      serverVerifiedRole && serverVerifiedRole.uid === currentUser?.uid
        ? serverVerifiedRole.role
        : 'user';
    if (
      !firebaseAuthUser ||
      !currentUser ||
      firebaseAuthUser.uid !== currentUser.uid ||
      (verifiedRole !== 'owner' && verifiedRole !== 'admin')
    ) {
      setAdminEmails([DEFAULT_ADMIN_EMAIL]);
      return;
    }

    const unsubRoles = onSnapshot(
      doc(db, 'appConfig', 'roles'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as AdminRolesConfig;
          const list = Array.isArray(data.adminEmails)
            ? data.adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)
            : [];
          if (!list.includes(DEFAULT_ADMIN_EMAIL)) {
            list.unshift(DEFAULT_ADMIN_EMAIL);
          }
          setAdminEmails(list);
        } else {
          setAdminEmails([DEFAULT_ADMIN_EMAIL]);
        }
      },
      () => {
        // Non-privileged users do not have permission to read appConfig/roles
      }
    );

    return () => unsubRoles();
  }, [firebaseAuthUser?.uid, currentUser?.uid, serverVerifiedRole]);

  // Track handled auto-expirations so Firestore writes aren't repeated on every tick
  const selfExpiredAttemptRef = React.useRef<Set<string>>(new Set());
  const adminExpiredSweepKeyRef = React.useRef<string>('');

  // Periodically invoke backend lifecycle sync (expiration + 7d/1d reminders) while verified Owner/Admin is signed in
  useEffect(() => {
    const verifiedRole =
      serverVerifiedRole && serverVerifiedRole.uid === currentUser?.uid
        ? serverVerifiedRole.role
        : 'user';
    if (
      !firebaseAuthUser ||
      !currentUser ||
      firebaseAuthUser.uid !== currentUser.uid ||
      (verifiedRole !== 'owner' && verifiedRole !== 'admin')
    ) {
      return;
    }

    syncSubscriptionLifecycleViaServer(currentUser.uid).catch(() => {});
    const timer = window.setInterval(() => {
      syncSubscriptionLifecycleViaServer(currentUser.uid).catch(() => {});
    }, 5 * 60 * 1000);

    return () => window.clearInterval(timer);
  }, [firebaseAuthUser?.uid, currentUser?.uid, serverVerifiedRole]);

  // Automatically expire the signed-in user's own subscription as soon as its 3/6/12-month expiry arrives
  useEffect(() => {
    if (!firebaseAuthUser || !currentUser || firebaseAuthUser.uid !== currentUser.uid) return;
    const mySub = subscriptionsMap[currentUser.uid];
    if (!mySub || mySub.status !== 'active') return;
    const expiryMs = getSubscriptionExpiryMs(mySub);
    if (!expiryMs || expiryMs > nowTickMs) return;

    const attemptKey = `${mySub.userId}_${mySub.approvedPaymentId || mySub.paymentId}_${expiryMs}`;
    if (selfExpiredAttemptRef.current.has(attemptKey)) return;
    selfExpiredAttemptRef.current.add(attemptKey);

    expireOwnSubscriptionIfDue(mySub).then((didExpire) => {
      if (!didExpire) {
        selfExpiredAttemptRef.current.delete(attemptKey);
      }
    });
  }, [firebaseAuthUser?.uid, currentUser?.uid, subscriptionsMap, nowTickMs]);

  // When an Owner or Admin is online, immediately expire any overdue active subscriptions in Firestore
  useEffect(() => {
    const verifiedRole =
      serverVerifiedRole && serverVerifiedRole.uid === currentUser?.uid
        ? serverVerifiedRole.role
        : 'user';
    if (
      !firebaseAuthUser ||
      !currentUser ||
      firebaseAuthUser.uid !== currentUser.uid ||
      (verifiedRole !== 'owner' && verifiedRole !== 'admin')
    ) {
      return;
    }

    const overdueSubs = Object.values(subscriptionsMap).filter((sub) => {
      if (sub.status !== 'active') return false;
      const expiryMs = getSubscriptionExpiryMs(sub);
      return expiryMs > 0 && expiryMs <= nowTickMs;
    });
    if (overdueSubs.length === 0) return;

    const sweepKey = overdueSubs
      .map((s) => `${s.userId}:${s.approvedPaymentId || s.paymentId}:${getSubscriptionExpiryMs(s)}`)
      .sort()
      .join('|');
    if (adminExpiredSweepKeyRef.current === sweepKey) return;
    adminExpiredSweepKeyRef.current = sweepKey;

    syncExpiredSubscriptions(overdueSubs, {
      uid: currentUser.uid,
      email: currentUser.email || firebaseAuthUser.email || '',
      role: verifiedRole,
    }).catch(() => {
      adminExpiredSweepKeyRef.current = '';
    });
  }, [firebaseAuthUser?.uid, currentUser?.uid, serverVerifiedRole, subscriptionsMap, nowTickMs]);

  const refreshDirectory = React.useCallback(async () => {
    if (!currentUser) return;
    const usersRef = collection(db, 'users');
    const qFollowing = query(collection(db, 'follows'), where('followerId', '==', currentUser.uid));
    const qFollowers = query(collection(db, 'follows'), where('followingId', '==', currentUser.uid));

    const [usersSnap, followingSnap, followersSnap] = await Promise.all([
      getDocsFromServer(usersRef).catch(() => getDocs(usersRef)),
      getDocsFromServer(qFollowing).catch(() => getDocs(qFollowing)),
      getDocsFromServer(qFollowers).catch(() => getDocs(qFollowers)),
    ]);

    const userList: UserProfile[] = [];
    usersSnap.forEach((d) => userList.push(d.data() as UserProfile));
    setAllUsers(userList);

    const fSet = new Set<string>();
    followingSnap.forEach((d) => {
      const data = d.data() as FollowRecord;
      fSet.add(data.followingId);
    });
    setFollowingIds(fSet);

    const rSet = new Set<string>();
    const rList: FollowRecord[] = [];
    followersSnap.forEach((d) => {
      const data = d.data() as FollowRecord;
      rSet.add(data.followerId);
      rList.push(data);
    });
    setFollowerIds(rSet);
    setIncomingFollowRecords(rList);
  }, [currentUser]);

  const ensureEmailAvailableForUid = async (rawEmail: string, excludeUid?: string) => {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    if (!normalizedEmail) throw new Error('Please enter a valid email address.');

    // 1. Check dedicated emailLocks registry
    const lockKey = emailToRegistryId(normalizedEmail);
    try {
      const lockSnap = await getDoc(doc(db, 'emailLocks', lockKey));
      if (lockSnap.exists()) {
        const ownerUid = lockSnap.data()?.userId;
        if (!excludeUid || ownerUid !== excludeUid) {
          throw new Error('EMAIL_ALREADY_IN_USE');
        }
      }
    } catch (err: any) {
      if (err?.message === 'EMAIL_ALREADY_IN_USE') throw err;
    }

    // 2. Check all user profiles case-insensitively (catches legacy accounts too)
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      for (const d of usersSnap.docs) {
        const data = d.data() as UserProfile;
        if (
          data.email &&
          data.email.trim().toLowerCase() === normalizedEmail &&
          (!excludeUid || data.userId !== excludeUid)
        ) {
          throw new Error('EMAIL_ALREADY_IN_USE');
        }
      }
    } catch (err: any) {
      if (err?.message === 'EMAIL_ALREADY_IN_USE') throw err;
    }
  };

  const claimEmailLock = async (rawEmail: string, userId: string) => {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    if (!normalizedEmail || !userId) return;
    const emailKey = emailToRegistryId(normalizedEmail);
    const ref = doc(db, 'emailLocks', emailKey);
    const existing = await getDoc(ref).catch(() => null);
    if (existing && existing.exists()) {
      if (existing.data()?.userId !== userId) {
        throw new Error('EMAIL_ALREADY_IN_USE');
      }
      return;
    }
    await setDoc(ref, {
      emailKey,
      email: normalizedEmail,
      userId,
      createdAt: new Date().toISOString(),
    }).catch(() => {});
  };

  // Sign In with email & password (always real Firebase Authentication)
  const signIn = async (email: string, pass: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    interactiveLoginInFlightRef.current = true;
    try {
      if (auth.currentUser) {
        await backupCurrentFirebaseSession(auth.currentUser);
      }
      let cred;
      try {
        cred = await signInWithEmailAndPassword(auth, normalizedEmail, pass);
      } catch (signInErr: any) {
        const code = String(signInErr?.code || '');
        if (
          code === 'auth/invalid-credential' ||
          code === 'auth/user-not-found' ||
          code === 'auth/wrong-password'
        ) {
          const lockSnap = await getDocFromServer(
            doc(db, 'emailLocks', emailToRegistryId(normalizedEmail))
          ).catch(() => null);
          if (lockSnap && lockSnap.exists()) {
            signInErr.pendingEmailLinkConfirmation = true;
          }
        }
        throw signInErr;
      }
      // Clear stale local passwordVersion BEFORE setting currentUser so fresh interactive login
      // after a password reset on another device or Forgot Password never triggers an auto-logout race.
      clearStoredPasswordVersion(cred.user.uid);
      localStorage.removeItem(LOCAL_SESSION_KEY);

      const authEmail = (cred.user.email || normalizedEmail).trim().toLowerCase();
      const userSnap = await getDocFromServer(doc(db, 'users', cred.user.uid))
        .catch(() => getDoc(doc(db, 'users', cred.user.uid)))
        .catch(() => null);
      if (userSnap && userSnap.exists()) {
        const prof = userSnap.data() as UserProfile;
        if (prof.passwordVersion) {
          storePasswordVersion(cred.user.uid, prof.passwordVersion);
        }
        if (authEmail && prof.email && prof.email.trim().toLowerCase() !== authEmail) {
          await updateDoc(doc(db, 'users', cred.user.uid), {
            email: authEmail,
            updatedAt: new Date().toISOString(),
          }).catch(() => {});
        }
        if (prof.username && /^[a-z0-9_]{3,30}$/.test(prof.username.trim().toLowerCase())) {
          await claimUsernameLock(prof.username, cred.user.uid).catch(() => {});
        }
      }
      await claimEmailLock(authEmail, cred.user.uid).catch(() => {});
      await backupCurrentFirebaseSession(cred.user);

      setFirebaseAuthUser(cred.user);
      setCurrentUser(cred.user);
      setIsAddingAccount(false);
      setPendingReauth(null);
    } finally {
      interactiveLoginInFlightRef.current = false;
    }
  };

  const ensureUsernameAvailableForUid = async (rawUsername: string, excludeUid?: string) => {
    const clean = rawUsername.trim().replace(/^@+/, '').toLowerCase();
    if (!clean) throw new Error('Please choose a username.');

    // 1. Check dedicated atomic usernameLocks registry first (server-authoritative)
    try {
      const lockSnap = await getDocFromServer(doc(db, 'usernameLocks', clean)).catch(() =>
        getDoc(doc(db, 'usernameLocks', clean))
      );
      if (lockSnap.exists()) {
        const ownerUid = String(lockSnap.data()?.userId || '');
        if (!excludeUid || ownerUid !== excludeUid) {
          throw new Error('USERNAME_ALREADY_IN_USE');
        }
      }
    } catch (err: any) {
      if (err?.message === 'USERNAME_ALREADY_IN_USE') throw err;
    }

    // 2. Also verify against all existing user profiles (catches legacy accounts without a lock doc)
    try {
      const usersSnap = await getDocsFromServer(collection(db, 'users')).catch(() =>
        getDocs(collection(db, 'users'))
      );
      for (const d of usersSnap.docs) {
        const data = d.data() as UserProfile;
        if (
          data.username &&
          data.username.trim().toLowerCase() === clean &&
          (!excludeUid || (data.userId || d.id) !== excludeUid)
        ) {
          throw new Error('USERNAME_ALREADY_IN_USE');
        }
      }
    } catch (err: any) {
      if (err?.message === 'USERNAME_ALREADY_IN_USE') throw err;
    }
  };

  const claimUsernameLock = async (rawUsername: string, userId: string) => {
    const clean = rawUsername.trim().replace(/^@+/, '').toLowerCase();
    if (!clean || !userId || !/^[a-z0-9_]{3,30}$/.test(clean)) return;

    const ref = doc(db, 'usernameLocks', clean);
    const existing = await getDocFromServer(ref)
      .catch(() => getDoc(ref))
      .catch(() => null);
    if (existing && existing.exists()) {
      if (existing.data()?.userId !== userId) {
        throw new Error('USERNAME_ALREADY_IN_USE');
      }
      return;
    }

    try {
      await setDoc(ref, {
        usernameKey: clean,
        username: clean,
        userId,
        createdAt: new Date().toISOString(),
      });
    } catch (err: any) {
      // Firestore rule blocks create/update if another user owns this username lock
      if (err?.code === 'permission-denied') {
        throw new Error('USERNAME_ALREADY_IN_USE');
      }
      throw err;
    }
  };

  const releaseUsernameLock = async (rawUsername: string) => {
    const clean = rawUsername.trim().replace(/^@+/, '').toLowerCase();
    if (!clean || !/^[a-z0-9_]{3,30}$/.test(clean)) return;
    await deleteDoc(doc(db, 'usernameLocks', clean)).catch(() => {});
  };

  const checkUsernameAvailability = async (rawUsername: string, excludeUid?: string) => {
    const clean = rawUsername.trim().replace(/^@+/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(clean)) {
      return { available: false, normalized: clean, reason: 'invalid_format' as const };
    }
    try {
      await ensureUsernameAvailableForUid(clean, excludeUid);
      return { available: true, normalized: clean };
    } catch (err: any) {
      if (err?.message === 'USERNAME_ALREADY_IN_USE') {
        return { available: false, normalized: clean, reason: 'taken' as const };
      }
      return { available: true, normalized: clean };
    }
  };

  const findUniqueUsernameForAutoCreate = async (preferredBase: string, uid: string): Promise<string> => {
    const cleanedBase = preferredBase.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const safeBase =
      cleanedBase.length >= 3 ? cleanedBase.slice(0, 24) : `user_${uid.slice(0, 6).toLowerCase()}`;

    const candidates: string[] = [safeBase];
    for (let i = 1; i <= 20; i++) {
      candidates.push(`${safeBase.slice(0, 24)}_${i}`);
    }
    candidates.push(`${safeBase.slice(0, 20)}_${uid.slice(0, 6).toLowerCase()}`);

    for (const candidate of candidates) {
      try {
        await ensureUsernameAvailableForUid(candidate, uid);
        return candidate;
      } catch {
        // try next candidate
      }
    }
    return `user_${uid.slice(0, 10).toLowerCase()}_${Date.now().toString().slice(-4)}`;
  };

  // Sign Up OTP Step 1: Validate inputs + device limit + uniqueness, then send 6-digit email code
  const requestSignUpCode = async (username: string, email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!/^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
      throw new Error('Username must be 3–30 characters using only letters, numbers, and underscores (_).');
    }
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('Please enter a valid email address.');
    }

    const callerIsPrivileged = Boolean(
      hasVerifiedFirebaseSession &&
        serverVerifiedRole &&
        serverVerifiedRole.uid === currentUser?.uid &&
        (serverVerifiedRole.role === 'owner' || serverVerifiedRole.role === 'admin')
    );
    const targetIsPrivileged = getAccountRole(normalizedEmail, adminEmails) !== 'user';
    const bypassForOwnerOrAdmin = callerIsPrivileged || targetIsPrivileged;

    await assertDeviceCanCreateAccount({ bypassForOwnerOrAdmin });
    await ensureUsernameAvailableForUid(cleanUsername);
    await ensureEmailAvailableForUid(normalizedEmail);

    const resp = await fetch('/api/auth/send-signup-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cleanUsername, email: normalizedEmail }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err: any = new Error(data.error || 'Could not send verification code to your email.');
      err.code = data.code;
      throw err;
    }
    return data as { ok: boolean; emailSent?: boolean };
  };

  // Sign Up OTP Step 2: Verify 6-digit code and obtain short-lived signupToken
  const verifySignUpCode = async (email: string, code: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();
    if (!cleanCode) throw new Error('Please enter the 6-digit verification code sent to your email.');

    const resp = await fetch('/api/auth/verify-signup-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, code: cleanCode }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.signupToken) {
      throw new Error(data.error || 'Incorrect or expired verification code.');
    }
    return String(data.signupToken);
  };

  // Sign Up with username, email, password + verified 6-digit email code token (strictly 1 email = 1 account + unique username + max 5 accounts per device except Owner/Admin)
  const signUp = async (
    username: string,
    email: string,
    pass: string,
    displayName?: string,
    signupToken?: string
  ) => {
    const normalizedEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!/^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
      throw new Error('Username must be 3–30 characters using only letters, numbers, and underscores (_).');
    }

    const pwCheck = validateStrongPassword(pass);
    if (!pwCheck.valid) {
      throw new Error(pwCheck.error || 'Password does not meet security requirements.');
    }

    if (!signupToken) {
      throw new Error('SIGNUP_VERIFICATION_REQUIRED');
    }

    const finalDisplayName = displayName?.trim() || cleanUsername;

    const callerIsPrivileged = Boolean(
      hasVerifiedFirebaseSession &&
        serverVerifiedRole &&
        serverVerifiedRole.uid === currentUser?.uid &&
        (serverVerifiedRole.role === 'owner' || serverVerifiedRole.role === 'admin')
    );
    const targetIsPrivileged = getAccountRole(normalizedEmail, adminEmails) !== 'user';
    const bypassForOwnerOrAdmin = callerIsPrivileged || targetIsPrivileged;

    // Enforce 5 accounts per device BEFORE creating any Firebase Auth user (Owner & Admin exempt)
    const deviceCheck = await assertDeviceCanCreateAccount({ bypassForOwnerOrAdmin });

    // Enforce unique username & 1 email = 1 account before creating anything
    await ensureUsernameAvailableForUid(cleanUsername);
    await ensureEmailAvailableForUid(normalizedEmail);

    // Consume verified 6-digit email token strictly on the server before creating the Firebase Auth user
    const consumeResp = await fetch('/api/auth/consume-signup-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, signupToken }),
    });
    const consumeData = await consumeResp.json().catch(() => ({}));
    if (!consumeResp.ok) {
      const err: any = new Error(consumeData.error || 'SIGNUP_VERIFICATION_REQUIRED');
      err.code = consumeData.code;
      throw err;
    }

    if (auth.currentUser) {
      await backupCurrentFirebaseSession(auth.currentUser);
    }

    creatingAccountInFlightRef.current = true;
    try {
      const res = await createUserWithEmailAndPassword(auth, normalizedEmail, pass);
      try {
        await claimUsernameLock(cleanUsername, res.user.uid);
      } catch (lockErr) {
        // Roll back Auth user if another signup claimed this exact username in the same millisecond
        await deleteUser(res.user).catch(() => firebaseSignOut(auth).catch(() => {}));
        throw lockErr;
      }

      const profile: UserProfile = {
        userId: res.user.uid,
        username: cleanUsername,
        displayName: finalDisplayName,
        email: normalizedEmail,
        photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanUsername}`,
        bio: 'Just joined Ethio Chat! 🇪🇹✨',
        followersCount: 0,
        followingCount: 0,
        hideOnlineStatus: false,
        profileViewsCount: 0,
        createdAt: new Date().toISOString()
      };

      try {
        await updateProfile(res.user, {
          displayName: finalDisplayName
        });
        await claimEmailLock(normalizedEmail, res.user.uid);
        await setDoc(doc(db, 'users', res.user.uid), profile);
        await recordDeviceCreatedAccount({
          deviceId: deviceCheck.deviceId,
          userId: res.user.uid,
          bypassForOwnerOrAdmin,
          existingUids: deviceCheck.existingUids,
        });
      } catch (setupErr) {
        await releaseUsernameLock(cleanUsername).catch(() => {});
        await deleteDoc(doc(db, 'emailLocks', emailToRegistryId(normalizedEmail))).catch(() => {});
        await deleteUser(res.user).catch(() => firebaseSignOut(auth).catch(() => {}));
        throw setupErr;
      }

      clearStoredPasswordVersion(res.user.uid);
      localStorage.removeItem(LOCAL_SESSION_KEY);
      await backupCurrentFirebaseSession(res.user);
      setFirebaseAuthUser(res.user);
      setUserProfile(profile);
      setCurrentUser(res.user);
      setIsAddingAccount(false);
      setPendingReauth(null);
    } finally {
      creatingAccountInFlightRef.current = false;
    }
  };

  const completeGoogleFirebaseSignIn = async (
    fbUser: FirebaseUser,
    callerIsPrivilegedBeforePopup: boolean
  ) => {
    clearStoredPasswordVersion(fbUser.uid);
    const normalizedEmail = (fbUser.email || '').trim().toLowerCase();
    const userDocRef = doc(db, 'users', fbUser.uid);
    const snap = await getDocFromServer(userDocRef).catch(() => getDoc(userDocRef));

    if (!snap.exists()) {
      const targetIsPrivileged = getAccountRole(normalizedEmail, adminEmails) !== 'user';
      const bypassForOwnerOrAdmin = callerIsPrivilegedBeforePopup || targetIsPrivileged;

      let deviceCheck: { deviceId: string; existingUids: string[] };
      try {
        deviceCheck = await assertDeviceCanCreateAccount({ bypassForOwnerOrAdmin });
      } catch (limitErr) {
        await deleteUser(fbUser).catch(() => firebaseSignOut(auth).catch(() => {}));
        throw limitErr;
      }

      if (normalizedEmail) {
        try {
          await ensureEmailAvailableForUid(normalizedEmail, fbUser.uid);
        } catch (dupErr) {
          await firebaseSignOut(auth).catch(() => {});
          throw dupErr;
        }
      }
      const rawBase = (normalizedEmail.split('@')[0] || `user_${fbUser.uid.slice(0, 6)}`)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '');
      const username = await findUniqueUsernameForAutoCreate(rawBase, fbUser.uid);
      const profile: UserProfile = {
        userId: fbUser.uid,
        username,
        displayName: fbUser.displayName || username,
        email: normalizedEmail,
        photoURL: fbUser.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`,
        bio: 'Connecting on Ethio Chat 🚀',
        followersCount: 0,
        followingCount: 0,
        hideOnlineStatus: false,
        profileViewsCount: 0,
        createdAt: new Date().toISOString()
      };
      if (normalizedEmail) {
        await claimEmailLock(normalizedEmail, fbUser.uid);
      }
      await claimUsernameLock(username, fbUser.uid).catch(() => {});
      await setDoc(userDocRef, profile);
      await recordDeviceCreatedAccount({
        deviceId: deviceCheck.deviceId,
        userId: fbUser.uid,
        bypassForOwnerOrAdmin,
        existingUids: deviceCheck.existingUids,
      });
      setUserProfile(profile);
    } else {
      if (normalizedEmail) {
        await claimEmailLock(normalizedEmail, fbUser.uid).catch(() => {});
      }
      const existingProf = snap.data() as UserProfile;
      if (existingProf.passwordVersion) {
        storePasswordVersion(fbUser.uid, existingProf.passwordVersion);
      }
      if (existingProf?.username && /^[a-z0-9_]{3,30}$/.test(existingProf.username.trim().toLowerCase())) {
        await claimUsernameLock(existingProf.username, fbUser.uid).catch(() => {});
      }
    }

    localStorage.removeItem(LOCAL_SESSION_KEY);
    await backupCurrentFirebaseSession(fbUser);
    setFirebaseAuthUser(fbUser);
    setCurrentUser(fbUser);
    setIsAddingAccount(false);
    setPendingReauth(null);
  };

  // In-app Google Identity Services / FedCM ID-token Sign In (keeps user directly inside the app)
  const signInWithGoogleCredential = async (idToken: string) => {
    creatingAccountInFlightRef.current = true;
    try {
      const callerIsPrivilegedBeforePopup = Boolean(
        hasVerifiedFirebaseSession &&
          serverVerifiedRole &&
          serverVerifiedRole.uid === currentUser?.uid &&
          (serverVerifiedRole.role === 'owner' || serverVerifiedRole.role === 'admin')
      );
      if (auth.currentUser) {
        await backupCurrentFirebaseSession(auth.currentUser);
      }
      const credential = GoogleAuthProvider.credential(idToken);
      const res = await signInWithCredential(auth, credential);
      await completeGoogleFirebaseSignIn(res.user, callerIsPrivilegedBeforePopup);
    } catch (error) {
      console.warn('In-app Google credential sign-in notice:', error);
      throw error;
    } finally {
      creatingAccountInFlightRef.current = false;
    }
  };

  // Google Sign In (strictly 1 email = 1 account + unique username + max 5 newly created accounts per device except Owner/Admin)
  const signInWithGoogle = async (loginHint?: string) => {
    creatingAccountInFlightRef.current = true;
    try {
      const callerIsPrivilegedBeforePopup = Boolean(
        hasVerifiedFirebaseSession &&
          serverVerifiedRole &&
          serverVerifiedRole.uid === currentUser?.uid &&
          (serverVerifiedRole.role === 'owner' || serverVerifiedRole.role === 'admin')
      );
      if (auth.currentUser) {
        void backupCurrentFirebaseSession(auth.currentUser);
      }
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account',
        ...(loginHint ? { login_hint: loginHint } : {}),
      });
      const res = await signInWithPopup(auth, provider);
      await completeGoogleFirebaseSignIn(res.user, callerIsPrivilegedBeforePopup);
    } catch (error) {
      console.warn('Google sign-in notice:', error);
      throw error;
    } finally {
      creatingAccountInFlightRef.current = false;
    }
  };

  const resetPassword = async (email: string) => {
    const cleanEmail = email.trim();
    if (!cleanEmail) throw new Error('Please enter your email address');
    await sendPasswordResetEmail(auth, cleanEmail);
  };

  const requestEmailChangeCode = async (newEmail: string) => {
    if (!currentUser || !userProfile) throw new Error('Not logged in.');
    const oldEmail = (userProfile.email || currentUser.email || '').trim().toLowerCase();
    const targetNewEmail = newEmail.trim().toLowerCase();
    if (!oldEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(oldEmail)) {
      throw new Error('Your current account email is invalid.');
    }
    if (!targetNewEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetNewEmail)) {
      throw new Error('Please enter a valid new email address.');
    }
    if (targetNewEmail === oldEmail) {
      throw new Error('New email must be different from your current email.');
    }

    await ensureEmailAvailableForUid(targetNewEmail, currentUser.uid);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.currentUser && auth.currentUser.uid === currentUser.uid) {
      const idToken = await auth.currentUser.getIdToken(true).catch(() => '');
      if (idToken) headers.Authorization = `Bearer ${idToken}`;
    }

    const resp = await fetch('/api/auth/send-email-change-code', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        uid: currentUser.uid,
        currentEmail: oldEmail,
        newEmail: targetNewEmail,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err: any = new Error(data.error || 'Could not send verification code to your current email.');
      err.code = data.code;
      throw err;
    }
    return { ok: true, sentTo: String(data.sentTo || oldEmail) };
  };

  const verifyEmailChangeCode = async (newEmail: string, code: string) => {
    if (!currentUser || !userProfile) throw new Error('Not logged in.');
    const oldEmail = (userProfile.email || currentUser.email || '').trim().toLowerCase();
    const targetNewEmail = newEmail.trim().toLowerCase();
    const cleanCode = code.trim();
    if (!cleanCode) throw new Error('Please enter the 6-digit code sent to your current email.');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.currentUser && auth.currentUser.uid === currentUser.uid) {
      const idToken = await auth.currentUser.getIdToken(true).catch(() => '');
      if (idToken) headers.Authorization = `Bearer ${idToken}`;
    }

    const resp = await fetch('/api/auth/verify-email-change-code', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        uid: currentUser.uid,
        currentEmail: oldEmail,
        newEmail: targetNewEmail,
        code: cleanCode,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.emailChangeToken) {
      throw new Error(data.error || 'Incorrect or expired verification code.');
    }
    return String(data.emailChangeToken);
  };

  const requiresFreshGoogleReauth = (): boolean => {
    const fbUser = auth.currentUser;
    if (!fbUser) return false;
    const hasGoogle = Boolean(fbUser.providerData?.some((p) => p.providerId === 'google.com'));
    const hasPassword = Boolean(fbUser.providerData?.some((p) => p.providerId === 'password'));
    if (!hasGoogle || hasPassword) return false;
    const lastSignInMs = fbUser.metadata?.lastSignInTime
      ? new Date(fbUser.metadata.lastSignInTime).getTime()
      : 0;
    return !lastSignInMs || Date.now() - lastSignInMs > 4 * 60 * 1000;
  };

  // Must be invoked synchronously at the very start of a click handler (before any await)
  // so browsers do not block the Google re-auth popup with auth/popup-blocked.
  const reauthenticateWithGoogle = async (): Promise<void> => {
    const fbUser = auth.currentUser;
    if (!fbUser) {
      throw new Error(
        'Please sign in once with your password or Google to verify your Firebase session before changing your email.'
      );
    }
    try {
      await reauthenticateWithPopup(fbUser, new GoogleAuthProvider());
      await backupCurrentFirebaseSession(fbUser).catch(() => {});
    } catch (err: any) {
      if (err?.code === 'auth/popup-blocked') {
        const e: any = new Error('POPUP_BLOCKED_REAUTH');
        e.code = 'POPUP_BLOCKED_REAUTH';
        throw e;
      }
      throw err;
    }
  };

  const requestPasswordResetCode = async (email: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) throw new Error('Please enter your email address.');
    const resp = await fetch('/api/auth/send-reset-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err: any = new Error(data.error || 'Could not send verification code.');
      err.code = data.code;
      throw err;
    }
    return data as { ok: boolean; emailSent?: boolean };
  };

  const verifyPasswordResetCode = async (email: string, code: string) => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();
    const resp = await fetch('/api/auth/verify-reset-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, code: cleanCode }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.resetToken) {
      throw new Error(data.error || 'Invalid or expired verification code.');
    }
    return String(data.resetToken);
  };

  const completePasswordResetWithToken = async (
    email: string,
    resetToken: string,
    newPassword: string
  ) => {
    const cleanEmail = email.trim().toLowerCase();
    const resp = await fetch('/api/auth/complete-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, resetToken, newPassword }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err: any = new Error(data.error || 'Failed to update password.');
      err.code = data.code;
      throw err;
    }
    if (data.passwordVersion) {
      // Clear stale local version for any saved account matching this email so the next one-time login records it
      const matchedSaved = readSavedAccounts().find(
        (a) => a.email && a.email.trim().toLowerCase() === cleanEmail
      );
      if (matchedSaved) {
        storePasswordVersion(matchedSaved.uid, Number(data.passwordVersion));
      }
    }
  };

  const signOut = async () => {
    if (auth.currentUser) {
      await backupCurrentFirebaseSession(auth.currentUser).catch(() => {});
    }
    localStorage.removeItem(LOCAL_SESSION_KEY);
    await firebaseSignOut(auth).catch(() => {});
    setFirebaseAuthUser(null);
    setServerVerifiedRole(null);
    setCurrentUser(null);
    setUserProfile(null);
    setIsAddingAccount(false);
  };

  const deleteAccount = async () => {
    if (!currentUser) return;
    const uid = currentUser.uid;
    const userEmail = (userProfile?.email || currentUser.email || '').trim().toLowerCase();

    // 1. Delete user's subcollections (devices & blocked)
    try {
      const devSnap = await getDocs(collection(db, 'users', uid, 'devices'));
      await Promise.all(devSnap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
    } catch {}
    try {
      const blkSnap = await getDocs(collection(db, 'users', uid, 'blocked'));
      await Promise.all(blkSnap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
    } catch {}

    // 2. Delete user's posts, stories, follows & notifications
    try {
      const postsSnap = await getDocs(query(collection(db, 'posts'), where('authorId', '==', uid)));
      await Promise.all(postsSnap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
    } catch {}
    try {
      const storiesSnap = await getDocs(query(collection(db, 'stories'), where('authorId', '==', uid)));
      await Promise.all(storiesSnap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
    } catch {}
    try {
      const f1Snap = await getDocs(query(collection(db, 'follows'), where('followerId', '==', uid)));
      const f2Snap = await getDocs(query(collection(db, 'follows'), where('followingId', '==', uid)));
      await Promise.all([
        ...f1Snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})),
        ...f2Snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})),
      ]);
    } catch {}
    try {
      const nSnap = await getDocs(query(collection(db, 'notifications'), where('recipientId', '==', uid)));
      await Promise.all(nSnap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
    } catch {}

    // 3. Release email lock + username lock and delete main user profile document
    if (userEmail) {
      await deleteDoc(doc(db, 'emailLocks', emailToRegistryId(userEmail))).catch(() => {});
    }
    if (userProfile?.username) {
      await releaseUsernameLock(userProfile.username).catch(() => {});
    }
    await deleteDoc(doc(db, 'users', uid)).catch(() => {});

    // 4. Remove from local saved accounts & session caches
    removeSavedAccount(uid);
    localStorage.removeItem(LOCAL_SESSION_KEY);
    try {
      sessionStorage.removeItem(`ethio_2fa_ok_${uid}`);
      sessionStorage.removeItem(`ethio_applock_ok_${uid}`);
    } catch {}

    // 5. Permanently delete Firebase Auth user if signed in with Firebase Auth
    if (auth.currentUser && auth.currentUser.uid === uid) {
      try {
        await deleteUser(auth.currentUser);
      } catch (err: any) {
        if (
          err?.code === 'auth/requires-recent-login' &&
          auth.currentUser.providerData?.some((p) => p.providerId === 'google.com')
        ) {
          try {
            await reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider());
            await deleteUser(auth.currentUser);
          } catch {
            await firebaseSignOut(auth).catch(() => {});
          }
        } else {
          await firebaseSignOut(auth).catch(() => {});
        }
      }
    }

    setCurrentUser(null);
    setUserProfile(null);
    setIsAddingAccount(false);
  };

  const switchSavedAccount = async (account: SavedAccount) => {
    if (account.uid === currentUser?.uid) return;

    // 1. Check live server passwordVersion to detect if password changed on another device
    try {
      const userSnap = await getDocFromServer(doc(db, 'users', account.uid)).catch(() =>
        getDoc(doc(db, 'users', account.uid))
      );
      if (userSnap && userSnap.exists()) {
        const remoteProf = userSnap.data() as UserProfile;
        const remoteVer = Number(remoteProf.passwordVersion || 0);
        const knownVer = getStoredPasswordVersion(account.uid) || Number(account.passwordVersion || 0);
        if (remoteVer > 0 && knownVer > 0 && remoteVer !== knownVer) {
          // Password changed from another device — require one-time login for security
          await clearAccountVaultSession(account.uid).catch(() => {});
          await firebaseSignOut(auth).catch(() => {});
          localStorage.removeItem(LOCAL_SESSION_KEY);
          setPendingReauth({ email: remoteProf.email || account.email, reason: 'password_changed' });
          setCurrentUser(null);
          setUserProfile(null);
          return;
        }
        if (remoteVer > 0 && knownVer === 0) {
          storePasswordVersion(account.uid, remoteVer);
        }
      }
    } catch {
      // ignore offline check
    }

    // 2. Keep active Firebase session if already logged in as this UID
    if (auth.currentUser && auth.currentUser.uid === account.uid) {
      localStorage.removeItem(LOCAL_SESSION_KEY);
      await backupCurrentFirebaseSession(auth.currentUser).catch(() => {});
      setFirebaseAuthUser(auth.currentUser);
      setCurrentUser(auth.currentUser);
      setPendingReauth(null);
      setIsAddingAccount(false);
      return;
    }

    // 3. Ensure current Firebase session is safely backed up to the vault before switching away
    if (auth.currentUser) {
      await backupCurrentFirebaseSession(auth.currentUser).catch(() => {});
    }

    // 4. Restore this saved account's vaulted Firebase Auth session directly (no password prompt!)
    const restoredUser = await restoreAccountFirebaseSession(account.uid);
    if (restoredUser && restoredUser.uid === account.uid) {
      localStorage.removeItem(LOCAL_SESSION_KEY);
      setFirebaseAuthUser(restoredUser);
      setCurrentUser(restoredUser);
      setPendingReauth(null);
      setIsAddingAccount(false);
      return;
    }

    // 5. Try server custom token if Firebase Admin ADC is active
    try {
      const tokenResp = await fetch('/api/auth/custom-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: account.uid }),
      });
      const tokenData = await tokenResp.json().catch(() => ({}));
      if (tokenData?.ok && tokenData?.customToken) {
        const cred = await signInWithCustomToken(auth, tokenData.customToken);
        localStorage.removeItem(LOCAL_SESSION_KEY);
        await backupCurrentFirebaseSession(cred.user).catch(() => {});
        setFirebaseAuthUser(cred.user);
        setCurrentUser(cred.user);
        setPendingReauth(null);
        setIsAddingAccount(false);
        return;
      }
    } catch {
      // fall through to saved device session switch
    }

    // 6. Legacy saved account on this phone without an IndexedDB vault yet:
    // Switch seamlessly without asking for password again (while keeping any other vaulted Firebase sessions intact
    // and keeping hasVerifiedFirebaseSession = false for server-verified RBAC).
    await firebaseSignOut(auth).catch(() => {});
    try {
      localStorage.setItem(
        LOCAL_SESSION_KEY,
        JSON.stringify({ uid: account.uid, email: account.email })
      );
    } catch {
      // ignore
    }
    setFirebaseAuthUser(null);
    setServerVerifiedRole(null);
    setPendingReauth(null);
    setIsAddingAccount(false);
    setCurrentUser({
      uid: account.uid,
      email: account.email,
      displayName: account.displayName,
      photoURL: account.photoURL,
    } as unknown as FirebaseUser);
  };

  const removeSavedAccount = (uid: string) => {
    const next = readSavedAccounts().filter((a) => a.uid !== uid);
    try {
      localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    setSavedAccounts(next);
    clearAccountVaultSession(uid).catch(() => {});
    try {
      const raw = localStorage.getItem(LOCAL_SESSION_KEY);
      if (raw && JSON.parse(raw)?.uid === uid) {
        localStorage.removeItem(LOCAL_SESSION_KEY);
      }
    } catch {
      // ignore
    }
  };

  // Edit Profile & Preferences functionality
  const updateUserProfileData = async (updates: {
    username?: string;
    displayName?: string;
    photoURL?: string;
    coverURL?: string;
    bio?: string;
    email?: string;
    emailChangeToken?: string;
    currentPassword?: string;
    newPassword?: string;
    closeFriendsExcludedIds?: string[];
    selectedFriendIds?: string[];
    lastSeenVisibility?: 'everyone' | 'followers' | 'nobody';
    readReceiptsEnabled?: boolean;
    twoStepEnabled?: boolean;
    twoStepPin?: string;
    appLockEnabled?: boolean;
    appLockPin?: string;
    fontStyle?: string;
    fingerprintLockEnabled?: boolean;
    fingerprintCredentialId?: string;
    chatWallpaper?: string;
    chatFontSize?: 'small' | 'medium' | 'large';
    messageReactionsEnabled?: boolean;
    autoDownloadMedia?: boolean;
    lastBackupAt?: string;
  }) => {
    if (!currentUser || !userProfile) throw new Error('Not logged in');

    const firestoreUpdates: Partial<UserProfile> = {
      updatedAt: new Date().toISOString()
    };

    let oldUsernameToRelease: string | null = null;
    if (updates.username !== undefined) {
      const cleanNewUsername = updates.username.trim().replace(/^@+/, '').toLowerCase();
      if (!/^[a-z0-9_]{3,30}$/.test(cleanNewUsername)) {
        throw new Error('Username must be 3–30 characters using only letters, numbers, and underscores (_).');
      }
      if (cleanNewUsername !== (userProfile.username || '').trim().toLowerCase()) {
        await ensureUsernameAvailableForUid(cleanNewUsername, currentUser.uid);
        await claimUsernameLock(cleanNewUsername, currentUser.uid);
        oldUsernameToRelease = userProfile.username || null;
        firestoreUpdates.username = cleanNewUsername;
      }
    }

    if (updates.displayName && updates.displayName.trim() !== '') {
      firestoreUpdates.displayName = updates.displayName.trim();
      try {
        if (auth.currentUser && auth.currentUser.uid === currentUser.uid) {
          await updateProfile(auth.currentUser, { displayName: updates.displayName.trim() });
        }
      } catch {}
    }

    if (updates.photoURL) {
      firestoreUpdates.photoURL = updates.photoURL;
      try {
        if (auth.currentUser && auth.currentUser.uid === currentUser.uid) {
          await updateProfile(auth.currentUser, { photoURL: updates.photoURL });
        }
      } catch {}
    }

    if (updates.coverURL !== undefined) {
      firestoreUpdates.coverURL = updates.coverURL;
    }

    if (updates.bio !== undefined) {
      firestoreUpdates.bio = updates.bio.trim();
    }

    if (updates.closeFriendsExcludedIds !== undefined) {
      firestoreUpdates.closeFriendsExcludedIds = updates.closeFriendsExcludedIds;
    }

    if (updates.selectedFriendIds !== undefined) {
      firestoreUpdates.selectedFriendIds = updates.selectedFriendIds;
    }

    if (updates.lastSeenVisibility !== undefined) {
      firestoreUpdates.lastSeenVisibility = updates.lastSeenVisibility;
    }

    if (updates.readReceiptsEnabled !== undefined) {
      firestoreUpdates.readReceiptsEnabled = updates.readReceiptsEnabled;
    }

    if (updates.twoStepEnabled !== undefined) {
      firestoreUpdates.twoStepEnabled = updates.twoStepEnabled;
    }

    if (updates.twoStepPin !== undefined) {
      firestoreUpdates.twoStepPin = updates.twoStepPin;
    }

    if (updates.appLockEnabled !== undefined) {
      firestoreUpdates.appLockEnabled = updates.appLockEnabled;
    }

    if (updates.appLockPin !== undefined) {
      firestoreUpdates.appLockPin = updates.appLockPin;
    }

    if (updates.fontStyle !== undefined) {
      firestoreUpdates.fontStyle = updates.fontStyle;
    }

    if (updates.fingerprintLockEnabled !== undefined) {
      firestoreUpdates.fingerprintLockEnabled = updates.fingerprintLockEnabled;
    }

    if (updates.fingerprintCredentialId !== undefined) {
      firestoreUpdates.fingerprintCredentialId = updates.fingerprintCredentialId;
    }

    if (updates.chatWallpaper !== undefined) {
      firestoreUpdates.chatWallpaper = updates.chatWallpaper;
    }

    if (updates.chatFontSize !== undefined) {
      firestoreUpdates.chatFontSize = updates.chatFontSize;
    }

    if (updates.messageReactionsEnabled !== undefined) {
      firestoreUpdates.messageReactionsEnabled = updates.messageReactionsEnabled;
    }

    if (updates.autoDownloadMedia !== undefined) {
      firestoreUpdates.autoDownloadMedia = updates.autoDownloadMedia;
    }

    if (updates.lastBackupAt !== undefined) {
      firestoreUpdates.lastBackupAt = updates.lastBackupAt;
    }

    let emailVerificationLinkSent = false;

    if (updates.email !== undefined) {
      const normalizedNewEmail = updates.email.trim().toLowerCase();
      const oldNormalizedEmail = (userProfile.email || currentUser.email || '').trim().toLowerCase();
      if (normalizedNewEmail && normalizedNewEmail !== oldNormalizedEmail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedNewEmail)) {
          throw new Error('Please enter a valid new email address.');
        }
        if (!updates.emailChangeToken) {
          throw new Error('EMAIL_CHANGE_VERIFICATION_REQUIRED');
        }
        await ensureEmailAvailableForUid(normalizedNewEmail, currentUser.uid);

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (auth.currentUser && auth.currentUser.uid === currentUser.uid) {
          const idToken = await auth.currentUser.getIdToken(true).catch(() => '');
          if (idToken) headers.Authorization = `Bearer ${idToken}`;
        }

        const completeResp = await fetch('/api/auth/complete-email-change', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            uid: currentUser.uid,
            currentEmail: oldNormalizedEmail,
            newEmail: normalizedNewEmail,
            emailChangeToken: updates.emailChangeToken,
            stage: 'prepare',
          }),
        });
        const completeData = await completeResp.json().catch(() => ({}));
        if (!completeResp.ok) {
          throw new Error(completeData.error || 'Could not complete email change verification.');
        }

        const applyClientEmailUpdate = async (userObj: FirebaseUser) => {
          try {
            await updateEmail(userObj, normalizedNewEmail);
          } catch (innerErr: any) {
            if (innerErr?.code === 'auth/email-already-in-use') {
              throw new Error('EMAIL_ALREADY_IN_USE');
            }
            if (innerErr?.code === 'auth/operation-not-allowed') {
              // Do NOT swallow auth/requires-recent-login here — let reauth run and retry!
              await verifyBeforeUpdateEmail(userObj, normalizedNewEmail);
              emailVerificationLinkSent = true;
              return;
            }
            throw innerErr;
          }
        };

        if (!completeData.authUpdatedOnServer) {
          if (!auth.currentUser || auth.currentUser.uid !== currentUser.uid) {
            throw new Error(
              'Please sign in once with your password or Google to verify your Firebase session before changing your email.'
            );
          }
          try {
            await applyClientEmailUpdate(auth.currentUser);
          } catch (err: any) {
            if (err?.message === 'EMAIL_ALREADY_IN_USE') {
              throw err;
            }
            if (err?.code === 'auth/requires-recent-login') {
              const hasPasswordProvider = auth.currentUser.providerData?.some(
                (p) => p.providerId === 'password'
              );
              const hasGoogleProvider = auth.currentUser.providerData?.some(
                (p) => p.providerId === 'google.com'
              );
              if (updates.currentPassword && oldNormalizedEmail && hasPasswordProvider) {
                const cred = EmailAuthProvider.credential(oldNormalizedEmail, updates.currentPassword);
                await reauthenticateWithCredential(auth.currentUser, cred);
                await applyClientEmailUpdate(auth.currentUser);
              } else if (hasGoogleProvider && !hasPasswordProvider) {
                // Do NOT call reauthenticateWithPopup after multiple async awaits — browsers block popups
                // once the user-gesture window expires. Ask the UI button to trigger reauthenticateWithGoogle() synchronously!
                const reauthErr: any = new Error('GOOGLE_REAUTH_REQUIRED');
                reauthErr.code = 'GOOGLE_REAUTH_REQUIRED';
                throw reauthErr;
              } else {
                throw new Error(
                  'Please enter your Current Password below to confirm updating your login email.'
                );
              }
            } else if (err?.code === 'auth/popup-blocked') {
              const popErr: any = new Error('POPUP_BLOCKED_REAUTH');
              popErr.code = 'POPUP_BLOCKED_REAUTH';
              throw popErr;
            } else {
              throw err;
            }
          }

          // Commit & consume the verified email change token only after Firebase Auth update succeeded
          await fetch('/api/auth/complete-email-change', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              uid: currentUser.uid,
              currentEmail: oldNormalizedEmail,
              newEmail: normalizedNewEmail,
              emailChangeToken: updates.emailChangeToken,
              stage: 'commit',
            }),
          }).catch(() => {});
        }

        await claimEmailLock(normalizedNewEmail, currentUser.uid);
        if (oldNormalizedEmail) {
          await deleteDoc(doc(db, 'emailLocks', emailToRegistryId(oldNormalizedEmail))).catch(() => {});
        }
        firestoreUpdates.email = normalizedNewEmail;
        if (auth.currentUser && auth.currentUser.uid === currentUser.uid) {
          await backupCurrentFirebaseSession(auth.currentUser).catch(() => {});
        }
      }
    }

    if (updates.newPassword !== undefined && updates.newPassword !== '') {
      const pwCheck = validateStrongPassword(updates.newPassword);
      if (!pwCheck.valid) {
        throw new Error(pwCheck.error || 'Password does not meet security requirements.');
      }

      const activeFirebaseUser =
        auth.currentUser && auth.currentUser.uid === currentUser.uid
          ? auth.currentUser
          : null;
      if (!activeFirebaseUser) {
        throw new Error(
          'Please sign in once with your password or Google to verify your session before changing your password.'
        );
      }

      const authEmail = (userProfile.email || activeFirebaseUser.email || '').trim().toLowerCase();
      const hasPasswordProvider = activeFirebaseUser.providerData?.some(
        (p) => p.providerId === 'password'
      );

      if (updates.currentPassword && authEmail && hasPasswordProvider) {
        try {
          const cred = EmailAuthProvider.credential(authEmail, updates.currentPassword);
          await reauthenticateWithCredential(activeFirebaseUser, cred);
        } catch (reauthErr: any) {
          if (
            reauthErr?.code === 'auth/wrong-password' ||
            reauthErr?.code === 'auth/invalid-credential'
          ) {
            throw new Error('Current password is incorrect.');
          }
          throw reauthErr;
        }
      }

      try {
        await updatePassword(activeFirebaseUser, updates.newPassword);
      } catch (pwErr: any) {
        if (pwErr?.code === 'auth/requires-recent-login') {
          if (!hasPasswordProvider && activeFirebaseUser.providerData?.some((p) => p.providerId === 'google.com')) {
            await reauthenticateWithPopup(activeFirebaseUser, new GoogleAuthProvider());
            await updatePassword(activeFirebaseUser, updates.newPassword);
          } else {
            throw new Error('Please enter your Current Password above to confirm your password change.');
          }
        } else {
          throw pwErr;
        }
      }

      const nextPwVer = Date.now();
      storePasswordVersion(currentUser.uid, nextPwVer);
      firestoreUpdates.passwordVersion = nextPwVer;
      await backupCurrentFirebaseSession(activeFirebaseUser).catch(() => {});
    }

    await updateDoc(doc(db, 'users', currentUser.uid), firestoreUpdates).catch(async () => {
      await setDoc(doc(db, 'users', currentUser.uid), { ...userProfile, ...firestoreUpdates });
    });

    if (oldUsernameToRelease && firestoreUpdates.username && oldUsernameToRelease.toLowerCase() !== firestoreUpdates.username.toLowerCase()) {
      await releaseUsernameLock(oldUsernameToRelease).catch(() => {});
    }

    const nextProfile = { ...userProfile, ...firestoreUpdates };
    setUserProfile(nextProfile);

    const existingSaved = readSavedAccounts().find((a) => a.uid === currentUser.uid);
    if (existingSaved) {
      setSavedAccounts(
        persistSavedAccount({
          ...existingSaved,
          username: nextProfile.username,
          displayName: nextProfile.displayName,
          email: nextProfile.email,
          photoURL: nextProfile.photoURL,
          passwordVersion: nextProfile.passwordVersion || existingSaved.passwordVersion,
        })
      );
    }

    return { emailVerificationLinkSent };
  };

  // Toggle Online / Offline Privacy Visibility
  const toggleHideOnlineStatus = async () => {
    if (!currentUser || !userProfile) return;
    const nextHidden = !Boolean(userProfile.hideOnlineStatus);
    setUserProfile((prev) => (prev ? { ...prev, hideOnlineStatus: nextHidden } : null));
    await updateDoc(doc(db, 'users', currentUser.uid), {
      hideOnlineStatus: nextHidden,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  };

  // Follow user
  const followUser = async (targetUserId: string) => {
    if (!currentUser || !userProfile || targetUserId === currentUser.uid) return;
    const followId = `${currentUser.uid}_${targetUserId}`;
    const followDocRef = doc(db, 'follows', followId);

    const followData: FollowRecord = {
      followId,
      followerId: currentUser.uid,
      followingId: targetUserId,
      createdAt: new Date().toISOString()
    };

    await setDoc(followDocRef, followData).catch(() => {});

    await updateDoc(doc(db, 'users', targetUserId), {
      followersCount: increment(1)
    }).catch(() => {});

    await updateDoc(doc(db, 'users', currentUser.uid), {
      followingCount: increment(1)
    }).catch(() => {});

    const isFollowBack = followerIds.has(targetUserId);
    await createAppNotification({
      recipientId: targetUserId,
      actor: userProfile,
      type: isFollowBack ? 'follow_back' : 'follow',
      text: isFollowBack ? 'followed you back' : 'started following you',
    });
  };

  // Unfollow user
  const unfollowUser = async (targetUserId: string) => {
    if (!currentUser || targetUserId === currentUser.uid) return;
    const followId = `${currentUser.uid}_${targetUserId}`;
    const followDocRef = doc(db, 'follows', followId);

    await deleteDoc(followDocRef).catch(() => {});

    await updateDoc(doc(db, 'users', targetUserId), {
      followersCount: increment(-1)
    }).catch(() => {});

    await updateDoc(doc(db, 'users', currentUser.uid), {
      followingCount: increment(-1)
    }).catch(() => {});
  };

  // Block / Unblock
  const blockUser = async (target: { userId: string; username: string; displayName: string; photoURL?: string }) => {
    if (!currentUser || target.userId === currentUser.uid) return;
    const record: BlockedUserRecord = {
      blockedUserId: target.userId,
      username: target.username,
      displayName: target.displayName,
      ...(target.photoURL ? { photoURL: target.photoURL } : {}),
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'users', currentUser.uid, 'blocked', target.userId), record);
  };

  const unblockUser = async (targetUserId: string) => {
    if (!currentUser) return;
    await deleteDoc(doc(db, 'users', currentUser.uid, 'blocked', targetUserId));
  };

  // Remove device session
  const removeDevice = async (deviceId: string) => {
    if (!currentUser) return;
    await deleteDoc(doc(db, 'users', currentUser.uid, 'devices', deviceId));
    if (deviceId === currentDeviceId) {
      await signOut();
    }
  };

  // Notifications Read
  const markNotificationRead = async (notificationId: string) => {
    await updateDoc(doc(db, 'notifications', notificationId), { read: true }).catch(() => {});
  };

  const markAllNotificationsRead = async () => {
    const unread = notifications.filter((n) => !n.read);
    await Promise.all(
      unread.map((n) => updateDoc(doc(db, 'notifications', n.notificationId), { read: true }).catch(() => {}))
    );
  };

  const unreadNotificationsCount = notifications.filter((n) => !n.read).length;

  const hasVerifiedFirebaseSession = Boolean(
    firebaseAuthUser &&
      currentUser &&
      firebaseAuthUser.uid === currentUser.uid &&
      auth.currentUser &&
      auth.currentUser.uid === currentUser.uid
  );
  const userRole: AppRole =
    hasVerifiedFirebaseSession &&
    serverVerifiedRole &&
    serverVerifiedRole.uid === currentUser?.uid
      ? serverVerifiedRole.role
      : 'user';
  const isOwner = hasVerifiedFirebaseSession && userRole === 'owner';
  const isAdmin = hasVerifiedFirebaseSession && userRole === 'admin';

  const isUserGoldVerified = React.useCallback(
    (userId?: string | null) => {
      if (!userId) return false;
      return isSubscriptionActive(subscriptionsMap[userId], nowTickMs);
    },
    [subscriptionsMap, nowTickMs]
  );

  const getUserSubscription = React.useCallback(
    (userId?: string | null) => {
      if (!userId) return null;
      return subscriptionsMap[userId] || null;
    },
    [subscriptionsMap]
  );

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        loading,
        signIn,
        signUp,
        requestSignUpCode,
        verifySignUpCode,
        signInWithGoogle,
        signInWithGoogleCredential,
        resetPassword,
        requestPasswordResetCode,
        verifyPasswordResetCode,
        completePasswordResetWithToken,
        checkUsernameAvailability,
        requestEmailChangeCode,
        verifyEmailChangeCode,
        requiresFreshGoogleReauth,
        reauthenticateWithGoogle,
        signOut,
        deleteAccount,
        updateUserProfileData,
        toggleHideOnlineStatus,
        followUser,
        unfollowUser,
        followingIds,
        followerIds,
        incomingFollowRecords,
        allUsers,
        savedAccounts,
        isAddingAccount,
        openAddAccount: () => setIsAddingAccount(true),
        closeAddAccount: () => setIsAddingAccount(false),
        switchSavedAccount,
        removeSavedAccount,
        pendingReauth,
        clearPendingReauth: () => setPendingReauth(null),
        refreshDirectory,
        blockedUsers,
        blockedIds,
        blockUser,
        unblockUser,
        devices,
        currentDeviceId,
        removeDevice,
        notifications,
        unreadNotificationsCount,
        markNotificationRead,
        markAllNotificationsRead,
        userRole,
        isOwner,
        isAdmin,
        hasVerifiedFirebaseSession,
        subscriptionConfig,
        adminEmails,
        subscriptionsMap,
        isUserGoldVerified,
        getUserSubscription,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
