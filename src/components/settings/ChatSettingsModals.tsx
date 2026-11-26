import React, { useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { CHAT_WALLPAPERS, FONT_STYLES } from '../../lib/socialHelpers';
import { compressImage } from '../../lib/mediaCompression';
import { db } from '../../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { ChatMessage, ChatRoom } from '../../types';
import {
  X,
  Image as ImageIcon,
  Check,
  Type,
  HardDriveDownload,
  Loader2,
  Camera,
  Sparkles
} from 'lucide-react';

/* 1. Chat Wallpaper Picker Modal */
export const ChatWallpaperModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { userProfile, updateUserProfileData } = useAuth();
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !userProfile) return null;

  const currentWallpaper = userProfile.chatWallpaper || 'default';

  const handleSelectPreset = async (id: string) => {
    setSaving(true);
    try {
      await updateUserProfileData({ chatWallpaper: id });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleCustomPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    try {
      const res = await compressImage(file, 720, 1080, 0.72);
      await updateUserProfileData({ chatWallpaper: res.dataUrl });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-[#7560DF]" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{t('chatWallpaper')}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-purple-900/30">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('chatWallpaperDesc')}</p>

          <div className="grid grid-cols-2 gap-3">
            {CHAT_WALLPAPERS.map((wp) => {
              const active = currentWallpaper === wp.id;
              return (
                <button
                  key={wp.id}
                  disabled={saving}
                  onClick={() => handleSelectPreset(wp.id)}
                  className={`relative rounded-2xl p-2 border text-left transition-all ${
                    active
                      ? 'border-[#7560DF] ring-2 ring-[#7560DF]/30'
                      : 'border-slate-200 dark:border-purple-950/50 hover:border-[#7560DF]/40'
                  }`}
                >
                  <div
                    className="h-16 rounded-xl mb-1.5 border border-black/5"
                    style={{ background: wp.previewBg }}
                  />
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                      {wp.label}
                    </span>
                    {active && <Check className="w-3.5 h-3.5 text-[#7560DF] shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleCustomPhoto}
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => fileRef.current?.click()}
            className="w-full py-3 rounded-2xl border-2 border-dashed border-[#7560DF]/40 hover:bg-[#7560DF]/5 text-[#7560DF] dark:text-[#B09EFC] font-bold text-xs flex items-center justify-center gap-2 transition-colors"
          >
            <Camera className="w-4 h-4" />
            <span>{saving ? 'Applying wallpaper...' : 'Choose Custom Photo Wallpaper'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/* 2. Font Size Modal */
export const FontSizeModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { userProfile, updateUserProfileData } = useAuth();
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);

  if (!isOpen || !userProfile) return null;

  const currentSize = userProfile.chatFontSize || 'medium';

  const options: Array<{ id: 'small' | 'medium' | 'large'; label: string; sampleClass: string }> = [
    { id: 'small', label: 'Small (Compact)', sampleClass: 'text-xs' },
    { id: 'medium', label: 'Medium (Standard)', sampleClass: 'text-sm' },
    { id: 'large', label: 'Large (Easy Read)', sampleClass: 'text-base sm:text-lg' },
  ];

  const handleSelect = async (size: 'small' | 'medium' | 'large') => {
    setSaving(true);
    try {
      await updateUserProfileData({ chatFontSize: size });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Type className="w-5 h-5 text-[#7560DF]" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{t('fontSize')}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-purple-900/30">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {options.map((opt) => {
            const active = currentSize === opt.id;
            return (
              <button
                key={opt.id}
                disabled={saving}
                onClick={() => handleSelect(opt.id)}
                className={`w-full p-3.5 rounded-2xl border text-left transition-all space-y-2 ${
                  active
                    ? 'border-[#7560DF] bg-[#7560DF]/10'
                    : 'border-slate-200 dark:border-purple-950/50 hover:bg-slate-50 dark:hover:bg-[#201c38]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-800 dark:text-white">{opt.label}</span>
                  {active && <Check className="w-4 h-4 text-[#7560DF]" />}
                </div>
                <div className={`inline-block px-3.5 py-2 rounded-2xl bg-[#7560DF] text-white ${opt.sampleClass}`}>
                  Hello! Ethio Chat preview ✨
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* 3. Chat Backup Modal */
export const ChatBackupModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { currentUser, userProfile, updateUserProfileData } = useAuth();
  const { t } = useLanguage();
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  if (!isOpen || !userProfile || !currentUser) return null;

  const handleRunBackup = async () => {
    setIsBackingUp(true);
    setStatusMsg(null);
    try {
      const chatsQuery = query(
        collection(db, 'chats'),
        where('participantIds', 'array-contains', currentUser.uid)
      );
      const chatsSnap = await getDocs(chatsQuery);
      const rooms: ChatRoom[] = [];
      const allMessages: ChatMessage[] = [];

      for (const chatDoc of chatsSnap.docs) {
        const room = chatDoc.data() as ChatRoom;
        rooms.push(room);
        const msgSnap = await getDocs(collection(db, 'chats', room.chatId, 'messages'));
        msgSnap.forEach((m) => {
          allMessages.push(m.data() as ChatMessage);
        });
      }

      const now = new Date().toISOString();
      const backupPayload = {
        app: 'Ethio Chat',
        exportedAt: now,
        userId: userProfile.userId,
        username: userProfile.username,
        chatsCount: rooms.length,
        messagesCount: allMessages.length,
        chats: rooms,
        messages: allMessages,
      };

      const json = JSON.stringify(backupPayload, null, 2);
      try {
        localStorage.setItem(`ethio_chat_backup_${userProfile.userId}`, json);
      } catch {
        // ignore quota errors if media is large
      }

      // Download JSON backup directly into user's Downloads / File Manager
      const blob = new Blob([json], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `ethio_chat_backup_${userProfile.username}_${now.slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

      await updateUserProfileData({ lastBackupAt: now });
      setStatusMsg(`Backup complete! Saved ${rooms.length} chats & ${allMessages.length} messages.`);
    } catch (err: any) {
      setStatusMsg(err.message || 'Backup failed. Please try again.');
    } finally {
      setIsBackingUp(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDriveDownload className="w-5 h-5 text-emerald-500" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{t('chatBackup')}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-purple-900/30">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('chatBackupDesc')}</p>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-100 dark:border-purple-950/40 space-y-1">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Last Backup</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {userProfile.lastBackupAt
                ? new Date(userProfile.lastBackupAt).toLocaleString()
                : 'No backup created yet'}
            </p>
          </div>

          {statusMsg && (
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
              {statusMsg}
            </div>
          )}

          <button
            type="button"
            disabled={isBackingUp}
            onClick={handleRunBackup}
            className="w-full py-3 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-sm shadow-md shadow-[#7560DF]/25 flex items-center justify-center gap-2"
          >
            {isBackingUp ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Backing up chats...</span>
              </>
            ) : (
              <>
                <HardDriveDownload className="w-4 h-4" />
                <span>Back Up Chats Now</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

/* 4. Font Style Picker Modal (10 Beautiful Fonts for Entire App) */
export const FontStyleModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { userProfile, updateUserProfileData } = useAuth();
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);

  if (!isOpen || !userProfile) return null;

  const currentFont = userProfile.fontStyle || 'plus_jakarta';

  const handleSelectFont = async (fontId: string) => {
    setSaving(true);
    try {
      try {
        localStorage.setItem('ethio_font_style', fontId);
      } catch {}
      await updateUserProfileData({ fontStyle: fontId });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 flex flex-col max-h-[82vh] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#7560DF]" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{t('fontStyle')} (10)</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-purple-900/30">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
          <p className="text-xs text-slate-500 dark:text-slate-400 px-1">{t('fontStyleDesc')}</p>

          {FONT_STYLES.map((font, idx) => {
            const active = currentFont === font.id;
            return (
              <button
                key={font.id}
                type="button"
                disabled={saving}
                onClick={() => handleSelectFont(font.id)}
                className={`w-full p-3.5 rounded-2xl border text-left transition-all flex items-center justify-between gap-3 ${
                  active
                    ? 'border-[#7560DF] bg-[#7560DF]/10 ring-1 ring-[#7560DF]'
                    : 'border-slate-200 dark:border-purple-950/50 hover:bg-slate-50 dark:hover:bg-[#201c38]'
                }`}
              >
                <div className="min-w-0 flex-1 space-y-0.5" style={{ fontFamily: font.stack }}>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC]">
                      {idx + 1}
                    </span>
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {font.name}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    Ethio Chat · Hello! ✨ ({font.tagline})
                  </p>
                </div>
                {active && <Check className="w-5 h-5 text-[#7560DF] shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
