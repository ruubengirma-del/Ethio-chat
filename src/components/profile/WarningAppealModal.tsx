import React, { useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { compressImage, processVideoFile } from '../../lib/mediaCompression';
import { ADMIN_MODERATION_EMAIL, getCurrentMonthKey } from '../../lib/socialHelpers';
import {
  X,
  AlertTriangle,
  Send,
  Image as ImageIcon,
  Video as VideoIcon,
  Loader2,
  CheckCircle2,
  Share2,
  Mail,
} from 'lucide-react';

interface WarningAppealModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WarningAppealModal: React.FC<WarningAppealModalProps> = ({ isOpen, onClose }) => {
  const { userProfile } = useAuth();
  const { t } = useLanguage();

  const [appealMessage, setAppealMessage] = useState('');
  const [photoEvidenceUrl, setPhotoEvidenceUrl] = useState('');
  const [videoEvidenceUrl, setVideoEvidenceUrl] = useState('');
  const [isCompressing, setIsCompressing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ emailSent: boolean; mailtoHref: string } | null>(
    null
  );

  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !userProfile) return null;

  const monthlyShares =
    userProfile.monthlySharesMonth === getCurrentMonthKey()
      ? userProfile.monthlySharesCount || 0
      : 0;
  const shareProgressPct = Math.min(100, Math.round((monthlyShares / 400000) * 100));

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsCompressing(true);
    try {
      const res = await compressImage(file, 960, 960, 0.72);
      setPhotoEvidenceUrl(res.dataUrl);
    } catch (err: any) {
      setErrMsg(err?.message || 'Could not compress photo');
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsCompressing(true);
    try {
      const res = await processVideoFile(file);
      setVideoEvidenceUrl(res.dataUrl);
    } catch (err: any) {
      setErrMsg(err?.message || 'Could not process video');
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleSubmitAppeal = async () => {
    if (!appealMessage.trim() && !photoEvidenceUrl && !videoEvidenceUrl) {
      setErrMsg('Please enter an appeal message or attach supporting evidence.');
      return;
    }
    setIsSubmitting(true);
    setErrMsg(null);

    const appealId = `apl_${userProfile.userId}_${Date.now()}`;
    const now = new Date().toISOString();

    let emailSent = false;
    try {
      const mailRes = await fetch('/api/moderation/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'warning_appeal',
          subject: `[Ethio Chat Appeal] @${userProfile.username} (${userProfile.reportsCount || 250}+ reports)`,
          appealMessage: appealMessage.trim(),
          userId: userProfile.userId,
          username: userProfile.username,
          displayName: userProfile.displayName,
          email: userProfile.email,
          reportedReasons: userProfile.warningReasons || [],
          reportsCount: userProfile.reportsCount || 0,
          photoEvidenceUrl: photoEvidenceUrl || undefined,
          videoEvidenceUrl: videoEvidenceUrl || undefined,
        }),
      });
      const mailData = await mailRes.json().catch(() => ({}));
      emailSent = Boolean(mailRes.ok && mailData?.emailSent);
    } catch {
      emailSent = false;
    }

    try {
      await setDoc(doc(db, 'appeals', appealId), {
        appealId,
        userId: userProfile.userId,
        username: userProfile.username,
        displayName: userProfile.displayName,
        email: userProfile.email,
        message: appealMessage.trim(),
        ...(photoEvidenceUrl ? { photoEvidenceUrl } : {}),
        ...(videoEvidenceUrl ? { videoEvidenceUrl } : {}),
        reportedReasons: userProfile.warningReasons || [],
        reportsCountAtAppeal: userProfile.reportsCount || 0,
        status: 'pending',
        recipientEmail: ADMIN_MODERATION_EMAIL,
        emailSent,
        createdAt: now,
      });

      const mailtoHref = `mailto:${ADMIN_MODERATION_EMAIL}?subject=${encodeURIComponent(
        `Warning Appeal from @${userProfile.username}`
      )}&body=${encodeURIComponent(
        `User: ${userProfile.displayName} (@${userProfile.username})\nReports Count: ${userProfile.reportsCount || 0}\nReasons: ${(userProfile.warningReasons || []).join(', ')}\n\nAppeal:\n${appealMessage.trim()}`
      )}`;

      setSubmitted({ emailSent, mailtoHref });
    } catch (err: any) {
      setErrMsg(err?.message || 'Failed to submit appeal.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/75 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border border-amber-200 dark:border-amber-900/50 flex flex-col max-h-[90vh] overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                {t('warningModalTitle')}
              </h3>
              <p className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                Private · Visible only to you (@{userProfile.username})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {submitted ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="font-extrabold text-base text-slate-900 dark:text-white">
              Your appeal has been sent to {ADMIN_MODERATION_EMAIL}!
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {submitted.emailSent
                ? `Your appeal has been emailed directly to ${ADMIN_MODERATION_EMAIL} and saved for review.`
                : `Your appeal was saved to the Moderation Inbox for ${ADMIN_MODERATION_EMAIL}. Server SMTP is not configured yet — you can also send via your email app below.`}
            </p>
            {!submitted.emailSent && (
              <a
                href={submitted.mailtoHref}
                className="w-full py-2.5 px-4 rounded-2xl bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] font-bold text-xs flex items-center justify-center gap-2"
              >
                <Mail className="w-4 h-4" />
                <span>Send Appeal via Email App</span>
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] text-white font-bold text-sm"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {/* Report Summary */}
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 space-y-2">
                <p className="text-xs font-extrabold text-amber-800 dark:text-amber-300">
                  {userProfile.reportsCount || 250}+ reports recorded on your account
                </p>
                <p className="text-[11px] text-amber-700 dark:text-amber-300/90 leading-relaxed">
                  Reported reasons (reaching 2,500 reports will suspend your account):
                </p>
                <ul className="space-y-1 text-xs font-semibold text-slate-800 dark:text-slate-100">
                  {(userProfile.warningReasons && userProfile.warningReasons.length > 0
                    ? userProfile.warningReasons
                    : ['Community guideline reports (250+)']
                  ).map((reason) => (
                    <li key={reason} className="flex items-start gap-1.5">
                      <span className="text-amber-500 font-bold">•</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 400k Monthly Shares Auto-Lift Tracker */}
              <div className="p-4 rounded-2xl bg-[#7560DF]/8 dark:bg-[#7560DF]/15 border border-[#7560DF]/25 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-100">
                  <span className="flex items-center gap-1.5">
                    <Share2 className="w-4 h-4 text-[#7560DF]" />
                    <span>400,000 Monthly Shares Auto-Remove</span>
                  </span>
                  <span className="text-[#7560DF] dark:text-[#A798F8]">
                    {monthlyShares.toLocaleString()} / 400,000
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-[#201c38] overflow-hidden">
                  <div
                    className="h-full bg-[#7560DF] transition-all"
                    style={{ width: `${shareProgressPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  This warning is automatically removed once your posts reach 400,000+ shares within a month.
                </p>
              </div>

              {/* Appeal / Defense Form */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  Send your appeal &amp; evidence to {ADMIN_MODERATION_EMAIL}
                </label>
                <textarea
                  value={appealMessage}
                  onChange={(e) => setAppealMessage(e.target.value)}
                  placeholder="If these reports are inaccurate, explain why and attach supporting evidence below..."
                  rows={4}
                  maxLength={1500}
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#7560DF] resize-none"
                />

                <div className="flex items-center gap-2">
                  <input
                    ref={imgRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoSelect}
                  />
                  <button
                    type="button"
                    onClick={() => imgRef.current?.click()}
                    className="flex-1 py-2.5 px-3 rounded-2xl bg-slate-100 dark:bg-[#201c38] text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5"
                  >
                    <ImageIcon className="w-4 h-4 text-emerald-500" />
                    <span>{photoEvidenceUrl ? 'Photo Added ✓' : 'Evidence Photo'}</span>
                  </button>

                  <input
                    ref={vidRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={handleVideoSelect}
                  />
                  <button
                    type="button"
                    onClick={() => vidRef.current?.click()}
                    className="flex-1 py-2.5 px-3 rounded-2xl bg-slate-100 dark:bg-[#201c38] text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5"
                  >
                    <VideoIcon className="w-4 h-4 text-blue-500" />
                    <span>{videoEvidenceUrl ? 'Video Added ✓' : 'Evidence Video'}</span>
                  </button>
                </div>

                {photoEvidenceUrl && (
                  <img
                    src={photoEvidenceUrl}
                    alt="Appeal evidence"
                    className="w-full max-h-36 object-contain rounded-2xl bg-black/5"
                  />
                )}
                {videoEvidenceUrl && (
                  <video
                    src={videoEvidenceUrl}
                    controls
                    className="w-full max-h-36 object-contain rounded-2xl bg-black"
                  />
                )}
              </div>

              {isCompressing && (
                <div className="flex items-center gap-2 text-xs text-[#7560DF]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Compressing evidence...</span>
                </div>
              )}

              {errMsg && <p className="text-xs font-semibold text-rose-500">{errMsg}</p>}
            </div>

            <div className="px-5 py-4 border-t border-slate-100 dark:border-purple-950/40 bg-slate-50/70 dark:bg-[#120f24]">
              <button
                type="button"
                disabled={isSubmitting || isCompressing}
                onClick={handleSubmitAppeal}
                className="w-full py-3 rounded-2xl bg-[#7560DF] hover:bg-[#624ec7] disabled:opacity-50 text-white font-bold text-sm shadow-md shadow-[#7560DF]/25 flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>{t('appealBtn')}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
