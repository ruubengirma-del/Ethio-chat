import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { compressImage } from '../../lib/mediaCompression';
import { db } from '../../lib/firebase';
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import {
  X,
  Send,
  Sparkles,
  Bot,
  Trash2,
  Loader2,
  User,
  Image as ImageIcon,
  Copy,
  Check,
  Edit3
} from 'lucide-react';

interface RubGPTMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  imageUrl?: string;
  timestamp: string;
  editedAt?: string;
}

interface RubGPTModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function getStorageKey(uid?: string): string {
  return `ethio_rubgpt_history_v1_${uid || 'guest'}`;
}

export const RubGPTModal: React.FC<RubGPTModalProps> = ({ isOpen, onClose }) => {
  const { language, t } = useLanguage();
  const { currentUser, userProfile } = useAuth();

  const buildWelcomeMessage = useCallback((): RubGPTMessage => ({
    id: 'welcome',
    role: 'model',
    text:
      language === 'om'
        ? 'Akkam! Ani RubGPT dha — gargaaraa AI Ethio Chat. Gaaffii barbaaddan gaafachuu ykn suuraa ergitanii waan isa keessa jiru na gaafachuu dandeessu!'
        : language === 'am'
        ? 'ሰላም! እኔ RubGPT ነኝ — የኢትዮ ቻት AI ረዳትዎ። ማንኛውንም ጥያቄ መጠየቅ ወይም ፎቶ ልከው ስለ ፎቶው መጠየቅ ይችላሉ!'
        : 'Hello! I am RubGPT, your Ethio Chat AI assistant. Ask any question or attach an image to ask about what is inside it!',
    timestamp: new Date(0).toISOString(),
  }), [language]);

  const [messages, setMessages] = useState<RubGPTMessage[]>(() => [buildWelcomeMessage()]);
  const [input, setInput] = useState('');
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [attachingImage, setAttachingImage] = useState(false);
  const [sending, setSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const persistLocal = useCallback(
    (list: RubGPTMessage[]) => {
      try {
        const nonWelcome = list.filter((m) => m.id !== 'welcome');
        localStorage.setItem(getStorageKey(currentUser?.uid), JSON.stringify(nonWelcome));
      } catch {
        // ignore storage quota errors
      }
    },
    [currentUser?.uid]
  );

  const saveMessageToFirestore = useCallback(
    async (msg: RubGPTMessage) => {
      if (!currentUser || msg.id === 'welcome') return;
      const safeImageUrl =
        msg.imageUrl && msg.imageUrl.length <= 850000 ? msg.imageUrl : undefined;
      await setDoc(doc(db, 'users', currentUser.uid, 'rubgpt', msg.id), {
        id: msg.id,
        role: msg.role,
        text: msg.text.slice(0, 15500),
        ...(safeImageUrl ? { imageUrl: safeImageUrl } : {}),
        timestamp: msg.timestamp,
        ...(msg.editedAt ? { editedAt: msg.editedAt } : {}),
      }).catch(() => {});
    },
    [currentUser]
  );

  const deleteMessagesFromFirestore = useCallback(
    async (ids: string[]) => {
      if (!currentUser || ids.length === 0) return;
      try {
        const batch = writeBatch(db);
        ids.forEach((id) => {
          if (id !== 'welcome') {
            batch.delete(doc(db, 'users', currentUser.uid, 'rubgpt', id));
          }
        });
        await batch.commit();
      } catch {
        await Promise.all(
          ids
            .filter((id) => id !== 'welcome')
            .map((id) => deleteDoc(doc(db, 'users', currentUser.uid, 'rubgpt', id)).catch(() => {}))
        );
      }
    },
    [currentUser]
  );

  // Load persisted RubGPT history from localStorage + Firestore on login / modal open
  useEffect(() => {
    const uid = currentUser?.uid;
    let localMsgs: RubGPTMessage[] = [];
    try {
      const raw = localStorage.getItem(getStorageKey(uid));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          localMsgs = parsed.filter((m) => m && m.id && m.role && typeof m.text === 'string');
        }
      }
    } catch {
      // ignore
    }

    setMessages([buildWelcomeMessage(), ...localMsgs]);

    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const q = query(
          collection(db, 'users', uid, 'rubgpt'),
          orderBy('timestamp', 'asc')
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const remoteMsgs: RubGPTMessage[] = [];
        snap.forEach((d) => {
          const item = d.data() as RubGPTMessage;
          if (item && item.id && item.id !== 'welcome') {
            remoteMsgs.push(item);
          }
        });
        if (remoteMsgs.length > 0) {
          // Merge local image previews if remote omitted large image
          const localMap = new Map(localMsgs.map((m) => [m.id, m]));
          const merged = remoteMsgs.map((rm) => {
            const lm = localMap.get(rm.id);
            return lm?.imageUrl && !rm.imageUrl ? { ...rm, imageUrl: lm.imageUrl } : rm;
          });
          setMessages([buildWelcomeMessage(), ...merged]);
          persistLocal(merged);
        } else if (localMsgs.length > 0) {
          // Backfill local history to Firestore silently
          await Promise.all(localMsgs.map((m) => saveMessageToFirestore(m)));
        }
      } catch {
        // keep localMsgs cleanly
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.uid, isOpen, buildWelcomeMessage, persistLocal, saveMessageToFirestore]);

  useEffect(() => {
    if (isOpen) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, sending, isOpen]);

  if (!isOpen) return null;

  const handleCopyText = async (msgId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopiedId(msgId);
    setTimeout(() => setCopiedId((prev) => (prev === msgId ? null : prev)), 1800);
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachingImage(true);
    try {
      const compressed = await compressImage(file, 1024, 1024, 0.8);
      setSelectedImageUrl(compressed.dataUrl);
    } catch (err) {
      console.error('Failed to process image for RubGPT:', err);
    } finally {
      setAttachingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const callRubGptApi = async (
    displayPrompt: string,
    imageToSend: string | null | undefined,
    priorMessages: RubGPTMessage[]
  ): Promise<RubGPTMessage> => {
    const cleanPrior = priorMessages
      .filter(
        (m) =>
          m.id !== 'welcome' &&
          !m.id.startsWith('err_') &&
          !m.text.trim().startsWith('⚠️')
      )
      .slice(-14);

    let keptImageCount = 0;
    const historyToSend = [...cleanPrior]
      .reverse()
      .map((m) => {
        const keepImg = Boolean(m.imageUrl) && keptImageCount < 1;
        if (keepImg) keptImageCount += 1;
        return {
          role: m.role,
          text: m.text,
          ...(keepImg && m.imageUrl ? { imageUrl: m.imageUrl } : {}),
        };
      })
      .reverse();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);

    try {
      const res = await fetch('/api/rubgpt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: displayPrompt,
          ...(imageToSend ? { imageUrl: imageToSend } : {}),
          history: historyToSend,
          language,
        }),
      });
      clearTimeout(timeoutId);

      const rawText = await res.text();
      let data: { reply?: string; error?: string } | null = null;
      try {
        data = rawText ? (JSON.parse(rawText) as { reply?: string; error?: string }) : null;
      } catch {
        data = null;
      }

      if (!res.ok) {
        throw new Error(
          data?.error ||
            (res.status >= 500
              ? 'RubGPT server error. Please try again shortly.'
              : `Could not get response from RubGPT (${res.status})`)
        );
      }

      if (!data?.reply) {
        throw new Error('RubGPT returned an empty response. Please try again.');
      }

      return {
        id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'model',
        text: data.reply,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isAbort = err?.name === 'AbortError';
      const fallbackMsg =
        language === 'om'
          ? 'Yeroon deebii dheerateera. Mee irra deebi’aa yaalaa.'
          : language === 'am'
          ? 'ምላሽ ለመቀበል ጊዜው ዘግይቷል። እባክዎ እንደገና ይሞክሩ።'
          : 'Request timed out. Please try again.';
      return {
        id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'model',
        text: `⚠️ ${isAbort ? fallbackMsg : err?.message || 'Unable to connect to RubGPT right now.'}`,
        timestamp: new Date().toISOString(),
      };
    }
  };

  const sendMessage = async (textOverride?: string) => {
    const promptText = (textOverride ?? input).trim();
    const imageToSend = textOverride ? null : selectedImageUrl;
    if ((!promptText && !imageToSend) || sending) return;

    const displayPrompt =
      promptText ||
      (language === 'om'
        ? 'Suuraa kana naaf ibsi.'
        : language === 'am'
        ? 'ይህን ምስል ግለጽልኝ።'
        : 'What is in this image?');

    const userMsg: RubGPTMessage = {
      id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      text: displayPrompt,
      ...(imageToSend ? { imageUrl: imageToSend } : {}),
      timestamp: new Date().toISOString(),
    };

    const prior = messages;
    const withUser = [...prior, userMsg];
    setMessages(withUser);
    persistLocal(withUser);
    saveMessageToFirestore(userMsg);

    if (!textOverride) {
      setInput('');
      setSelectedImageUrl(null);
    }
    setSending(true);

    const aiMsg = await callRubGptApi(displayPrompt, imageToSend, prior);
    setMessages((prev) => {
      const updated = [...prev, aiMsg];
      persistLocal(updated);
      return updated;
    });
    if (!aiMsg.id.startsWith('err_')) {
      saveMessageToFirestore(aiMsg);
    }
    setSending(false);
  };

  const handleSaveEditedQuestion = async (msgId: string) => {
    const nextText = editDraft.trim();
    if (!nextText || sending) return;

    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx === -1) {
      setEditingId(null);
      return;
    }

    const target = messages[idx];
    const updatedUserMsg: RubGPTMessage = {
      ...target,
      text: nextText,
      editedAt: new Date().toISOString(),
    };

    const prior = messages.slice(0, idx);
    const removedLaterIds = messages.slice(idx + 1).map((m) => m.id);
    const nextList = [...prior, updatedUserMsg];

    setEditingId(null);
    setEditDraft('');
    setMessages(nextList);
    persistLocal(nextList);
    saveMessageToFirestore(updatedUserMsg);
    deleteMessagesFromFirestore(removedLaterIds);

    setSending(true);
    const aiMsg = await callRubGptApi(nextText, updatedUserMsg.imageUrl, prior);
    setMessages((prev) => {
      const updated = [...prev, aiMsg];
      persistLocal(updated);
      return updated;
    });
    if (!aiMsg.id.startsWith('err_')) {
      saveMessageToFirestore(aiMsg);
    }
    setSending(false);
  };

  const handleDeleteSingleMessage = (msgId: string) => {
    if (msgId === 'welcome') return;
    if (editingId === msgId) {
      setEditingId(null);
      setEditDraft('');
    }
    setMessages((prev) => {
      const filtered = prev.filter((m) => m.id !== msgId);
      persistLocal(filtered);
      return filtered;
    });
    deleteMessagesFromFirestore([msgId]);
  };

  const handleClearAllHistory = () => {
    const idsToDelete = messages.filter((m) => m.id !== 'welcome').map((m) => m.id);
    const reset = [buildWelcomeMessage()];
    setMessages(reset);
    setSelectedImageUrl(null);
    setEditingId(null);
    setEditDraft('');
    persistLocal([]);
    deleteMessagesFromFirestore(idsToDelete);
  };

  const quickPrompts =
    language === 'om'
      ? ['Seenaa Itoophiyaa gabaabinaan naaf himi', 'Xalayaa hojii bareedaa naaf barreessi', 'Afaan Oromo gara Ingliffaatti hiiki']
      : language === 'am'
      ? ['ስለ ኢትዮጵያ ታሪክ በአጭሩ ንገረኝ', 'ጥሩ የስራ መልዕክት ጻፍልኝ', 'አማርኛ ወደ እንግሊዝኛ ተርጉም']
      : ['Write a friendly greeting post', 'Translate a message to Afaan Oromo', 'Give me 3 creative study tips'];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200/80 dark:border-purple-950/60 flex flex-col h-[90dvh] sm:h-[680px] overflow-hidden">
        {/* Top Bar */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between bg-gradient-to-r from-[#7560DF]/15 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#7560DF] to-[#A494FA] text-white flex items-center justify-center shadow-md shadow-[#7560DF]/30">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>RubGPT</span>
                <Sparkles className="w-4 h-4 text-[#7560DF]" />
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('rubGptDesc')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleClearAllHistory}
              className="p-2 rounded-full text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-purple-950/40 transition-colors"
              title="Delete chat history"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-950/40 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-slate-50/70 dark:bg-[#0f0d1a]">
          {messages.map((m) => {
            const isUser = m.role === 'user';
            const isEditing = isUser && editingId === m.id;
            const isCopied = copiedId === m.id;

            return (
              <div key={m.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                <div className={`flex gap-2.5 max-w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
                  {!isUser && (
                    <div className="w-8 h-8 rounded-full bg-[#7560DF] text-white flex items-center justify-center shrink-0 mt-1">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}

                  <div
                    className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm space-y-2 ${
                      isUser
                        ? 'bg-[#7560DF] text-white rounded-br-sm'
                        : 'bg-white dark:bg-[#1f1b38] text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-purple-950/40 rounded-bl-sm'
                    }`}
                  >
                    {m.imageUrl && (
                      <img
                        src={m.imageUrl}
                        alt="Uploaded to RubGPT"
                        className="max-h-56 w-auto rounded-xl object-cover border border-white/20"
                      />
                    )}

                    {isEditing ? (
                      <div className="space-y-2 min-w-[210px]">
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 rounded-xl bg-white/95 text-slate-900 text-xs sm:text-sm outline-none resize-none"
                          autoFocus
                        />
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditDraft('');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-white text-[11px] font-bold"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={!editDraft.trim() || sending}
                            onClick={() => handleSaveEditedQuestion(m.id)}
                            className="px-3 py-1 rounded-lg bg-white text-[#5841C5] text-[11px] font-extrabold hover:bg-white/90 disabled:opacity-50"
                          >
                            Save & Resend
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {m.text && <div>{m.text}</div>}
                        {m.editedAt && (
                          <div className="text-[10px] opacity-75 italic">({t('editedLabel')})</div>
                        )}
                      </>
                    )}
                  </div>

                  {isUser && userProfile && (
                    <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 mt-1 ring-1 ring-[#7560DF]/40">
                      {userProfile.photoURL ? (
                        <img src={userProfile.photoURL} alt={userProfile.displayName} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-slate-200 flex items-center justify-center">
                          <User className="w-4 h-4 text-slate-500" />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Action controls below each message (Copy / Edit / Delete for user; Copy / Delete for AI reply) */}
                {m.id !== 'welcome' && !isEditing && (
                  <div
                    className={`flex items-center gap-1 mt-1 text-[11px] ${
                      isUser ? 'pr-11 justify-end' : 'pl-11 justify-start'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleCopyText(m.id, m.text)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-[#7560DF] dark:hover:text-[#B09EFC] hover:bg-slate-200/60 dark:hover:bg-purple-950/40 transition-colors font-semibold"
                      title="Copy text"
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>

                    {isUser && (
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => {
                          setEditingId(m.id);
                          setEditDraft(m.text);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-[#7560DF] dark:hover:text-[#B09EFC] hover:bg-slate-200/60 dark:hover:bg-purple-950/40 transition-colors font-semibold disabled:opacity-40"
                        title="Edit question"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => handleDeleteSingleMessage(m.id)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors font-semibold disabled:opacity-40"
                      title="Delete message"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {sending && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#7560DF] text-white flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="px-4 py-2.5 rounded-2xl bg-white dark:bg-[#1f1b38] border border-slate-200/80 dark:border-purple-950/40 text-xs text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-[#7560DF]" />
                <span>
                  {language === 'om'
                    ? 'RubGPT yaadaa jira...'
                    : language === 'am'
                    ? 'RubGPT እያሰበ ነው...'
                    : 'RubGPT is thinking...'}
                </span>
              </div>
            </div>
          )}

          {messages.length <= 1 && (
            <div className="pt-2 flex flex-wrap gap-2">
              {quickPrompts.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="px-3 py-1.5 rounded-full bg-white dark:bg-[#1f1b38] border border-[#7560DF]/30 text-xs font-medium text-[#7560DF] dark:text-[#B09EFC] hover:bg-[#7560DF]/10 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div ref={endRef} />
        </div>

        {/* Selected Image Preview Strip */}
        {selectedImageUrl && (
          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-purple-950/40 bg-slate-50 dark:bg-[#120f24] flex items-center gap-3">
            <div className="relative w-14 h-14 rounded-xl overflow-hidden border border-[#7560DF]/40 shrink-0">
              <img src={selectedImageUrl} alt="Preview" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => setSelectedImageUrl(null)}
                className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/70 text-white hover:bg-rose-500"
                title="Remove image"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-300">
              {language === 'om'
                ? 'Suuraan qophaa’eera! Gaaffii barreessiitii ergi.'
                : language === 'am'
                ? 'ፎቶው ዝግጁ ነው! ጥያቄዎን ጽፈው ይላኩ።'
                : 'Image ready! Type a question about this photo or press Send.'}
            </p>
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="p-3.5 border-t border-slate-100 dark:border-purple-950/40 bg-white dark:bg-[#16132b] flex items-center gap-2 safe-bottom"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImagePick}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={attachingImage || sending}
            className="p-2.5 rounded-full bg-slate-100 dark:bg-[#201c38] text-[#7560DF] hover:bg-[#7560DF]/15 transition-colors disabled:opacity-40 shrink-0"
            title={language === 'om' ? 'Suuraa ergi' : language === 'am' ? 'ፎቶ ላክ' : 'Attach image'}
          >
            {attachingImage ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <ImageIcon className="w-4.5 h-4.5" />}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              selectedImageUrl
                ? language === 'om'
                  ? 'Waa’ee suuraa kanaa gaafadhu...'
                  : language === 'am'
                  ? 'ስለዚህ ፎቶ ይጠይቁ...'
                  : 'Ask about this image...'
                : language === 'om'
                ? 'RubGPT gaafadhu ykn suuraa ergi...'
                : language === 'am'
                ? 'RubGPTን ይጠይቁ ወይም ፎቶ ይላኩ...'
                : 'Ask RubGPT anything or attach a photo...'
            }
            className="flex-1 px-4 py-2.5 rounded-full bg-slate-100 dark:bg-[#201c38] text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#7560DF]"
          />
          <button
            type="submit"
            disabled={(!input.trim() && !selectedImageUrl) || sending}
            className="p-2.5 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white disabled:opacity-40 shadow-sm transition-all shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
