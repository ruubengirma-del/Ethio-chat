import React, { useState, useRef } from 'react';
import { Post } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { compressImage, processVideoFile } from '../../lib/mediaCompression';
import {
  ADMIN_MODERATION_EMAIL,
  REPORT_REASONS,
  createAppNotification,
} from '../../lib/socialHelpers';
import {
  X,
  Flag,
  Image as ImageIcon,
  Video as VideoIcon,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mail,
} from 'lucide-react';

interface ReportModalProps {
  post: Post | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({ post, isOpen, onClose }) => {
  const { currentUser, userProfile } = useAuth();
  const { t } = useLanguage();

  const [selectedReason, setSelectedReason] = useState<string>(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [photoEvidenceUrl, setPhotoEvidenceUrl] = useState<string>('');
  const [videoEvidenceUrl, setVideoEvidenceUrl] = useState<string>('');
  const [isCompressing, setIsCompressing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [doneResult, setDoneResult] = useState<{
    emailSent: boolean;
    mailtoHref?: string;
  } | null>(null);

  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !post || !currentUser || !userProfile) return null;

  const handleSelectPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setIsCompressing(true);
    try {
      const res = await compressImage(file, 960, 960, 0.72);
      setPhotoEvidenceUrl(res.dataUrl);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to compress evidence photo');
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleSelectVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setIsCompressing(true);
    try {
      const res = await processVideoFile(file);
      setVideoEvidenceUrl(res.dataUrl);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load evidence video');
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleSubmitReport = async () => {
    if (!selectedReason || isSending) return;
    setIsSending(true);
    setErrorMsg(null);

    const reportId = `rep_${currentUser.uid}_${post.postId}`;
    const now = new Date().toISOString();

    let emailSent = false;
    try {
      // Dispatch directly to Ruubengirma@gmail.com backend endpoint
      const mailRes = await fetch('/api/moderation/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'post_report',
          subject: `[Ethio Chat Report] ${selectedReason} — @${post.authorUsername}`,
          reason: selectedReason,
          details: details.trim(),
          postId: post.postId,
          postAuthorId: post.authorId,
          postAuthorUsername: post.authorUsername,
          postAuthorDisplayName: post.authorDisplayName,
          postContentSnippet: (post.content || '').slice(0, 300),
          reporterId: userProfile.userId,
          reporterUsername: userProfile.username,
          reporterDisplayName: userProfile.displayName,
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
      await setDoc(doc(db, 'reports', reportId), {
        reportId,
        postId: post.postId,
        postAuthorId: post.authorId,
        postAuthorUsername: post.authorUsername,
        postAuthorDisplayName: post.authorDisplayName,
        postContentSnippet: (post.content || '').slice(0, 200),
        reporterId: userProfile.userId,
        reporterUsername: userProfile.username,
        reporterDisplayName: userProfile.displayName,
        reason: selectedReason,
        ...(details.trim() ? { details: details.trim() } : {}),
        ...(photoEvidenceUrl ? { photoEvidenceUrl } : {}),
        ...(videoEvidenceUrl ? { videoEvidenceUrl } : {}),
        recipientEmail: ADMIN_MODERATION_EMAIL,
        emailSent,
        createdAt: now,
      });

      // Evaluate post threshold (>= 100 unique accounts -> auto-delete post)
      const postReportsSnap = await getDocs(
        query(collection(db, 'reports'), where('postId', '==', post.postId))
      );
      const uniquePostReporters = new Set<string>();
      postReportsSnap.forEach((d) => {
        const rep = d.data();
        if (rep.reporterId) uniquePostReporters.add(rep.reporterId);
      });

      await updateDoc(doc(db, 'posts', post.postId), {
        reportsCount: uniquePostReporters.size,
      }).catch(() => {});

      if (uniquePostReporters.size >= 100) {
        await deleteDoc(doc(db, 'posts', post.postId)).catch(() => {});
        await createAppNotification({
          recipientId: post.authorId,
          actor: userProfile,
          type: 'warning',
          text: `Post deleted after ${uniquePostReporters.size} user reports (${selectedReason}).`,
        });
      }

      // Evaluate author account thresholds (250 -> Warning, 2,500 -> Suspend/Close Account)
      const authorReportsSnap = await getDocs(
        query(collection(db, 'reports'), where('postAuthorId', '==', post.authorId))
      );
      const uniqueAuthorReporters = new Set<string>();
      const reasonCounts = new Map<string, number>();
      authorReportsSnap.forEach((d) => {
        const rep = d.data();
        if (rep.reporterId) uniqueAuthorReporters.add(rep.reporterId);
        if (rep.reason) {
          reasonCounts.set(rep.reason, (reasonCounts.get(rep.reason) || 0) + 1);
        }
      });

      const uniqueUserReportCount = uniqueAuthorReporters.size;
      const topReasons = Array.from(reasonCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([r]) => r)
        .slice(0, 5);

      const authorUpdate: Record<string, any> = {
        reportsCount: uniqueUserReportCount,
      };
      if (uniqueUserReportCount >= 2500) {
        authorUpdate.accountSuspended = true;
        authorUpdate.suspendedAt = now;
        authorUpdate.warningActive = true;
        authorUpdate.warningReasons = topReasons;
      } else if (uniqueUserReportCount >= 250) {
        authorUpdate.warningActive = true;
        authorUpdate.warningReasons = topReasons;
        authorUpdate.warningTriggeredAt = now;
      }

      await updateDoc(doc(db, 'users', post.authorId), authorUpdate).catch(() => {});

      const mailtoHref = `mailto:${ADMIN_MODERATION_EMAIL}?subject=${encodeURIComponent(
        `Ethio Chat Post Report: ${selectedReason}`
      )}&body=${encodeURIComponent(
        `Reported User: ${post.authorDisplayName} (@${post.authorUsername})\nPost ID: ${post.postId}\nReason: ${selectedReason}\nDetails: ${details.trim() || 'N/A'}\nReporter: ${userProfile.displayName} (@${userProfile.username})`
      )}`;

      setDoneResult({ emailSent, mailtoHref });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to submit report.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 flex flex-col max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-rose-500/15 text-rose-500 flex items-center justify-center">
              <Flag className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                {t('reportTitle')}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                @{post.authorUsername} · {ADMIN_MODERATION_EMAIL}
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

        {doneResult ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-1.5">
              <h4 className="font-extrabold text-base text-slate-900 dark:text-white">
                {t('reportSent')}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {doneResult.emailSent
                  ? `Email sent directly to ${ADMIN_MODERATION_EMAIL} and saved for moderation review.`
                  : `Report saved for ${ADMIN_MODERATION_EMAIL} in moderation review. Server SMTP credentials are not configured yet — you can also send directly via your email app below.`}
              </p>
            </div>
            {!doneResult.emailSent && doneResult.mailtoHref && (
              <a
                href={doneResult.mailtoHref}
                className="w-full py-2.5 px-4 rounded-2xl bg-[#7560DF]/15 text-[#7560DF] dark:text-[#B09EFC] font-bold text-xs flex items-center justify-center gap-2 hover:bg-[#7560DF]/25"
              >
                <Mail className="w-4 h-4" />
                <span>Send via Email App to {ADMIN_MODERATION_EMAIL}</span>
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
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {t('reportSubtitle')}
              </p>

              {/* 5 Report Reasons */}
              <div className="space-y-2">
                {REPORT_REASONS.map((reason) => {
                  const selected = selectedReason === reason;
                  return (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setSelectedReason(reason)}
                      className={`w-full p-3 rounded-2xl border text-left text-xs sm:text-sm font-semibold flex items-center justify-between gap-2 transition-all ${
                        selected
                          ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-500 text-rose-700 dark:text-rose-300 shadow-sm'
                          : 'bg-slate-50 dark:bg-[#201c38] border-slate-200 dark:border-purple-950/50 text-slate-800 dark:text-slate-200 hover:border-rose-300'
                      }`}
                    >
                      <span>{reason}</span>
                      <span
                        className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                          selected ? 'border-rose-500 bg-rose-500' : 'border-slate-400'
                        }`}
                      >
                        {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Optional Text Details */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  Additional Details (Optional)
                </label>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Write additional information (optional)..."
                  rows={3}
                  maxLength={1000}
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-500 resize-none"
                />
              </div>

              {/* Optional Photo & Video Evidence */}
              <div className="flex items-center gap-2">
                <input
                  ref={imgRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleSelectPhoto}
                />
                <button
                  type="button"
                  onClick={() => imgRef.current?.click()}
                  className="flex-1 py-2.5 px-3 rounded-2xl bg-slate-100 dark:bg-[#201c38] hover:bg-slate-200 dark:hover:bg-[#2a2549] text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5"
                >
                  <ImageIcon className="w-4 h-4 text-emerald-500" />
                  <span>{photoEvidenceUrl ? 'Photo Attached ✓' : 'Attach Photo'}</span>
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
                  onClick={() => vidRef.current?.click()}
                  className="flex-1 py-2.5 px-3 rounded-2xl bg-slate-100 dark:bg-[#201c38] hover:bg-slate-200 dark:hover:bg-[#2a2549] text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5"
                >
                  <VideoIcon className="w-4 h-4 text-blue-500" />
                  <span>{videoEvidenceUrl ? 'Video Attached ✓' : 'Attach Video'}</span>
                </button>
              </div>

              {photoEvidenceUrl && (
                <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-purple-900/50">
                  <img
                    src={photoEvidenceUrl}
                    alt="Evidence"
                    className="w-full max-h-40 object-contain bg-black/5"
                  />
                  <button
                    type="button"
                    onClick={() => setPhotoEvidenceUrl('')}
                    className="absolute top-2 right-2 p-1 rounded-full bg-black/70 text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {videoEvidenceUrl && (
                <div className="relative rounded-2xl overflow-hidden bg-black">
                  <video src={videoEvidenceUrl} controls className="w-full max-h-40 object-contain" />
                  <button
                    type="button"
                    onClick={() => setVideoEvidenceUrl('')}
                    className="absolute top-2 right-2 p-1 rounded-full bg-black/70 text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {isCompressing && (
                <div className="flex items-center gap-2 text-xs text-[#7560DF]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing attachment...</span>
                </div>
              )}

              {errorMsg && (
                <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-slate-100 dark:border-purple-950/40 bg-slate-50/70 dark:bg-[#120f24]">
              <button
                type="button"
                disabled={isSending || isCompressing}
                onClick={handleSubmitReport}
                className="w-full py-3 rounded-2xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-sm shadow-md shadow-rose-600/25 flex items-center justify-center gap-2 transition-all"
              >
                {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>Send Report</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
