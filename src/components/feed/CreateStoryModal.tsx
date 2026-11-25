import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { compressImage, processVideoFile } from '../../lib/mediaCompression';
import { AudienceVisibility, MediaType, Story } from '../../types';
import { AudienceSelector } from '../common/AudienceSelector';
import {
  X,
  Image as ImageIcon,
  Video as VideoIcon,
  Loader2,
  Sparkles,
  AlertCircle,
  Edit3,
  Lock,
} from 'lucide-react';

interface CreateStoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  editStory?: Story | null;
}

const GRADIENTS = [
  'from-[#7560DF] via-[#9078f3] to-[#EC4899]',
  'from-emerald-500 via-teal-600 to-cyan-700',
  'from-amber-500 via-orange-500 to-rose-600',
  'from-slate-800 via-indigo-900 to-[#7560DF]',
];

function getLocalDayKey(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export const CreateStoryModal: React.FC<CreateStoryModalProps> = ({
  isOpen,
  onClose,
  editStory = null,
}) => {
  const { userProfile } = useAuth();
  const { t } = useLanguage();
  const [content, setContent] = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('none');
  const [mediaUrl, setMediaUrl] = useState('');
  const [bgGradient, setBgGradient] = useState(GRADIENTS[0]);
  const [visibility, setVisibility] = useState<AudienceVisibility>('public');
  const [excludedUserIds, setExcludedUserIds] = useState<string[]>(
    userProfile?.closeFriendsExcludedIds || []
  );
  const [allowedUserIds, setAllowedUserIds] = useState<string[]>(
    userProfile?.selectedFriendIds || []
  );
  const [todayCount, setTodayCount] = useState<number>(0);
  const [checkingLimit, setCheckingLimit] = useState<boolean>(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  const isEditMode = Boolean(editStory);
  const isPhotoEditBlocked = Boolean(editStory && editStory.mediaType === 'image');

  useEffect(() => {
    if (!isOpen || !userProfile) return;
    setErrorMsg(null);

    if (editStory) {
      setContent(editStory.content || '');
      setMediaType(editStory.mediaType);
      setMediaUrl(editStory.mediaUrl || '');
      setBgGradient(editStory.bgGradient || GRADIENTS[0]);
      setVisibility(editStory.visibility || 'public');
      setExcludedUserIds(editStory.excludedUserIds || []);
      setAllowedUserIds(editStory.allowedUserIds || []);
      return;
    }

    setContent('');
    setMediaType('none');
    setMediaUrl('');
    setBgGradient(GRADIENTS[0]);
    setVisibility('public');
    setExcludedUserIds(userProfile.closeFriendsExcludedIds || []);
    setAllowedUserIds(userProfile.selectedFriendIds || []);

    // Check max 2 stories per calendar day limit
    setCheckingLimit(true);
    const todayKey = getLocalDayKey();
    getDocs(query(collection(db, 'stories'), where('authorId', '==', userProfile.userId)))
      .then((snap) => {
        let count = 0;
        snap.forEach((d) => {
          const st = d.data() as Story;
          if (st.createdAt && getLocalDayKey(st.createdAt) === todayKey) {
            count++;
          }
        });
        setTodayCount(count);
        if (count >= 2) {
          setErrorMsg(t('storyDailyLimitError'));
        }
      })
      .catch(() => {})
      .finally(() => setCheckingLimit(false));
  }, [isOpen, userProfile, editStory, t]);

  if (!isOpen || !userProfile) return null;

  const limitReached = !isEditMode && todayCount >= 2;

  const handleSelectImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isEditMode) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setIsCompressing(true);
    try {
      const res = await compressImage(file, 1080, 1920, 0.78);
      setMediaUrl(res.dataUrl);
      setMediaType('image');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to compress story image');
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleSelectVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isEditMode) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setIsCompressing(true);
    try {
      const res = await processVideoFile(file);
      setMediaUrl(res.dataUrl);
      setMediaType('video');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to process story video');
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handlePublishStory = async () => {
    if (isPhotoEditBlocked) {
      setErrorMsg(t('storyPhotoNoEdit'));
      return;
    }

    if (!isEditMode && limitReached) {
      setErrorMsg(t('storyDailyLimitError'));
      return;
    }

    if (!content.trim() && mediaType === 'none') {
      setErrorMsg('Please write text or attach a photo/video for your story.');
      return;
    }

    setIsPublishing(true);
    setErrorMsg(null);

    try {
      if (isEditMode && editStory) {
        await updateDoc(doc(db, 'stories', editStory.storyId), {
          content: content.trim(),
          ...(editStory.mediaType === 'none' ? { bgGradient } : {}),
          visibility,
          excludedUserIds,
          allowedUserIds,
          editedAt: new Date().toISOString(),
        });
        onClose();
        return;
      }

      // Re-verify daily limit before write
      const todayKey = getLocalDayKey();
      const snap = await getDocs(
        query(collection(db, 'stories'), where('authorId', '==', userProfile.userId))
      );
      let count = 0;
      snap.forEach((d) => {
        const st = d.data() as Story;
        if (st.createdAt && getLocalDayKey(st.createdAt) === todayKey) {
          count++;
        }
      });
      if (count >= 2) {
        setTodayCount(count);
        setErrorMsg(t('storyDailyLimitError'));
        return;
      }

      const storyId = `story_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const now = Date.now();
      const story: Story = {
        storyId,
        authorId: userProfile.userId,
        authorUsername: userProfile.username,
        authorDisplayName: userProfile.displayName,
        authorPhotoURL: userProfile.photoURL,
        content: content.trim(),
        mediaUrl: mediaType !== 'none' ? mediaUrl : '',
        mediaType,
        bgGradient,
        visibility,
        excludedUserIds,
        allowedUserIds,
        viewsCount: 0,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      };

      await setDoc(doc(db, 'stories', storyId), story);
      setContent('');
      setMediaType('none');
      setMediaUrl('');
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not save story');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200/80 dark:border-purple-950/60 overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
              {isEditMode ? (
                <Edit3 className="w-4 h-4 text-[#7560DF]" />
              ) : (
                <Sparkles className="w-4 h-4 text-[#7560DF]" />
              )}
              <span>{isEditMode ? t('editStory') : t('createStory')}</span>
            </h2>
            {!isEditMode && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Today: {todayCount} / 2 stories · Disappears after 24h
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {isPhotoEditBlocked ? (
            <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-center space-y-2">
              <Lock className="w-7 h-7 text-amber-500 mx-auto" />
              <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                {t('storyPhotoNoEdit')}
              </p>
            </div>
          ) : (
            <>
              {mediaType === 'none' ? (
                <div
                  className={`rounded-3xl p-6 min-h-[170px] bg-gradient-to-br ${bgGradient} flex flex-col justify-between shadow-inner`}
                >
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Write a story update..."
                    rows={4}
                    maxLength={500}
                    className="w-full bg-transparent text-white placeholder:text-white/70 text-center font-bold text-lg resize-none outline-none my-auto"
                  />
                  <div className="flex items-center justify-center gap-2 pt-2">
                    {GRADIENTS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setBgGradient(g)}
                        className={`w-6 h-6 rounded-full bg-gradient-to-br ${g} ring-2 ${
                          bgGradient === g ? 'ring-white scale-110' : 'ring-white/30'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative rounded-2xl overflow-hidden bg-black">
                    {mediaType === 'image' ? (
                      <img src={mediaUrl} alt="Story preview" className="w-full max-h-64 object-contain" />
                    ) : (
                      <video src={mediaUrl} controls className="w-full max-h-64 object-contain" />
                    )}
                    {!isEditMode && (
                      <button
                        type="button"
                        onClick={() => {
                          setMediaType('none');
                          setMediaUrl('');
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Add or edit caption (optional)..."
                    className="w-full px-4 py-2 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-sm outline-none focus:ring-2 focus:ring-[#7560DF]"
                  />
                </div>
              )}

              {isCompressing && (
                <div className="p-3 rounded-2xl bg-[#7560DF]/10 text-[#7560DF] text-xs flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Compressing story media...</span>
                </div>
              )}

              <AudienceSelector
                visibility={visibility}
                excludedUserIds={excludedUserIds}
                allowedUserIds={allowedUserIds}
                onChange={(next) => {
                  setVisibility(next.visibility);
                  setExcludedUserIds(next.excludedUserIds);
                  setAllowedUserIds(next.allowedUserIds);
                }}
              />
            </>
          )}

          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 dark:border-purple-950/40 flex items-center justify-between gap-2">
          {!isEditMode ? (
            <div className="flex items-center gap-2">
              <input
                ref={imgRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleSelectImage}
              />
              <button
                type="button"
                disabled={limitReached}
                onClick={() => imgRef.current?.click()}
                className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#201c38] text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-200 disabled:opacity-40"
              >
                <ImageIcon className="w-4 h-4 text-emerald-500" />
                <span>{t('photo')}</span>
              </button>

              <input
                ref={vidRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleSelectVideo}
              />
              <button
                type="button"
                disabled={limitReached}
                onClick={() => vidRef.current?.click()}
                className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#201c38] text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-200 disabled:opacity-40"
              >
                <VideoIcon className="w-4 h-4 text-blue-500" />
                <span>{t('video')}</span>
              </button>
            </div>
          ) : (
            <span className="text-[11px] font-semibold text-slate-400">
              Text & video stories can be edited
            </span>
          )}

          <button
            type="button"
            disabled={
              isPublishing ||
              isCompressing ||
              checkingLimit ||
              limitReached ||
              isPhotoEditBlocked ||
              (!content.trim() && mediaType === 'none')
            }
            onClick={handlePublishStory}
            className="px-5 py-2.5 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-sm shadow-md shadow-[#7560DF]/25 disabled:opacity-50 flex items-center gap-2"
          >
            {isPublishing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isEditMode ? (
              <Edit3 className="w-4 h-4" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>{isEditMode ? t('saveChanges') : t('publish')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
