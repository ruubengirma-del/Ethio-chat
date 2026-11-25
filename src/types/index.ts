export type MediaType = 'none' | 'image' | 'video';
export type MessageType = 'text' | 'image' | 'audio' | 'video' | 'file' | 'post';
export type MessageStatus = 'pending' | 'sent' | 'error';
export type AppLanguage = 'en' | 'om' | 'am';
export type AudienceVisibility = 'public' | 'private' | 'close_friends' | 'select_friends';

export interface UserProfile {
  userId: string;
  username: string;
  displayName: string;
  email: string;
  photoURL?: string;
  coverURL?: string;
  bio?: string;
  followersCount: number;
  followingCount: number;
  hideOnlineStatus?: boolean;
  profileViewsCount?: number;
  closeFriendsExcludedIds?: string[];
  selectedFriendIds?: string[];
  lastSeenAt?: string;
  lastSeenVisibility?: 'everyone' | 'followers' | 'nobody';
  readReceiptsEnabled?: boolean;
  twoStepEnabled?: boolean;
  twoStepPin?: string;
  appLockEnabled?: boolean;
  appLockPin?: string;
  chatWallpaper?: string;
  chatFontSize?: 'small' | 'medium' | 'large';
  fontStyle?: string;
  fingerprintLockEnabled?: boolean;
  fingerprintCredentialId?: string;
  messageReactionsEnabled?: boolean;
  autoDownloadMedia?: boolean;
  lastBackupAt?: string;
  // Moderation, Warning, Suspension & Monthly Share Auto-Lift
  reportsCount?: number;
  warningActive?: boolean;
  warningReasons?: string[];
  warningTriggeredAt?: string;
  warningClearedReason?: string;
  accountSuspended?: boolean;
  suspendedAt?: string;
  monthlySharesCount?: number;
  monthlySharesMonth?: string;
  passwordVersion?: number;
  isPremium?: boolean;
  goldVerified?: boolean;
  subscriptionStatus?: SubscriptionStatus;
  premiumStatus?: SubscriptionStatus;
  subscriptionPackage?: string;
  subscriptionStartDate?: string;
  premiumStartDate?: string;
  subscriptionExpiresAt?: string;
  premiumExpiryDate?: string;
  subscriptionDuration?: number;
  approvedPaymentId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Post {
  postId: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorPhotoURL?: string;
  content: string;
  mediaUrl?: string;
  mediaType: MediaType;
  previewPhotos?: string[];
  totalPhotosCount?: number;
  visibility?: AudienceVisibility;
  excludedUserIds?: string[];
  allowedUserIds?: string[];
  commentsDisabled?: boolean;
  groupId?: string;
  groupName?: string;
  likesCount: number;
  commentsCount: number;
  sharesCount?: number;
  viewsCount?: number;
  reportsCount?: number;
  editedAt?: string;
  createdAt: string;
  hasLiked?: boolean;
}

export interface SocialGroup {
  groupId: string;
  name: string;
  nameLower: string;
  description?: string;
  photoURL?: string;
  ownerId: string;
  adminIds: string[];
  memberIds: string[];
  memberCount: number;
  postingLocked?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PostPhoto {
  photoId: string;
  postId: string;
  orderIndex: number;
  mediaUrl: string;
  likesCount: number;
  commentsCount: number;
  createdAt: string;
}

export interface PostPhotoLike {
  userId: string;
  photoId: string;
  username?: string;
  displayName?: string;
  photoURL?: string;
  createdAt: string;
}

export interface PostLike {
  userId: string;
  postId: string;
  username?: string;
  displayName?: string;
  photoURL?: string;
  createdAt: string;
}

export interface Comment {
  commentId: string;
  postId: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorPhotoURL?: string;
  text: string;
  mediaUrl?: string;
  mediaType?: 'none' | 'image' | 'audio';
  audioDuration?: number;
  mentions?: string[];
  parentCommentId?: string;
  replyToAuthorId?: string;
  replyToUsername?: string;
  reactions?: Record<string, string[]>;
  editedAt?: string;
  createdAt: string;
}

export interface Story {
  storyId: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorPhotoURL?: string;
  content: string;
  mediaUrl?: string;
  mediaType: MediaType;
  bgGradient?: string;
  visibility: AudienceVisibility;
  excludedUserIds?: string[];
  allowedUserIds?: string[];
  viewsCount?: number;
  editedAt?: string;
  createdAt: string;
  expiresAt: string;
}

export interface StoryView {
  viewerId: string;
  storyId: string;
  viewerUsername: string;
  viewerDisplayName: string;
  viewerPhotoURL?: string;
  reactionEmoji?: string;
  viewedAt: string;
  updatedAt?: string;
}

export interface PostReport {
  reportId: string;
  postId: string;
  postAuthorId: string;
  postAuthorUsername: string;
  postAuthorDisplayName: string;
  postContentSnippet?: string;
  reporterId: string;
  reporterUsername: string;
  reporterDisplayName: string;
  reason: string;
  details?: string;
  photoEvidenceUrl?: string;
  videoEvidenceUrl?: string;
  recipientEmail: string;
  emailSent?: boolean;
  createdAt: string;
}

export interface AccountAppeal {
  appealId: string;
  userId: string;
  username: string;
  displayName: string;
  email: string;
  message: string;
  photoEvidenceUrl?: string;
  videoEvidenceUrl?: string;
  reportedReasons?: string[];
  reportsCountAtAppeal?: number;
  status: 'pending' | 'approved' | 'rejected';
  recipientEmail: string;
  emailSent?: boolean;
  createdAt: string;
  reviewedAt?: string;
}

export interface FollowRecord {
  followId: string;
  followerId: string;
  followingId: string;
  createdAt: string;
}

export interface ChatParticipant {
  userId: string;
  username: string;
  displayName: string;
  photoURL?: string;
}

export interface ChatRoom {
  chatId: string;
  participantIds: string[];
  participants?: Record<string, ChatParticipant>;
  isGroup?: boolean;
  groupName?: string;
  groupDescription?: string;
  groupAvatar?: string;
  createdBy?: string;
  adminIds?: string[];
  postingLocked?: boolean;
  isPublic?: boolean;
  lastMessage: string;
  lastMessageTime: string;
  lastSenderId: string;
  unreadCount?: number;
  unreadCounts?: Record<string, number>;
  updatedAt: string;
}

export interface ChatMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName?: string;
  senderPhotoURL?: string;
  receiverId: string;
  type: MessageType;
  text: string;
  mediaUrl?: string;
  audioDuration?: number;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  preventDownload?: boolean;
  sharedPostId?: string;
  sharedPostAuthorId?: string;
  sharedPostAuthorName?: string;
  sharedPostAuthorUsername?: string;
  sharedPostAuthorPhoto?: string;
  sharedPostContent?: string;
  sharedPostMediaUrl?: string;
  sharedPostMediaType?: MediaType;
  status: MessageStatus;
  deletedFor?: string[];
  editedAt?: string;
  readBy?: string[];
  readAt?: string;
  reactions?: Record<string, string[]>;
  expiresAfterSeconds?: number;
  expiresAt?: string;
  createdAt: string;
  localId?: string;
}

export interface OfflineQueuedMessage {
  localId: string;
  chatId: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName?: string;
  senderPhotoURL?: string;
  receiverId: string;
  type: MessageType;
  text: string;
  mediaUrl?: string;
  audioDuration?: number;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  preventDownload?: boolean;
  sharedPostId?: string;
  sharedPostAuthorId?: string;
  sharedPostAuthorName?: string;
  sharedPostAuthorUsername?: string;
  sharedPostAuthorPhoto?: string;
  sharedPostContent?: string;
  sharedPostMediaUrl?: string;
  sharedPostMediaType?: MediaType;
  expiresAfterSeconds?: number;
  timestamp: number;
  retryCount: number;
}

export type TeamRole = 'owner' | 'admin' | 'member';
export type TeamMessageType = 'text' | 'image' | 'video' | 'audio' | 'pdf';

export interface TeamLiveRoomState {
  active: boolean;
  mode: 'voice' | 'video';
  liveCommentsEnabled: boolean;
  startedBy?: string;
  startedAt?: string;
}

export interface Team {
  teamId: string;
  name: string;
  nameLower: string;
  description?: string;
  photoURL?: string;
  isPublic: boolean;
  teamUsername?: string;
  teamUsernameLower?: string;
  ownerId: string;
  adminIds: string[];
  memberCount: number;
  maxMembers?: number;
  messagingLocked?: boolean;
  lastMessage?: string;
  lastMessageTime?: string;
  lastSenderId?: string;
  liveRoom?: TeamLiveRoomState;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  userId: string;
  teamId: string;
  username: string;
  displayName: string;
  photoURL?: string;
  role: TeamRole;
  joinedAt: string;
}

export interface TeamMessage {
  messageId: string;
  teamId: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  senderPhotoURL?: string;
  type: TeamMessageType;
  text: string;
  mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  audioDuration?: number;
  preventDownload?: boolean;
  batchId?: string;
  batchIndex?: number;
  batchTotal?: number;
  replyToMessageId?: string;
  replyToSenderName?: string;
  replyToText?: string;
  reactions?: Record<string, string[]>;
  expiresAfterSeconds?: number;
  expiresAt?: string;
  createdAt: string;
}

export interface TeamLiveSeat {
  seatNumber: number; // 1..6 (1 = Owner ONLY, 2 rows x 3 columns)
  teamId: string;
  userId?: string | null;
  username?: string;
  displayName?: string;
  photoURL?: string;
  micMuted?: boolean;
  cameraOn?: boolean;
  cameraFacing?: 'user' | 'environment';
  updatedAt: string;
}

export interface TeamLiveSeatRequest {
  requestId: string;
  teamId: string;
  seatNumber: number; // 2..6
  userId: string;
  username: string;
  displayName: string;
  photoURL?: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: string;
}

export interface TeamLiveComment {
  commentId: string;
  teamId: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorPhotoURL?: string;
  text: string;
  photoUrl?: string;
  emoji?: string;
  createdAt: string;
}

export interface TeamLiveViewer {
  userId: string;
  teamId: string;
  username: string;
  displayName: string;
  lastPingAt: string;
}

export type NotificationType = 'like' | 'comment' | 'mention' | 'follow' | 'follow_back' | 'group' | 'team' | 'share' | 'warning' | 'subscription';

export interface FirestoreTimestampLike {
  toMillis?: () => number;
  seconds?: number;
  nanoseconds?: number;
}

export interface AppNotification {
  notificationId: string;
  recipientId: string;
  toUserId?: string;
  actorId: string;
  fromUserId?: string;
  actorUsername: string;
  fromUsername?: string;
  actorDisplayName: string;
  actorPhotoURL?: string;
  type: NotificationType;
  postId?: string;
  commentId?: string;
  chatId?: string;
  text?: string;
  read: boolean;
  createdAt: string | number | Date | FirestoreTimestampLike | null;
}

export interface ViewStatEvent {
  statId: string;
  targetUserId: string;
  viewerId: string;
  kind: 'profile' | 'post' | 'story';
  targetId: string;
  createdAt: string;
}

export interface DeviceSession {
  deviceId: string;
  userId: string;
  deviceName: string;
  platform: string;
  browser: string;
  lastActiveAt: string;
  createdAt: string;
}

export interface BlockedUserRecord {
  blockedUserId: string;
  username: string;
  displayName: string;
  photoURL?: string;
  createdAt: string;
}

export interface SavedAccount {
  uid: string;
  email: string;
  username: string;
  displayName: string;
  photoURL?: string;
  sessionType: 'local' | 'firebase';
  passwordVersion?: number;
}

export interface CallSession {
  callId: string;
  chatId: string;
  callerId: string;
  callerUsername: string;
  callerDisplayName: string;
  callerPhotoURL?: string;
  calleeId: string;
  calleeUsername: string;
  calleeDisplayName: string;
  calleePhotoURL?: string;
  callType: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'declined';
  offer?: { type: string; sdp: string };
  answer?: { type: string; sdp: string };
  createdAt: string;
  updatedAt: string;
}

export type AppRole = 'owner' | 'admin' | 'user';
export type PaymentMethod = 'telebirr' | 'cbe' | 'binance';
export type PaymentStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED';
export type SubscriptionStatus = 'active' | 'expired' | 'revoked';

export interface SubscriptionPackage {
  id: string;
  months: number;
  label: string;
  priceUsd: number;
  priceEtb: number;
}

export interface SubscriptionConfig {
  configId: 'subscription';
  packages: SubscriptionPackage[];
  telebirrAccountNumber: string;
  telebirrAccountName: string;
  cbeAccountNumber: string;
  cbeAccountName: string;
  binanceUid: string;
  binancePaymentLink?: string;
  binanceQrCodeUrl?: string;
  subscriptionsEnabled: boolean;
  requireScreenshot: boolean;
  updatedAt?: string;
  updatedByEmail?: string;
}

export interface AdminRolesConfig {
  configId: 'roles';
  ownerEmail: string;
  adminEmails: string[];
  updatedAt?: string;
  updatedByEmail?: string;
}

export interface UserSubscription {
  userId: string;
  username?: string;
  displayName?: string;
  packageId: string;
  packageLabel: string;
  durationMonths: number;
  subscriptionDuration?: number;
  status: SubscriptionStatus;
  premiumStatus?: SubscriptionStatus;
  startDate: string;
  premiumStartDate?: string;
  expiresAt: string;
  premiumExpiryDate?: string;
  expiresAtMs: number;
  paymentId: string;
  approvedPaymentId?: string;
  approvedByUid: string;
  approvedByEmail?: string;
  approvedByRole: 'owner' | 'admin';
  renewedAt?: string;
  expiredAt?: string;
  reminder7dPaymentId?: string;
  reminder1dPaymentId?: string;
  expiredNotifPaymentId?: string;
  updatedAt?: string;
}

export interface PaymentRequest {
  paymentId: string;
  uid?: string;
  userId: string;
  username: string;
  displayName: string;
  email: string;
  photoURL?: string;
  packageId: string;
  packageLabel: string;
  durationMonths: number;
  method: PaymentMethod;
  amountUsd: number;
  amountEtb: number;
  transactionId?: string;
  normalizedTransactionId?: string;
  screenshotUrl?: string;
  screenshotStoragePath?: string;
  screenshotId?: string;
  status: PaymentStatus;
  rejectionReason?: string;
  submittedAt: string;
  submittedAtMs?: number;
  reviewedAt?: string;
  reviewedByUid?: string;
  reviewedByEmail?: string;
  reviewedByRole?: 'owner' | 'admin';
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
}

export interface PaymentScreenshotRecord {
  paymentId: string;
  userId: string;
  imageDataUrl: string;
  mimeType: string;
  fileSize?: number;
  createdAt: string;
}

export type PaymentAuditAction =
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_REJECTED'
  | 'CONFIG_UPDATED'
  | 'ADMIN_ADDED'
  | 'ADMIN_REMOVED'
  | 'SUBSCRIPTION_EXPIRED'
  | 'SUBSCRIPTION_REVOKED';

export interface PaymentAuditLog {
  logId: string;
  action: PaymentAuditAction;
  paymentId?: string;
  targetUserId?: string;
  targetUsername?: string;
  actorUserId: string;
  actorEmail: string;
  actorRole: 'owner' | 'admin';
  details: string;
  rejectionReason?: string;
  createdAt: string;
}

