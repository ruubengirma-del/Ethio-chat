import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { ViewStatEvent } from '../../types';
import {
  X,
  BarChart3,
  Eye,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  UserCheck,
  Image as ImageIcon,
  Radio
} from 'lucide-react';

interface DashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TrendDirection = 'up' | 'down' | 'flat';

function computeTrend(current: number, previous: number): {
  direction: TrendDirection;
  diff: number;
  label: string;
} {
  const diff = current - previous;
  if (diff > 0) {
    const pct = previous > 0 ? Math.round((diff / previous) * 100) : 100;
    return { direction: 'up', diff, label: `+${diff} (${pct}%)` };
  }
  if (diff < 0) {
    const pct = previous > 0 ? Math.round((Math.abs(diff) / previous) * 100) : 100;
    return { direction: 'down', diff, label: `-${Math.abs(diff)} (${pct}%)` };
  }
  return { direction: 'flat', diff: 0, label: '0 (0%)' };
}

export const DashboardModal: React.FC<DashboardModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, userProfile } = useAuth();
  const { t } = useLanguage();
  const [events, setEvents] = useState<ViewStatEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen || !currentUser) return;

    const q = query(
      collection(db, 'viewStats'),
      where('targetUserId', '==', currentUser.uid)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: ViewStatEvent[] = [];
        snapshot.forEach((d) => list.push(d.data() as ViewStatEvent));
        setEvents(list);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [isOpen, currentUser]);

  const stats = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekAgo = now - 7 * dayMs;
    const twoWeeksAgo = now - 14 * dayMs;
    const monthAgo = now - 30 * dayMs;
    const twoMonthsAgo = now - 60 * dayMs;
    const yearAgo = now - 365 * dayMs;
    const twoYearsAgo = now - 730 * dayMs;

    let current7d = 0;
    let prev7d = 0;
    let monthlyViews = 0;
    let prevMonthlyViews = 0;
    let yearlyViews = 0;
    let prevYearlyViews = 0;
    let profileViews = 0;
    let postViews = 0;
    let storyViews = 0;

    // Deduplicate strictly to 1 view per unique viewer account per target item
    const uniqueEventsMap = new Map<string, ViewStatEvent>();
    events.forEach((ev) => {
      const key = `${ev.kind || 'post'}:${ev.targetId || ev.statId}:${ev.viewerId || ev.statId}`;
      const existing = uniqueEventsMap.get(key);
      if (!existing) {
        uniqueEventsMap.set(key, ev);
      } else {
        const existingTs = new Date(existing.createdAt).getTime();
        const candidateTs = new Date(ev.createdAt).getTime();
        if (Number.isFinite(candidateTs) && (!Number.isFinite(existingTs) || candidateTs < existingTs)) {
          uniqueEventsMap.set(key, ev);
        }
      }
    });
    const dedupedEvents = Array.from(uniqueEventsMap.values());

    dedupedEvents.forEach((ev) => {
      const ts = new Date(ev.createdAt).getTime();
      if (!Number.isFinite(ts)) return;

      if (ts >= weekAgo) current7d++;
      else if (ts >= twoWeeksAgo) prev7d++;

      if (ts >= monthAgo) monthlyViews++;
      else if (ts >= twoMonthsAgo) prevMonthlyViews++;

      if (ts >= yearAgo) yearlyViews++;
      else if (ts >= twoYearsAgo) prevYearlyViews++;

      if (ev.kind === 'profile') profileViews++;
      else if (ev.kind === 'post') postViews++;
      else if (ev.kind === 'story') storyViews++;
    });

    const totalViews = Math.max(dedupedEvents.length, userProfile?.profileViewsCount || 0);
    return {
      monthlyViews,
      prevMonthlyViews,
      monthlyTrend: computeTrend(monthlyViews, prevMonthlyViews),
      yearlyViews,
      prevYearlyViews,
      yearlyTrend: computeTrend(yearlyViews, prevYearlyViews),
      recentTrend: computeTrend(current7d, prev7d),
      totalViews,
      profileViews: Math.max(profileViews, userProfile?.profileViewsCount || 0),
      postViews,
      storyViews,
    };
  }, [events, userProfile]);

  if (!isOpen || !userProfile) return null;

  const renderTrendBadge = (
    trend: { direction: TrendDirection; diff: number; label: string },
    onColoredCard = false
  ) => {
    if (trend.direction === 'up') {
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
            onColoredCard
              ? 'bg-emerald-400/25 text-white border border-white/25'
              : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          }`}
        >
          <TrendingUp className="w-3 h-3" />
          <span>{trend.label}</span>
        </span>
      );
    }
    if (trend.direction === 'down') {
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
            onColoredCard
              ? 'bg-rose-500/35 text-white border border-rose-200/40'
              : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
          }`}
        >
          <TrendingDown className="w-3 h-3" />
          <span>{trend.label}</span>
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
          onColoredCard
            ? 'bg-white/15 text-white/85'
            : 'bg-slate-200/80 dark:bg-purple-900/40 text-slate-600 dark:text-slate-300'
        }`}
      >
        <Minus className="w-3 h-3" />
        <span>0 (0%)</span>
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#16132b] w-full max-w-md rounded-3xl shadow-2xl border border-slate-200/80 dark:border-purple-950/60 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-purple-950/40 flex items-center justify-between bg-gradient-to-r from-[#7560DF]/15 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#7560DF] text-white flex items-center justify-center shadow-md shadow-[#7560DF]/25">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                {t('dashboard')}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                @{userProfile.username} • Account Views & Reach
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-950/40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Primary Monthly & Yearly Cards with Up/Down View Indicators */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-gradient-to-br from-[#7560DF] to-[#5642bd] text-white shadow-lg shadow-[#7560DF]/25">
              <div className="flex items-center justify-between text-white/85 text-xs font-semibold mb-1">
                <span>Monthly Views</span>
                {stats.monthlyTrend.direction === 'down' ? (
                  <TrendingDown className="w-4 h-4 text-rose-200" />
                ) : stats.monthlyTrend.direction === 'up' ? (
                  <TrendingUp className="w-4 h-4 text-emerald-200" />
                ) : (
                  <Calendar className="w-4 h-4" />
                )}
              </div>
              <p className="text-3xl font-black tracking-tight">
                {loading ? '—' : stats.monthlyViews.toLocaleString()}
              </p>
              <div className="mt-2 flex items-center justify-between gap-1 flex-wrap">
                {renderTrendBadge(stats.monthlyTrend, true)}
                <span className="text-[10px] text-white/75">30d vs prev</span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20">
              <div className="flex items-center justify-between text-white/85 text-xs font-semibold mb-1">
                <span>Yearly Views</span>
                {stats.yearlyTrend.direction === 'down' ? (
                  <TrendingDown className="w-4 h-4 text-rose-200" />
                ) : (
                  <TrendingUp className="w-4 h-4 text-white" />
                )}
              </div>
              <p className="text-3xl font-black tracking-tight">
                {loading ? '—' : stats.yearlyViews.toLocaleString()}
              </p>
              <div className="mt-2 flex items-center justify-between gap-1 flex-wrap">
                {renderTrendBadge(stats.yearlyTrend, true)}
                <span className="text-[10px] text-white/75">365d vs prev</span>
              </div>
            </div>
          </div>

          {/* All-Time Total Views + Weekly View Direction (Rising / Dropping) */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200/80 dark:border-purple-950/50 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  stats.recentTrend.direction === 'down'
                    ? 'bg-rose-500/15 text-rose-500'
                    : stats.recentTrend.direction === 'up'
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : 'bg-[#7560DF]/15 text-[#7560DF]'
                }`}
              >
                {stats.recentTrend.direction === 'down' ? (
                  <TrendingDown className="w-5 h-5" />
                ) : stats.recentTrend.direction === 'up' ? (
                  <TrendingUp className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  All-Time Account Views
                </p>
                <p className="text-xl font-extrabold text-slate-900 dark:text-white truncate">
                  {stats.totalViews.toLocaleString()} Views
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1 shrink-0">
              {renderTrendBadge(stats.recentTrend)}
              <span className="text-[10px] text-slate-400">
                {stats.recentTrend.direction === 'up'
                  ? 'Views going up'
                  : stats.recentTrend.direction === 'down'
                  ? 'Views going down'
                  : 'Views steady'}
              </span>
            </div>
          </div>

          {/* Breakdown by Source */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Breakdown by Content
            </h4>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 rounded-2xl bg-white dark:bg-[#1a1633] border border-slate-200/80 dark:border-purple-950/50 text-center">
                <UserCheck className="w-4 h-4 text-[#7560DF] mx-auto mb-1" />
                <p className="text-lg font-extrabold text-slate-900 dark:text-white">
                  {stats.profileViews}
                </p>
                <p className="text-[11px] text-slate-400">Profile</p>
              </div>

              <div className="p-3 rounded-2xl bg-white dark:bg-[#1a1633] border border-slate-200/80 dark:border-purple-950/50 text-center">
                <ImageIcon className="w-4 h-4 text-blue-500 mx-auto mb-1" />
                <p className="text-lg font-extrabold text-slate-900 dark:text-white">
                  {stats.postViews}
                </p>
                <p className="text-[11px] text-slate-400">Posts</p>
              </div>

              <div className="p-3 rounded-2xl bg-white dark:bg-[#1a1633] border border-slate-200/80 dark:border-purple-950/50 text-center">
                <Radio className="w-4 h-4 text-rose-500 mx-auto mb-1" />
                <p className="text-lg font-extrabold text-slate-900 dark:text-white">
                  {stats.storyViews}
                </p>
                <p className="text-[11px] text-slate-400">Stories</p>
              </div>
            </div>
          </div>

          {/* Audience Summary */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#201c38] border border-slate-200/80 dark:border-purple-950/50 flex items-center justify-around text-center">
            <div>
              <p className="text-lg font-extrabold text-slate-900 dark:text-white">
                {userProfile.followersCount || 0}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('followers')}</p>
            </div>
            <div className="w-px h-8 bg-slate-200 dark:bg-purple-900/50" />
            <div>
              <p className="text-lg font-extrabold text-slate-900 dark:text-white">
                {userProfile.followingCount || 0}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('following')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
