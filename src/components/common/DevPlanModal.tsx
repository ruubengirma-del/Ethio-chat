import React, { useState } from 'react';
import { 
  X, 
  FileCode2, 
  Database, 
  FolderTree, 
  CheckCircle2, 
  ShieldCheck, 
  Cpu, 
  Layers,
  Copy,
  Check
} from 'lucide-react';
import { useBackHandler } from '../../lib/backNavigation';

interface DevPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DevPlanModal: React.FC<DevPlanModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'plan' | 'folder' | 'schema' | 'offline'>('plan');
  const [copied, setCopied] = useState(false);
  useBackHandler(isOpen, onClose);

  if (!isOpen) return null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/65 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#7560DF]/15 text-[#7560DF] flex items-center justify-center">
              <FileCode2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-base text-slate-900 dark:text-white">
                Ethio Chat - Step-by-Step Architecture & Dev Plan
              </h2>
              <p className="text-[11px] text-slate-400">
                Hybrid Facebook + Messenger Specification & Schemas
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="px-6 pt-3 border-b border-slate-100 dark:border-purple-950/30 flex items-center gap-2 bg-slate-50/50 dark:bg-[#120f24]/50 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('plan')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'plan'
                ? 'bg-[#7560DF] text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            1. Development Plan
          </button>
          <button
            onClick={() => setActiveTab('folder')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'folder'
                ? 'bg-[#7560DF] text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            2. Folder Structure
          </button>
          <button
            onClick={() => setActiveTab('schema')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'schema'
                ? 'bg-[#7560DF] text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            3. Database Schema
          </button>
          <button
            onClick={() => setActiveTab('offline')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'offline'
                ? 'bg-[#7560DF] text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            4. Offline Sync & Media
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
          {/* TAB 1: PLAN */}
          {activeTab === 'plan' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-[#7560DF]/10 border border-[#7560DF]/20 text-[#7560DF] dark:text-[#B09EFC]">
                <h3 className="font-bold text-sm mb-1">Ethio Chat Product Blueprint</h3>
                <p className="text-xs leading-relaxed">
                  A high-performance hybrid combining Facebook’s rich global social feed with Messenger’s instant 1-on-1 chats, voice notes, and offline-first message synchronization in Rub Violet (#7560DF).
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#1a1633] border border-slate-100 dark:border-purple-950/40">
                  <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full bg-[#7560DF] text-white text-[11px] font-bold flex items-center justify-center">1</span>
                    Phase 1: Architecture & Foundation
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 pl-2">
                    <li>Initialize React 19 + TypeScript + Vite + Tailwind CSS 4 setup.</li>
                    <li>Provision Firebase Authentication and Firestore Database Enterprise with offline multi-tab persistence.</li>
                    <li>Configure Rub Violet (#7560DF) theme tokens, dark/light mode toggle with localStorage sync.</li>
                  </ul>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#1a1633] border border-slate-100 dark:border-purple-950/40">
                  <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full bg-[#7560DF] text-white text-[11px] font-bold flex items-center justify-center">2</span>
                    Phase 2: Authentication & Social Follow System
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 pl-2">
                    <li>Sign Up with Username, Email, and Password; seamless login & Google Auth.</li>
                    <li>Profile schema with dynamic follower/following counts.</li>
                    <li>Follow and "Follow Back" conditional logic with real-time Firestore listeners.</li>
                    <li>Full profile editor: update photo (compressed), display name, email, bio, and password.</li>
                  </ul>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#1a1633] border border-slate-100 dark:border-purple-950/40">
                  <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full bg-[#7560DF] text-white text-[11px] font-bold flex items-center justify-center">3</span>
                    Phase 3: Global Real-Time Feed (Facebook Experience)
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 pl-2">
                    <li>Global post collection with snapshot listener (`onSnapshot`) sorted by timestamp desc.</li>
                    <li>Media compressor: client-side Canvas scaling to keep images & videos lightweight (&lt; 300KB).</li>
                    <li>Real-time heart reactions & threaded comments drawer with instant updates.</li>
                  </ul>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#1a1633] border border-slate-100 dark:border-purple-950/40">
                  <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full bg-[#7560DF] text-white text-[11px] font-bold flex items-center justify-center">4</span>
                    Phase 4: Real-Time Chat & Offline Queue (Messenger Experience)
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 pl-2">
                    <li>Search users by `@username` to launch 1-on-1 message threads.</li>
                    <li>Voice notes recording using `MediaRecorder` API with live waveform animation.</li>
                    <li>Offline queue engine: messages typed while offline save locally and sync automatically when online.</li>
                    <li>Delivery status flags: "pending" (clock), "sent" (double checkmark), "error".</li>
                  </ul>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#1a1633] border border-slate-100 dark:border-purple-950/40">
                  <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full bg-[#7560DF] text-white text-[11px] font-bold flex items-center justify-center">5</span>
                    Phase 5: Settings & Support
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 pl-2">
                    <li>Dark mode toggle switch.</li>
                    <li>Contact Us action pre-filling `mailto:Ruubengirma@gmail.com`.</li>
                    <li>Offline simulator toggle for browser testing.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FOLDER STRUCTURE */}
          {activeTab === 'folder' && (
            <div className="space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-purple-950/40 font-sans">
                <span className="font-bold text-slate-900 dark:text-white">Ethio Chat Folder Structure</span>
                <button
                  onClick={() => handleCopy(`/src
├── components/
│   ├── auth/AuthModal.tsx
│   ├── chat/
│   │   ├── AudioRecorder.tsx
│   │   ├── ChatListView.tsx
│   │   └── ChatRoomView.tsx
│   ├── common/
│   │   ├── BottomNav.tsx
│   │   ├── DevPlanModal.tsx
│   │   ├── Header.tsx
│   │   └── UserSearchModal.tsx
│   ├── feed/
│   │   ├── CommentsModal.tsx
│   │   ├── CreatePostModal.tsx
│   │   ├── FeedView.tsx
│   │   └── PostCard.tsx
│   ├── profile/
│   │   ├── EditProfileModal.tsx
│   │   └── ProfileView.tsx
│   └── settings/
│       └── SettingsView.tsx
├── context/
│   ├── AuthContext.tsx
│   └── ThemeContext.tsx
├── lib/
│   ├── firebase.ts
│   ├── mediaCompression.ts
│   └── offlineSync.ts
├── types/
│   └── index.ts
├── App.tsx
├── index.css
└── main.tsx`)}
                  className="px-2.5 py-1 rounded bg-[#7560DF]/10 text-[#7560DF] font-bold text-[11px] flex items-center gap-1"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy Tree'}</span>
                </button>
              </div>

              <pre className="p-4 rounded-2xl bg-slate-900 text-purple-200 overflow-x-auto leading-relaxed">
{`/src
├── components/
│   ├── auth/
│   │   └── AuthModal.tsx             # Login & Sign Up with Ethio Chat branding
│   ├── chat/
│   │   ├── AudioRecorder.tsx         # Voice note recorder & waveform animation
│   │   ├── ChatListView.tsx          # Active conversations & suggested users
│   │   └── ChatRoomView.tsx          # 1-on-1 chat, media & offline message sync
│   ├── common/
│   │   ├── BottomNav.tsx             # Mobile tab bar with unread badges
│   │   ├── DevPlanModal.tsx          # Architecture, schemas & dev roadmap
│   │   ├── Header.tsx                # Ethio Chat logo, online/offline simulator
│   │   └── UserSearchModal.tsx       # Search by @username & follow actions
│   ├── feed/
│   │   ├── CommentsModal.tsx         # Live post comments drawer
│   │   ├── CreatePostModal.tsx       # High-efficiency media post creator
│   │   ├── FeedView.tsx              # Global feed & active community stories
│   │   └── PostCard.tsx              # Post reactions, likes & shares
│   ├── profile/
│   │   ├── EditProfileModal.tsx      # Avatar, name, email & password update
│   │   └── ProfileView.tsx           # Cover, follow/follow-back & user posts
│   └── settings/
│       └── SettingsView.tsx          # Dark mode & mailto:Ruubengirma@gmail.com
├── context/
│   ├── AuthContext.tsx               # Auth state, follow system & demo switcher
│   └── ThemeContext.tsx              # Rub Violet & Dark/Light mode provider
├── lib/
│   ├── firebase.ts                   # Firestore with offline persistence
│   ├── mediaCompression.ts          # Canvas client-side media compression
│   └── offlineSync.ts                # Offline message queue & auto re-sync
├── types/
│   └── index.ts                      # Strict TypeScript data models
├── App.tsx                           # Master view router & frame layout
├── index.css                         # Tailwind CSS & Rub Violet theme tokens
└── main.tsx                          # Application entry point`}
              </pre>
            </div>
          )}

          {/* TAB 3: SCHEMA */}
          {activeTab === 'schema' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#1a1633] border border-slate-100 dark:border-purple-950/40 space-y-2">
                <span className="font-bold text-slate-900 dark:text-white">Firestore Collections Hierarchy:</span>
                <div className="space-y-3 font-mono text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-black/30">
                    <p className="font-bold text-[#7560DF]">1. /users/{`{userId}`}</p>
                    <p className="text-slate-500">userId, username, displayName, email, photoURL, bio, followersCount, followingCount, createdAt</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-black/30">
                    <p className="font-bold text-[#7560DF]">2. /posts/{`{postId}`}</p>
                    <p className="text-slate-500">postId, authorId, authorUsername, authorDisplayName, authorPhotoURL, content, mediaUrl, mediaType ('none'|'image'|'video'), likesCount, commentsCount, createdAt</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-black/30">
                    <p className="font-bold text-[#7560DF]">3. /posts/{`{postId}`}/likes/{`{userId}`}</p>
                    <p className="text-slate-500">userId, postId, createdAt</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-black/30">
                    <p className="font-bold text-[#7560DF]">4. /posts/{`{postId}`}/comments/{`{commentId}`}</p>
                    <p className="text-slate-500">commentId, postId, authorId, authorUsername, authorDisplayName, authorPhotoURL, text, createdAt</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-black/30">
                    <p className="font-bold text-[#7560DF]">5. /follows/{`{followerId}_{followingId}`}</p>
                    <p className="text-slate-500">followId, followerId, followingId, createdAt</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-black/30">
                    <p className="font-bold text-[#7560DF]">6. /chats/{`{chatId}`}</p>
                    <p className="text-slate-500">chatId, participantIds [uid1, uid2], lastMessage, lastMessageTime, lastSenderId, updatedAt</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-black/30">
                    <p className="font-bold text-[#7560DF]">7. /chats/{`{chatId}`}/messages/{`{messageId}`}</p>
                    <p className="text-slate-500">messageId, chatId, senderId, senderUsername, receiverId, type ('text'|'image'|'audio'), text, mediaUrl, audioDuration, status ('pending'|'sent'|'error'), createdAt</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: OFFLINE SYNC */}
          {activeTab === 'offline' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300">
                <h4 className="font-bold text-sm mb-1">Offline-First Messaging Engine</h4>
                <p className="text-xs leading-relaxed">
                  Ethio Chat is engineered to work reliably in low-connectivity environments. If a user loses connection (or toggles the simulated offline mode), text messages are queued into local persistent storage with status <span className="font-mono font-bold">pending</span>.
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#1a1633] border border-slate-100 dark:border-purple-950/40">
                  <h5 className="font-bold text-slate-900 dark:text-white mb-1">Automatic Re-sync Algorithm</h5>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    1. When the window dispatches an <code className="text-[#7560DF]">online</code> event, or when offline simulation is disabled, the <code className="text-[#7560DF]">syncPendingMessages()</code> runner executes.<br/>
                    2. It iterates through all queued items, writing to Firestore doc <code className="text-[#7560DF]">/chats/[chatId]/messages/[localId]</code> with status updated to <code className="text-emerald-500 font-bold">sent</code>.<br/>
                    3. Parent conversation snippets are updated atomically, and the local queue is purged upon verification.
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#1a1633] border border-slate-100 dark:border-purple-950/40">
                  <h5 className="font-bold text-slate-900 dark:text-white mb-1">Media Compression Protocol</h5>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    • <strong>Images:</strong> Canvas 2D downscaling to a maximum of 1080x1080 with 0.78 JPEG/WebP quality. Achieves a 92% file size reduction before saving.<br/>
                    • <strong>Audio:</strong> MediaRecorder WebM stream at 32-64kbps bitrates, yielding &lt; 50KB for a 15-second voice note.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
