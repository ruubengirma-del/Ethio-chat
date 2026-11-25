import React, { useEffect, useState } from 'react';
import { Story, StoryView, ChatMessage } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
  increment,
} from 'firebase/firestore';
import { createAppNotification, recordViewStat } from '../../lib/socialHelpers';
import { X, Send, Eye, ChevronLeft, ChevronRight, Trash2, Edit3 } from 'lucide-react';

interface StoryViewerModalProps {
  stories: Story[];
  initialIndex: number;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  onEditStory?: (story: Story) => void;
}

// 8 distinct reaction emojis (Joy, Love, Sad, Thanks, Wow, Fire, Clap, Celebrate)
const STORY_EMOJIS = [
  { emoji: '😂', label: 'Joy' },
  { emoji: '❤️', label: 'Love' },
  { emoji: '😢', label: 'Sad' },
  { emoji: '🙏', label: 'Thanks' },
  { emoji: '😮', label: 'Wow' },
  { emoji: '🔥', label: 'Fire' },
  { emoji: '👏', label: 'Clap' },
  { emoji: '🎉', label: 'Celebrate' },
];

export const StoryViewerModal: React.FC<StoryViewerModalProps> = ({
  stories,
  initialIndex,
  onClose,
  onViewProfile,
  onEditStory,
}) => {
  const { currentUser, userProfile } = useAuth();
  const { t } = useLanguage();
  const [index, setIndex] = useState(initialIndex);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [viewsList, setViewsList] = useState<StoryView[]>([]);
  const [showViewersDrawer, setShowViewersDrawer] = useState(false);
  const [myReactionEmoji, setMyReactionEmoji] = useState<string | undefined>(undefined);

  const story = stories[index];
  const isOwner = Boolean(currentUser && story && currentUser.uid === story.authorId);

  useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    setShowViewersDrawer(false);
  }, [story?.storyId]);

  // Record view in stories/{storyId}/views/{viewerId} (strictly 1 unique view per non-author account)
  useEffect(() => {
    if (!story || !currentUser || !userProfile) return;
    if (currentUser.uid === story.authorId) return;

    recordViewStat({
      targetUserId: story.authorId,
      viewerId: currentUser.uid,
      kind: 'story',
      targetId: story.storyId,
    });

    const viewRef = doc(db, 'stories', story.storyId, 'views', currentUser.uid);
    getDoc(viewRef)
      .then((snap) => {
        const now = new Date().toISOString();
        const existing = snap.exists() ? (snap.data() as StoryView) : null;
        if (existing?.reactionEmoji) {
          setMyReactionEmoji(existing.reactionEmoji);
        } else {
          setMyReactionEmoji(undefined);
        }
        return setDoc(
          viewRef,
          {
            viewerId: currentUser.uid,
            storyId: story.storyId,
            viewerUsername: userProfile.username,
            viewerDisplayName: userProfile.displayName,
            ...(userProfile.photoURL ? { viewerPhotoURL: userProfile.photoURL } : {}),
            ...(existing?.reactionEmoji ? { reactionEmoji: existing.reactionEmoji } : {}),
            viewedAt: existing?.viewedAt || now,
            updatedAt: now,
          },
          { merge: true }
        );
      })
      .catch(() => {});
  }, [story?.storyId, story?.authorId, currentUser, userProfile]);

  // Listen to ordered viewers + story-only emoji reactions
  useEffect(() => {
    if (!story) return;
    const q = query(
      collection(db, 'stories', story.storyId, 'views'),
      orderBy('viewedAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: StoryView[] = [];
        snap.forEach((d) => list.push(d.data() as StoryView));
        setViewsList(list);
        if (currentUser) {
          const mine = list.find((v) => v.viewerId === currentUser.uid);
          setMyReactionEmoji(mine?.reactionEmoji);
        }
      },
      () => {}
    );
    return () => unsub();
  }, [story?.storyId, currentUser]);

  if (!story) return null;

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2400);
  };

  // Send text reply message directly to story author's 1-on-1 chat inbox (replies only, NOT emoji reactions)
  const sendDirectStoryMessage = async (textToSend: string) => {
    if (!userProfile || !currentUser || story.authorId === currentUser.uid) {
      showToast(textToSend);
      return;
    }

    const ids = [currentUser.uid, story.authorId].sort();
    const chatId = `chat_${ids[0]}_${ids[1]}`;
    const messageId = `msg_story_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const msgData: ChatMessage = {
      messageId,
      chatId,
      senderId: userProfile.userId,
      senderUsername: userProfile.username,
      senderDisplayName: userProfile.displayName,
      senderPhotoURL: userProfile.photoURL,
      receiverId: story.authorId,
      type: 'text',
      text: textToSend,
      status: 'sent',
      createdAt: now,
    };

    await setDoc(doc(db, 'chats', chatId, 'messages', messageId), msgData);
    await setDoc(
      doc(db, 'chats', chatId),
      {
        chatId,
        participantIds: [userProfile.userId, story.authorId],
        lastMessage: textToSend,
        lastMessageTime: now,
        lastSenderId: userProfile.userId,
        unreadCounts: {
          [story.authorId]: increment(1),
        },
        updatedAt: now,
      },
      { merge: true }
    );
  };

  // Story-ONLY emoji reaction: saves on story view record ONLY, never sends to Chat!
  const handleReactEmoji = async (emoji: string) => {
    if (!userProfile || !currentUser) return;
    const viewRef = doc(db, 'stories', story.storyId, 'views', currentUser.uid);
    const now = new Date().toISOString();

    try {
      const snap = await getDoc(viewRef).catch(() => null);
      const existing = snap && snap.exists() ? (snap.data() as StoryView) : null;
      await setDoc(
        viewRef,
        {
          viewerId: currentUser.uid,
          storyId: story.storyId,
          viewerUsername: userProfile.username,
          viewerDisplayName: userProfile.displayName,
          ...(userProfile.photoURL ? { viewerPhotoURL: userProfile.photoURL } : {}),
          reactionEmoji: emoji,
          viewedAt: existing?.viewedAt || now,
          updatedAt: now,
        },
        { merge: true }
      );
      setMyReactionEmoji(emoji);

      if (story.authorId !== currentUser.uid) {
        await createAppNotification({
          recipientId: story.authorId,
          actor: userProfile,
          type: 'like',
          text: `reacted ${emoji} to your story`,
        });
      }
      showToast(`Reacted ${emoji} on story`);
    } catch {
      // quiet fail
    }
  };

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || sending || !userProfile) return;
    setSending(true);
    try {
      const formatted = `Story reply: "${replyText.trim()}"`;
      await sendDirectStoryMessage(formatted);
      await createAppNotification({
        recipientId: story.authorId,
        actor: userProfile,
        type: 'comment',
        text: replyText.trim(),
      });
      setReplyText('');
      showToast(`Message sent to ${story.authorDisplayName}'s Chats!`);
    } catch (err) {
      console.error('Story reply failed:', err);
    } finally {
      setSending(false);
    }
  };

  const handleDeleteStory = async () => {
    await deleteDoc(doc(db, 'stories', story.storyId)).catch(() => {});
    onClose();
  };

  const handleEditClick = () => {
    if (story.mediaType === 'image') {
      showToast(t('storyPhotoNoEdit'));
      return;
    }
    onClose();
    onEditStory?.(story);
  };

  const viewerTotalCount = viewsList.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md h-full sm:h-[88vh] sm:rounded-3xl overflow-hidden bg-slate-950 flex flex-col justify-between shadow-2xl border border-white/10">
        {/* Top Progress Bars + Author Header */}
        <div className="p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent z-20 space-y-3">
          <div className="flex gap-1">
            {stories.map((s, i) => (
              <div key={s.storyId} className="h-1 flex-1 rounded-full bg-white/25 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    i <= index ? 'bg-white w-full' : 'w-0'
                  }`}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => {
                onClose();
                onViewProfile(story.authorId);
              }}
              className="flex items-center gap-2.5 text-left min-w-0"
            >
              <img
                src={
                  story.authorPhotoURL ||
                  `https://api.dicebear.com/7.x/bottts/svg?seed=${story.authorUsername}`
                }
                alt={story.authorDisplayName}
                className="w-9 h-9 rounded-full object-cover ring-2 ring-[#7560DF] shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-white leading-tight truncate">
                    {story.authorDisplayName}
                  </p>
                  {story.editedAt && <span className="text-[10px] text-white/60">(edited)</span>}
                </div>
                <p className="text-[11px] text-white/70 truncate">@{story.authorUsername}</p>
              </div>
            </button>

            <div className="flex items-center gap-1.5 shrink-0">
              {isOwner ? (
                <button
                  type="button"
                  onClick={() => setShowViewersDrawer((prev) => !prev)}
                  className="px-2.5 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold flex items-center gap-1 transition-colors"
                  title={t('storyViewersTitle')}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{viewerTotalCount}</span>
                </button>
              ) : (
                <span className="px-2 py-1 rounded-full bg-white/15 text-white text-[11px] font-semibold flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" />
                  <span>{Math.max(1, viewerTotalCount)}</span>
                </span>
              )}

              {isOwner && (
                <>
                  <button
                    type="button"
                    onClick={handleEditClick}
                    className={`p-2 rounded-full bg-white/10 transition-colors ${
                      story.mediaType === 'image'
                        ? 'text-white/40 hover:bg-white/15'
                        : 'text-white hover:bg-white/25'
                    }`}
                    title={story.mediaType === 'image' ? t('storyPhotoNoEdit') : t('editStory')}
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={handleDeleteStory}
                    className="p-2 rounded-full bg-white/10 text-rose-400 hover:bg-rose-500/20"
                    title="Delete Story"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Center Story Media / Gradient Card */}
        <div className="flex-1 relative flex items-center justify-center overflow-hidden">
          {index > 0 && (
            <button
              onClick={() => setIndex(index - 1)}
              className="absolute left-2 z-20 p-2 rounded-full bg-black/40 text-white hover:bg-black/60"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          {index < stories.length - 1 && (
            <button
              onClick={() => setIndex(index + 1)}
              className="absolute right-2 z-20 p-2 rounded-full bg-black/40 text-white hover:bg-black/60"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}

          {story.mediaType === 'image' && story.mediaUrl ? (
            <img src={story.mediaUrl} alt="Story" className="w-full h-full object-contain" />
          ) : story.mediaType === 'video' && story.mediaUrl ? (
            <video src={story.mediaUrl} controls autoPlay className="w-full h-full object-contain" />
          ) : (
            <div
              className={`w-full h-full bg-gradient-to-br ${
                story.bgGradient || 'from-[#7560DF] to-rose-500'
              } flex items-center justify-center p-8 text-center`}
            >
              <p className="text-white text-xl font-extrabold leading-relaxed">{story.content}</p>
            </div>
          )}

          {story.mediaType !== 'none' && story.content && (
            <div className="absolute bottom-3 inset-x-4 px-4 py-2 rounded-2xl bg-black/55 backdrop-blur-md text-white text-xs sm:text-sm text-center">
              {story.content}
            </div>
          )}

          {toastMsg && (
            <div className="absolute top-4 px-4 py-2 rounded-full bg-[#7560DF] text-white text-xs font-bold shadow-lg animate-in fade-in duration-150">
              {toastMsg}
            </div>
          )}

          {/* Ordered Viewers Drawer (Owner Only — emoji BEFORE name only if reacted) */}
          {isOwner && showViewersDrawer && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-x-0 bottom-0 top-12 z-30 bg-slate-950/95 backdrop-blur-md border-t border-white/15 flex flex-col animate-in slide-in-from-bottom duration-200"
            >
              <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2 text-white">
                  <Eye className="w-4 h-4 text-[#A798F8]" />
                  <h4 className="font-extrabold text-sm">
                    {t('storyViewersTitle')} ({viewsList.length})
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setShowViewersDrawer(false)}
                  className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {viewsList.length === 0 ? (
                  <p className="text-center text-xs text-white/50 py-10">
                    No one has viewed this story yet.
                  </p>
                ) : (
                  viewsList.map((v) => (
                    <button
                      key={v.viewerId}
                      type="button"
                      onClick={() => {
                        onClose();
                        onViewProfile(v.viewerId);
                      }}
                      className="w-full p-2.5 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center gap-3 text-left transition-colors"
                    >
                      <img
                        src={
                          v.viewerPhotoURL ||
                          `https://api.dicebear.com/7.x/bottts/svg?seed=${v.viewerUsername}`
                        }
                        alt={v.viewerDisplayName}
                        className="w-10 h-10 rounded-full object-cover ring-1 ring-white/20 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-white truncate">
                          {v.reactionEmoji ? `${v.reactionEmoji} ${v.viewerDisplayName}` : v.viewerDisplayName}
                        </p>
                        <p className="text-[11px] text-white/60 truncate">@{v.viewerUsername}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom 8 Emoji Reactions (Story-Only) + Direct-to-Messages Story Comment Bar */}
        <div className="p-3.5 bg-gradient-to-t from-black via-black/90 to-transparent z-20 space-y-3">
          {!isOwner && (
            <>
              <div className="flex items-center justify-between gap-1 bg-white/10 backdrop-blur-md rounded-2xl px-2 py-1.5">
                {STORY_EMOJIS.map((item) => {
                  const selected = myReactionEmoji === item.emoji;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => handleReactEmoji(item.emoji)}
                      title={item.label}
                      className={`text-xl sm:text-2xl hover:scale-125 active:scale-95 transition-transform p-1 rounded-full ${
                        selected ? 'bg-white/25 scale-110' : ''
                      }`}
                    >
                      {item.emoji}
                    </button>
                  );
                })}
              </div>

              <form onSubmit={handleSendComment} className="flex items-center gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={t('replyToStory')}
                  className="flex-1 px-4 py-2.5 rounded-full bg-white/15 border border-white/20 text-white placeholder:text-white/60 text-xs sm:text-sm outline-none focus:ring-2 focus:ring-[#7560DF]"
                />
                <button
                  type="submit"
                  disabled={!replyText.trim() || sending}
                  className="p-2.5 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white disabled:opacity-40 transition-all"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
