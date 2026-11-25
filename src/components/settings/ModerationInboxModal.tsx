import React, { useState, useEffect } from 'react';
import { AccountAppeal, PostReport } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import { collection, orderBy, query, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { X, ShieldAlert, CheckCircle2, Flag, MessageSquare, Loader2 } from 'lucide-react';

interface ModerationInboxModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ModerationInboxModal: React.FC<ModerationInboxModalProps> = ({ isOpen, onClose }) => {
  const { t } = useLanguage();
  const [tab, setTab] = useState<'appeals' | 'reports'>('appeals');
  const [appeals, setAppeals] = useState<AccountAppeal[]>([]);
  const [reports, setReports] = useState<PostReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    const unsubAppeals = onSnapshot(
      query(collection(db, 'appeals'), orderBy('createdAt', 'desc')),
      (snap) => {
        const list: AccountAppeal[] = [];
        snap.forEach((d) => list.push(d.data() as AccountAppeal));
        setAppeals(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
    const unsubReports = onSnapshot(
      query(collection(db, 'reports'), orderBy('createdAt', 'desc')),
      (snap) => {
        const list: PostReport[] = [];
        snap.forEach((d) => list.push(d.data() as PostReport));
        setReports(list);
      }
    );
    return () => {
      unsubAppeals();
      unsubReports();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleApproveAppeal = async (appeal: AccountAppeal) => {
    const now = new Date().toISOString();
    await updateDoc(doc(db, 'users', appeal.userId), {
      warningActive: false,
      accountSuspended: false,
      warningClearedReason: 'admin_appeal_approved',
    }).catch(() => {});
    await updateDoc(doc(db, 'appeals', appeal.appealId), {
      status: 'approved',
      reviewedAt: now,
    }).catch(() => {});
  };

  const handleRejectAppeal = async (appeal: AccountAppeal) => {
    await updateDoc(doc(db, 'appeals', appeal.appealId), {
      status: 'rejected',
      reviewedAt: new Date().toISOString(),
    }).catch(() => {});
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-[#16132b] w-full max-w-lg rounded-3xl shadow-2xl border border-slate-100 dark:border-purple-950/60 flex flex-col max-h-[88vh] overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-[#7560DF]" />
            <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
              {t('moderationInbox')}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pt-3 flex gap-2 border-b border-slate-100 dark:border-purple-950/30 pb-3">
          <button
            type="button"
            onClick={() => setTab('appeals')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${
              tab === 'appeals'
                ? 'bg-[#7560DF] text-white'
                : 'bg-slate-100 dark:bg-[#201c38] text-slate-600 dark:text-slate-300'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Appeals ({appeals.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('reports')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${
              tab === 'reports'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 dark:bg-[#201c38] text-slate-600 dark:text-slate-300'
            }`}
          >
            <Flag className="w-3.5 h-3.5" />
            <span>Reports ({reports.length})</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-[#7560DF]" />
            </div>
          ) : tab === 'appeals' ? (
            appeals.length === 0 ? (
              <p className="text-center text-xs text-slate-400 py-10">No warning appeals yet.</p>
            ) : (
              appeals.map((a) => (
                <div
                  key={a.appealId}
                  className="p-4 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-sm text-slate-900 dark:text-white">
                        {a.displayName} (@{a.username})
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Reports: {a.reportsCountAtAppeal || 0} · Status: {a.status}
                      </p>
                    </div>
                  </div>
                  {a.message && (
                    <p className="text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-[#16132b] p-3 rounded-xl">
                      {a.message}
                    </p>
                  )}
                  {a.photoEvidenceUrl && (
                    <img
                      src={a.photoEvidenceUrl}
                      alt="Appeal photo"
                      className="w-full max-h-40 object-contain rounded-xl bg-black/5"
                    />
                  )}
                  {a.videoEvidenceUrl && (
                    <video
                      src={a.videoEvidenceUrl}
                      controls
                      className="w-full max-h-40 object-contain rounded-xl bg-black"
                    />
                  )}
                  {a.status === 'pending' && (
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleApproveAppeal(a)}
                        className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve & Lift Warning</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRejectAppeal(a)}
                        className="px-3 py-2 rounded-xl bg-rose-100 dark:bg-rose-950/40 text-rose-600 text-xs font-bold"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))
            )
          ) : reports.length === 0 ? (
            <p className="text-center text-xs text-slate-400 py-10">No post reports yet.</p>
          ) : (
            reports.map((r) => (
              <div
                key={r.reportId}
                className="p-4 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200 dark:border-purple-900/50 space-y-2"
              >
                <p className="text-xs font-extrabold text-rose-600 dark:text-rose-400">
                  {r.reason}
                </p>
                <p className="text-xs text-slate-700 dark:text-slate-200">
                  Target: <strong>{r.postAuthorDisplayName}</strong> (@{r.postAuthorUsername}) · By @
                  {r.reporterUsername}
                </p>
                {r.details && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 bg-white dark:bg-[#16132b] p-2.5 rounded-xl">
                    {r.details}
                  </p>
                )}
                {r.photoEvidenceUrl && (
                  <img
                    src={r.photoEvidenceUrl}
                    alt="Report photo"
                    className="w-full max-h-36 object-contain rounded-xl bg-black/5"
                  />
                )}
                {r.videoEvidenceUrl && (
                  <video
                    src={r.videoEvidenceUrl}
                    controls
                    className="w-full max-h-36 object-contain rounded-xl bg-black"
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
