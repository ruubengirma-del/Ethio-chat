import { db, handleFirestoreError, OperationType } from './firebase';
import { doc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { OfflineQueuedMessage, ChatMessage } from '../types';

const STORAGE_KEY = 'ethio_chat_offline_messages_queue_v1';
const SIMULATED_OFFLINE_KEY = 'ethio_chat_simulated_offline';

type SyncListener = (queued: OfflineQueuedMessage[]) => void;
const listeners: Set<SyncListener> = new Set();

let simulatedOffline = localStorage.getItem(SIMULATED_OFFLINE_KEY) === 'true';

export function isOnline(): boolean {
  if (simulatedOffline) return false;
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

export function isSimulatedOffline(): boolean {
  return simulatedOffline;
}

export function setSimulatedOffline(value: boolean) {
  simulatedOffline = value;
  localStorage.setItem(SIMULATED_OFFLINE_KEY, String(value));
  window.dispatchEvent(new Event(value ? 'offline' : 'online'));
  notifyListeners();
  if (!value && navigator.onLine) {
    syncPendingMessages();
  }
}

export function getOfflineQueue(): OfflineQueuedMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse offline queue:', e);
    return [];
  }
}

function saveOfflineQueue(queue: OfflineQueuedMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    notifyListeners();
  } catch (e) {
    console.error('Failed to save offline queue:', e);
  }
}

export function subscribeToOfflineQueue(listener: SyncListener): () => void {
  listeners.add(listener);
  listener(getOfflineQueue());
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners() {
  const current = getOfflineQueue();
  listeners.forEach(fn => fn(current));
}

/**
 * Queue a message locally when offline or when initial send fails
 */
export function queueOfflineMessage(msg: Omit<OfflineQueuedMessage, 'timestamp' | 'retryCount'>): OfflineQueuedMessage {
  const queue = getOfflineQueue();
  const queuedItem: OfflineQueuedMessage = {
    ...msg,
    timestamp: Date.now(),
    retryCount: 0
  };

  // Avoid duplicates
  const existingIndex = queue.findIndex(q => q.localId === queuedItem.localId);
  if (existingIndex >= 0) {
    queue[existingIndex] = queuedItem;
  } else {
    queue.push(queuedItem);
  }

  saveOfflineQueue(queue);
  return queuedItem;
}

export function removeQueuedMessage(localId: string) {
  const queue = getOfflineQueue().filter(q => q.localId !== localId);
  saveOfflineQueue(queue);
}

/**
 * Attempt to send all pending queued messages to Firestore
 */
let isSyncing = false;
export async function syncPendingMessages(): Promise<{ synced: number; failed: number }> {
  if (isSyncing || !isOnline()) {
    return { synced: 0, failed: 0 };
  }

  isSyncing = true;
  const queue = getOfflineQueue();
  let synced = 0;
  let failed = 0;

  const remaining: OfflineQueuedMessage[] = [];

  for (const item of queue) {
    try {
      const messageDocRef = doc(db, 'chats', item.chatId, 'messages', item.localId);
      
      const sentIso = new Date().toISOString();
      const payload: Partial<ChatMessage> = {
        messageId: item.localId,
        chatId: item.chatId,
        senderId: item.senderId,
        senderUsername: item.senderUsername,
        ...(item.senderDisplayName ? { senderDisplayName: item.senderDisplayName } : {}),
        ...(item.senderPhotoURL ? { senderPhotoURL: item.senderPhotoURL } : {}),
        receiverId: item.receiverId,
        type: item.type,
        text: item.text,
        mediaUrl: item.mediaUrl || '',
        audioDuration: item.audioDuration || 0,
        ...(item.fileName ? { fileName: item.fileName } : {}),
        ...(item.fileSize !== undefined ? { fileSize: item.fileSize } : {}),
        ...(item.mimeType ? { mimeType: item.mimeType } : {}),
        ...(item.preventDownload !== undefined ? { preventDownload: item.preventDownload } : {}),
        ...(item.expiresAfterSeconds !== undefined
          ? {
              expiresAfterSeconds: item.expiresAfterSeconds,
              expiresAt: new Date(Date.now() + item.expiresAfterSeconds * 1000).toISOString(),
            }
          : {}),
        ...(item.sharedPostId ? { sharedPostId: item.sharedPostId } : {}),
        ...(item.sharedPostAuthorId ? { sharedPostAuthorId: item.sharedPostAuthorId } : {}),
        ...(item.sharedPostAuthorName ? { sharedPostAuthorName: item.sharedPostAuthorName } : {}),
        ...(item.sharedPostAuthorUsername ? { sharedPostAuthorUsername: item.sharedPostAuthorUsername } : {}),
        ...(item.sharedPostAuthorPhoto ? { sharedPostAuthorPhoto: item.sharedPostAuthorPhoto } : {}),
        ...(item.sharedPostContent !== undefined ? { sharedPostContent: item.sharedPostContent } : {}),
        ...(item.sharedPostMediaUrl ? { sharedPostMediaUrl: item.sharedPostMediaUrl } : {}),
        ...(item.sharedPostMediaType ? { sharedPostMediaType: item.sharedPostMediaType } : {}),
        status: 'sent',
        createdAt: item.expiresAfterSeconds ? sentIso : new Date(item.timestamp).toISOString()
      };

      await setDoc(messageDocRef, payload);

      const snippet =
        item.type === 'text'
          ? item.text
          : item.type === 'image'
          ? '📷 Photo'
          : item.type === 'video'
          ? '🎬 Video'
          : item.type === 'file'
          ? `📎 ${item.fileName || 'File'}`
          : item.type === 'post'
          ? `📌 Shared post${item.sharedPostAuthorName ? ` by ${item.sharedPostAuthorName}` : ''}`
          : '🎤 Voice message';

      // Update parent chat snippet & increment unread counter for direct recipient
      const chatDocRef = doc(db, 'chats', item.chatId);
      const isDirectRecipient = item.receiverId && item.receiverId !== item.chatId;
      await updateDoc(chatDocRef, {
        lastMessage: snippet,
        lastMessageTime: new Date(item.timestamp).toISOString(),
        lastSenderId: item.senderId,
        ...(isDirectRecipient ? { [`unreadCounts.${item.receiverId}`]: increment(1) } : {}),
        updatedAt: new Date().toISOString()
      }).catch(() => {
        // Chat document might still need creation if new
      });

      synced++;
    } catch (err) {
      console.error(`Failed to sync queued message ${item.localId}:`, err);
      failed++;
      // Increment retry count
      remaining.push({
        ...item,
        retryCount: item.retryCount + 1
      });
    }
  }

  saveOfflineQueue(remaining);
  isSyncing = false;
  return { synced, failed };
}

// Auto sync when browser comes back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (!simulatedOffline) {
      console.log('App came online! Syncing pending offline messages...');
      syncPendingMessages();
    }
  });
}
