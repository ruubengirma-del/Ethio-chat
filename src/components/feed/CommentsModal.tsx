import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  increment, 
  updateDoc, 
  onSnapshot, 
  query, 
  orderBy 
} from 'firebase/firestore';
import { Comment, Post } from '../../types';
import { compressImage } from '../../lib/mediaCompression';
import {
  createAppNotification,
  dispatchMentionNotifications,
  extractMentionedUsers,
  extractMentionUsernames,
  REACTION_EMOJIS_8,
} from '../../lib/socialHelpers';
import { dispatchPushNotification } from '../../lib/pushNotifications';
import { AudioRecorder } from '../chat/AudioRecorder';
import { GoldVerifiedBadge } from '../common/GoldVerifiedBadge';
import { 
  X, 
  Send, 
  Trash2, 
  MessageCircle, 
  Image as ImageIcon, 
  Mic, 
  Play, 
  Pause, 
  MessageSquareOff,
  CornerDownRight,
  Edit3,
  SmilePlus,
  Check
} from 'lucide-react';

interface CommentsModalProps {
  post: Post | null;
  onClose: () => void;
  onViewProfile?: (userId: string) => void;
  highlightedCommentId?: string | null;
  onClearHighlightedComment?: () => void;
}

export const CommentsModal: React.FC<CommentsModalProps> = ({
  post,
  onClose,
  onViewProfile,
  highlightedCommentId,
  onClearHighlightedComment,
}) => {
  const { userProfile, allUsers } = useAuth();
  const { t } = useLanguage();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const [editingComment, setEditingComment] = useState<Comment | null>(null);
  const [openPickerCommentId, setOpenPickerCommentId] = useState<string | null>(null);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!post) return;

    const q = query(
      collection(db, 'posts', post.postId, 'comments'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Comment[] = [];
      snapshot.forEach((d) => {
        list.push(d.data() as Comment);
      });
      setComments(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `posts/${post.postId}/comments`);
    });

    return () => unsubscribe();
  }, [post]);

  // Scroll to & briefly highlight a comment opened from a notification/deep-link
  useEffect(() => {
    if (!post || !highlightedCommentId || comments.length === 0) return;
    const exists = comments.some((c) => c.commentId === highlightedCommentId);
    if (!exists) return;

    const scrollTimer = setTimeout(() => {
      const el = document.getElementById(`comment-${highlightedCommentId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setActiveHighlightId(highlightedCommentId);
    }, 120);

    const clearTimer = setTimeout(() => {
      setActiveHighlightId((prev) => (prev === highlightedCommentId ? null : prev));
      onClearHighlightedComment?.();
    }, 3200);

    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [post, highlightedCommentId, comments, onClearHighlightedComment]);

  // Group top-level comments and nested replies (Facebook style)
  const { topLevelComments, repliesByParent } = useMemo(() => {
    const top: Comment[] = [];
    const repliesMap = new Map<string, Comment[]>();

    comments.forEach((c) => {
      if (c.parentCommentId) {
        const arr = repliesMap.get(c.parentCommentId) || [];
        arr.push(c);
        repliesMap.set(c.parentCommentId, arr);
      } else {
        top.push(c);
      }
    });

    // If any reply references a deleted parent, keep it visible as top-level fallback
    const topIds = new Set(top.map((c) => c.commentId));
    repliesMap.forEach((arr, parentId) => {
      if (!topIds.has(parentId)) {
        arr.forEach((orphan) => top.push(orphan));
        repliesMap.delete(parentId);
      }
    });

    top.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return { topLevelComments: top, repliesByParent: repliesMap };
  }, [comments]);

  if (!post) return null;

  const handleTextChange = (val: string) => {
    setNewComment(val);
    const match = val.match(/@([a-zA-Z0-9_]*)$/);
    if (match) {
      setMentionQuery(match[1].toLowerCase());
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (username: string) => {
    const replaced = newComment.replace(/@([a-zA-Z0-9_]*)$/, `@${username} `);
    setNewComment(replaced);
    setMentionQuery(null);
  };

  const mentionCandidates =
    mentionQuery !== null
      ? allUsers
          .filter(
            (u) =>
              u.username.toLowerCase().includes(mentionQuery) ||
              u.displayName.toLowerCase().includes(mentionQuery)
          )
          .slice(0, 5)
      : [];

  const handleSelectImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await compressImage(file, 800, 800, 0.75);
      setAttachedImage(res.dataUrl);
    } catch (err) {
      console.error('Comment image error:', err);
    }
  };

  const startReply = (comment: Comment) => {
    setEditingComment(null);
    setReplyingTo(comment);
    setOpenPickerCommentId(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const startEditComment = (comment: Comment) => {
    if (userProfile?.userId !== comment.authorId) return;
    setReplyingTo(null);
    setAttachedImage(null);
    setEditingComment(comment);
    setNewComment(comment.text || '');
    setOpenPickerCommentId(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleToggleCommentReaction = async (comment: Comment, emoji: string) => {
    if (!userProfile || !post) return;
    setOpenPickerCommentId(null);
    const currentReactions = { ...(comment.reactions || {}) };
    const existing = Array.isArray(currentReactions[emoji]) ? [...currentReactions[emoji]] : [];
    const hasReacted = existing.includes(userProfile.userId);
    const updated = hasReacted
      ? existing.filter((uid) => uid !== userProfile.userId)
      : [...existing, userProfile.userId];

    if (updated.length === 0) {
      delete currentReactions[emoji];
    } else {
      currentReactions[emoji] = updated;
    }

    try {
      await updateDoc(doc(db, 'posts', post.postId, 'comments', comment.commentId), {
        reactions: currentReactions,
      });

      if (!hasReacted && comment.authorId !== userProfile.userId) {
        await createAppNotification({
          recipientId: comment.authorId,
          actor: userProfile,
          type: 'like',
          postId: post.postId,
          text: `reacted ${emoji} to your comment: ${(comment.text || '').slice(0, 60)}`,
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `posts/${post.postId}/comments/${comment.commentId}`);
    }
  };

  const submitCommentPayload = async (opts: {
    text: string;
    mediaUrl?: string;
    mediaType: 'none' | 'image' | 'audio';
    audioDuration?: number;
  }) => {
    if (!userProfile || isSubmitting) return;
    setIsSubmitting(true);

    const mentionedUsers = extractMentionedUsers(opts.text, allUsers);
    const commentId = `comment_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    // Flatten deeper replies under the root parent comment for clean 2-level Facebook nesting
    const targetParentId = replyingTo ? (replyingTo.parentCommentId || replyingTo.commentId) : undefined;

    const commentData: Comment = {
      commentId,
      postId: post.postId,
      authorId: userProfile.userId,
      authorUsername: userProfile.username,
      authorDisplayName: userProfile.displayName,
      authorPhotoURL: userProfile.photoURL,
      text: opts.text,
      mediaUrl: opts.mediaUrl || '',
      mediaType: opts.mediaType,
      ...(opts.audioDuration ? { audioDuration: opts.audioDuration } : {}),
      mentions: mentionedUsers.map((u) => u.userId),
      ...(targetParentId ? {
        parentCommentId: targetParentId,
        replyToAuthorId: replyingTo!.authorId,
        replyToUsername: replyingTo!.authorUsername,
      } : {}),
      createdAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'posts', post.postId, 'comments', commentId), commentData);
      await updateDoc(doc(db, 'posts', post.postId), {
        commentsCount: increment(1),
      }).catch(async () => {
        await setDoc(
          doc(db, 'posts', post.postId),
          { ...post, commentsCount: (post.commentsCount || 0) + 1 },
          { merge: true }
        );
      });

      // Notify post author
      await createAppNotification({
        recipientId: post.authorId,
        actor: userProfile,
        type: 'comment',
        postId: post.postId,
        commentId,
        text: opts.text || (opts.mediaType === 'audio' ? 'Voice comment' : 'Photo comment'),
      });
      if (post.authorId !== userProfile.userId) {
        const pushSnippet = opts.text || (opts.mediaType === 'audio' ? 'Voice comment' : 'Photo comment');
        void dispatchPushNotification({
          type: 'comment',
          toUserId: post.authorId,
          fromUsername: userProfile.username,
          title: `${userProfile.displayName} commented`,
          text: pushSnippet,
          postId: post.postId,
          commentId,
        });
      }

      // Notify replied comment author if different from post author
      if (replyingTo && replyingTo.authorId !== post.authorId) {
        await createAppNotification({
          recipientId: replyingTo.authorId,
          actor: userProfile,
          type: 'comment',
          postId: post.postId,
          commentId,
          text: `replied to your comment: ${opts.text}`,
        });
        if (replyingTo.authorId !== userProfile.userId) {
          void dispatchPushNotification({
            type: 'comment',
            toUserId: replyingTo.authorId,
            fromUsername: userProfile.username,
            title: `${userProfile.displayName} replied`,
            text: opts.text || 'Replied to your comment',
            postId: post.postId,
            commentId,
          });
        }
      }

      // Notify any @mentioned users via Firestore + Push (with commentId)
      await dispatchMentionNotifications({
        text: opts.text,
        postId: post.postId,
        commentId,
        actor: userProfile,
        knownUsers: allUsers,
      });

      setNewComment('');
      setAttachedImage(null);
      setReplyingTo(null);
      setMentionQuery(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `posts/${post.postId}/comments/${commentId}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (post.commentsDisabled) return;

    if (editingComment) {
      const updatedText = newComment.trim();
      if (!updatedText) return;
      setIsSubmitting(true);
      try {
        await updateDoc(doc(db, 'posts', post.postId, 'comments', editingComment.commentId), {
          text: updatedText,
          editedAt: new Date().toISOString(),
        });

        if (userProfile) {
          const prevHandles = new Set(
            extractMentionUsernames(editingComment.text || '').map((h) => h.toLowerCase())
          );
          const addedHandles = extractMentionUsernames(updatedText).filter(
            (h) => !prevHandles.has(h.toLowerCase())
          );
          if (addedHandles.length > 0) {
            await dispatchMentionNotifications({
              text: updatedText,
              postId: post.postId,
              commentId: editingComment.commentId,
              actor: userProfile,
              knownUsers: allUsers,
              onlyHandles: addedHandles,
            });
          }
        }

        setEditingComment(null);
        setNewComment('');
        setMentionQuery(null);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `posts/${post.postId}/comments/${editingComment.commentId}`);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!newComment.trim() && !attachedImage) return;
    await submitCommentPayload({
      text: newComment.trim(),
      mediaUrl: attachedImage || undefined,
      mediaType: attachedImage ? 'image' : 'none',
    });
  };

  const handleSendVoiceComment = async (audioDataUrl: string, durationSeconds: number) => {
    setIsRecordingAudio(false);
    if (post.commentsDisabled) return;
    await submitCommentPayload({
      text: newComment.trim() || 'Voice comment',
      mediaUrl: audioDataUrl,
      mediaType: 'audio',
      audioDuration: durationSeconds,
    });
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await deleteDoc(doc(db, 'posts', post.postId, 'comments', commentId));
      await updateDoc(doc(db, 'posts', post.postId), {
        commentsCount: increment(-1)
      }).catch(() => {});
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `posts/${post.postId}/comments/${commentId}`);
    }
  };

  const toggleAudio = (commentId: string, url?: string) => {
    if (!url) return;
    if (playingId === commentId) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingId(commentId);
    audio.onended = () => setPlayingId(null);
    audio.play().catch(() => setPlayingId(null));
  };

  const renderCommentText = (text: string) => {
    return text.split(/(\s+)/).map((word, idx) =>
      word.startsWith('@') && word.length > 1 ? (
        <span key={idx} className="text-[#7560DF] dark:text-[#A798F8] font-bold">
          {word}
        </span>
      ) : (
        word
      )
    );
  };

  const formatTime = (isoString: string) => {
    try {
      const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
      if (diff < 60) return 'Just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
      return `${Math.floor(diff / 86400)}d`;
    } catch {
      return '';
    }
  };

  const renderCommentItem = (comment: Comment, isNested = false) => {
    const isMine = userProfile?.userId === comment.authorId;
    const reactionEntries = Object.entries(comment.reactions || {}).filter(
      ([, uids]) => Array.isArray(uids) && uids.length > 0
    );
    const totalReactions = reactionEntries.reduce((sum, [, uids]) => sum + uids.length, 0);
    const pickerOpen = openPickerCommentId === comment.commentId;
    const isHighlighted = activeHighlightId === comment.commentId;

    return (
      <div
        key={comment.commentId}
        id={`comment-${comment.commentId}`}
        className={`flex gap-2.5 items-start transition-all duration-500 ${isNested ? 'mt-2.5' : ''} ${
          isHighlighted
            ? 'p-2 -m-2 rounded-2xl bg-[#7560DF]/15 dark:bg-[#7560DF]/25 ring-2 ring-[#7560DF] shadow-md'
            : ''
        }`}
      >
        <button
          type="button"
          onClick={() => {
            if (onViewProfile) {
              onClose();
              onViewProfile(comment.authorId);
            }
          }}
          className="shrink-0"
        >
          <img
            src={comment.authorPhotoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${comment.authorUsername}`}
            alt={comment.authorDisplayName}
            className={`${isNested ? 'w-6 h-6' : 'w-8 h-8'} rounded-full object-cover ring-1 ring-slate-200 dark:ring-purple-900/40 hover:ring-[#7560DF] transition-all`}
          />
        </button>
        <div className="flex-1 min-w-0">
          <div className="bg-slate-100 dark:bg-[#201c38] px-3.5 py-2.5 rounded-2xl rounded-tl-sm text-sm inline-block max-w-full space-y-1.5">
            <button
              type="button"
              onClick={() => {
                if (onViewProfile) {
                  onClose();
                  onViewProfile(comment.authorId);
                }
              }}
              className="flex items-center gap-2 flex-wrap text-left hover:opacity-80"
            >
              <span className="font-bold text-xs text-slate-900 dark:text-white hover:underline inline-flex items-center gap-1">
                <span>{comment.authorDisplayName}</span>
                <GoldVerifiedBadge userId={comment.authorId} size="xs" />
              </span>
              <span className="text-[11px] text-[#7560DF] dark:text-[#A798F8] font-medium">
                @{comment.authorUsername}
              </span>
            </button>

            {comment.replyToUsername && (
              <div className="text-[11px] font-semibold text-[#7560DF] dark:text-[#A798F8] flex items-center gap-1">
                <CornerDownRight className="w-3 h-3" />
                <span>@{comment.replyToUsername}</span>
              </div>
            )}

            {comment.text && (
              <p className="text-slate-800 dark:text-slate-200 text-xs sm:text-sm leading-relaxed break-words">
                {renderCommentText(comment.text)}
              </p>
            )}

            {comment.mediaType === 'image' && comment.mediaUrl && (
              <img
                src={comment.mediaUrl}
                alt="Comment attachment"
                className="max-h-48 rounded-xl object-cover"
              />
            )}

            {comment.mediaType === 'audio' && comment.mediaUrl && (
              <div className="flex items-center gap-2.5 pt-0.5 min-w-[170px]">
                <button
                  onClick={() => toggleAudio(comment.commentId, comment.mediaUrl)}
                  className="p-2 rounded-full bg-[#7560DF] text-white"
                >
                  {playingId === comment.commentId ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5 ml-0.5" />
                  )}
                </button>
                <div className="text-xs text-slate-500 dark:text-slate-300 font-mono">
                  Voice comment ({comment.audioDuration || 3}s)
                </div>
              </div>
            )}
          </div>

          {/* 8-Emoji Reaction Pills on Comment */}
          {reactionEntries.length > 0 && (
            <div className="flex items-center gap-1 mt-1 ml-1 flex-wrap">
              {reactionEntries.map(([emoji, uids]) => {
                const reactedByMe = userProfile ? uids.includes(userProfile.userId) : false;
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleToggleCommentReaction(comment, emoji)}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 border transition-transform active:scale-95 ${
                      reactedByMe
                        ? 'bg-[#7560DF]/20 border-[#7560DF] text-[#7560DF] dark:text-[#B09EFC]'
                        : 'bg-white dark:bg-[#1a1633] border-slate-200 dark:border-purple-900/50 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span>{emoji}</span>
                    <span>{uids.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Comment Action Row: Time, Like (8 Emojis), Reply, Edit, Delete */}
          <div className="flex items-center gap-3.5 mt-1 ml-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold flex-wrap">
            <span className="font-normal">
              {formatTime(comment.createdAt)}
              {comment.editedAt && <span className="ml-1 italic">({t('editedLabel')})</span>}
            </span>

            <button
              type="button"
              onClick={() => setOpenPickerCommentId(pickerOpen ? null : comment.commentId)}
              className={`flex items-center gap-1 transition-colors ${
                totalReactions > 0 ? 'text-[#7560DF] dark:text-[#A798F8]' : 'hover:text-[#7560DF] dark:hover:text-[#A798F8]'
              }`}
            >
              <SmilePlus className="w-3.5 h-3.5" />
              <span>{t('like')}</span>
            </button>

            {!post.commentsDisabled && (
              <button
                type="button"
                onClick={() => startReply(comment)}
                className="hover:text-[#7560DF] dark:hover:text-[#A798F8] transition-colors"
              >
                {t('reply')}
              </button>
            )}

            {isMine && (
              <>
                <button
                  type="button"
                  onClick={() => startEditComment(comment)}
                  className="hover:text-[#7560DF] dark:hover:text-[#A798F8] flex items-center gap-1 transition-colors"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>{t('editComment')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteComment(comment.commentId)}
                  className="text-rose-500 hover:text-rose-600 flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{t('deleteComment')}</span>
                </button>
              </>
            )}
          </div>

          {/* Inline 8-Emoji Reaction Picker for this comment */}
          {pickerOpen && (
            <div className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-2xl bg-white dark:bg-[#241f42] border border-slate-200 dark:border-purple-900/60 shadow-lg animate-in zoom-in-95 duration-150">
              {REACTION_EMOJIS_8.map((item) => {
                const reacted = userProfile ? comment.reactions?.[item.emoji]?.includes(userProfile.userId) : false;
                return (
                  <button
                    key={item.emoji}
                    type="button"
                    onClick={() => handleToggleCommentReaction(comment, item.emoji)}
                    title={item.label}
                    className={`text-lg p-1 rounded-xl transition-transform hover:scale-125 ${
                      reacted ? 'bg-[#7560DF]/20 ring-1 ring-[#7560DF]' : ''
                    }`}
                  >
                    {item.emoji}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 flex flex-col h-[86vh] sm:h-[670px] overflow-hidden relative">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-[#7560DF]" />
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              {t('comment')} ({comments.length})
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/30 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Post Context Snip */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-purple-950/20 border-b border-slate-100 dark:border-purple-950/40 text-xs text-slate-600 dark:text-slate-300">
          <span className="font-bold text-slate-800 dark:text-slate-200">{post.authorDisplayName}:</span>{' '}
          {post.content.slice(0, 100)}{post.content.length > 100 ? '...' : ''}
        </div>

        {/* Comments List */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          {topLevelComments.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
              <MessageCircle className="w-10 h-10 mb-2 opacity-40 text-[#7560DF]" />
              <p className="text-sm font-semibold">No comments yet</p>
              <p className="text-xs">Reply with text, @mentions, a photo, or a voice note!</p>
            </div>
          ) : (
            topLevelComments.map((comment) => {
              const replies = repliesByParent.get(comment.commentId) || [];
              return (
                <div key={comment.commentId}>
                  {renderCommentItem(comment, false)}
                  {replies.length > 0 && (
                    <div className="ml-8 pl-3 border-l-2 border-slate-200 dark:border-purple-900/50 space-y-1">
                      {replies.map((reply) => renderCommentItem(reply, true))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* @Mention Autocomplete Popup */}
        {mentionCandidates.length > 0 && !post.commentsDisabled && (
          <div className="mx-4 mb-1 rounded-2xl border border-slate-200 dark:border-purple-900/50 bg-white dark:bg-[#1f1b38] shadow-lg overflow-hidden">
            {mentionCandidates.map((u) => (
              <button
                key={u.userId}
                type="button"
                onClick={() => insertMention(u.username)}
                className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-[#7560DF]/10 text-left text-xs"
              >
                <img
                  src={u.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`}
                  alt={u.displayName}
                  className="w-6 h-6 rounded-full object-cover"
                />
                <span className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-1">
                  <span>{u.displayName}</span>
                  <GoldVerifiedBadge userId={u.userId} size="xs" />
                </span>
                <span className="text-slate-400">@{u.username}</span>
              </button>
            ))}
          </div>
        )}

        {/* Editing Comment Banner */}
        {editingComment && (
          <div className="px-4 py-2 border-t border-slate-100 dark:border-purple-950/40 bg-[#7560DF]/10 flex items-center justify-between text-xs">
            <span className="text-[#7560DF] dark:text-[#B09EFC] font-semibold flex items-center gap-1.5 truncate">
              <Edit3 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{t('editingComment')}: "{editingComment.text}"</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setEditingComment(null);
                setNewComment('');
              }}
              className="p-1 rounded-full text-slate-400 hover:text-rose-500"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Replying To Banner */}
        {replyingTo && !editingComment && (
          <div className="px-4 py-2 border-t border-slate-100 dark:border-purple-950/40 bg-[#7560DF]/10 flex items-center justify-between text-xs">
            <span className="text-[#7560DF] dark:text-[#B09EFC] font-semibold flex items-center gap-1.5 truncate">
              <CornerDownRight className="w-3.5 h-3.5 shrink-0" />
              <span>{t('replyingTo')} @{replyingTo.authorUsername}</span>
            </span>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="p-1 rounded-full text-slate-400 hover:text-rose-500"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Attached Photo Preview */}
        {attachedImage && (
          <div className="px-4 py-2 border-t border-slate-100 dark:border-purple-950/40 flex items-center gap-3 bg-slate-50 dark:bg-[#1a1633]">
            <img src={attachedImage} alt="Preview" className="w-12 h-12 rounded-xl object-cover" />
            <span className="text-xs text-slate-500 flex-1">Photo attached to comment</span>
            <button
              type="button"
              onClick={() => setAttachedImage(null)}
              className="p-1 rounded-full text-slate-400 hover:text-rose-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Comment Input Bar or Comments Disabled Notice */}
        {post.commentsDisabled ? (
          <div className="p-4 border-t border-slate-100 dark:border-purple-950/40 bg-slate-50 dark:bg-[#120f24] flex items-center justify-center gap-2 text-xs font-semibold text-slate-500">
            <MessageSquareOff className="w-4 h-4 text-amber-500" />
            <span>{t('commentsOffNotice')}</span>
          </div>
        ) : isRecordingAudio ? (
          <div className="p-3 border-t border-slate-100 dark:border-purple-950/40 bg-white dark:bg-[#16132b] safe-bottom">
            <AudioRecorder
              onSendVoiceNote={handleSendVoiceComment}
              onCancel={() => setIsRecordingAudio(false)}
            />
          </div>
        ) : (
          <form onSubmit={handleAddComment} className="p-3.5 border-t border-slate-100 dark:border-purple-950/40 bg-white dark:bg-[#16132b] flex items-center gap-1.5 safe-bottom">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleSelectImage}
            />
            {!editingComment && (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 rounded-full text-slate-500 hover:text-[#7560DF] hover:bg-slate-100 dark:hover:bg-purple-950/30"
                  title="Attach photo to comment"
                >
                  <ImageIcon className="w-4.5 h-4.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsRecordingAudio(true)}
                  className="p-2 rounded-full text-slate-500 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-purple-950/30"
                  title="Record voice comment"
                >
                  <Mic className="w-4.5 h-4.5" />
                </button>
              </>
            )}

            <input
              ref={inputRef}
              type="text"
              value={newComment}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder={
                editingComment
                  ? 'Edit your comment...'
                  : replyingTo
                  ? `${t('replyingTo')} @${replyingTo.authorUsername}...`
                  : t('writeComment')
              }
              className="flex-1 px-4 py-2 rounded-full bg-slate-100 dark:bg-[#221d3d] text-slate-800 dark:text-white placeholder:text-slate-400 text-xs sm:text-sm outline-none focus:ring-2 focus:ring-[#7560DF]"
            />
            <button
              type="submit"
              disabled={(editingComment ? !newComment.trim() : (!newComment.trim() && !attachedImage)) || isSubmitting}
              className="p-2.5 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white disabled:opacity-40 transition-all shadow-sm"
            >
              {editingComment ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
