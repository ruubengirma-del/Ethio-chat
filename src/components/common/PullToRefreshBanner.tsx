import React from 'react';
import { RefreshCw, ArrowDown, CheckCircle2 } from 'lucide-react';
import { PULL_THRESHOLD } from '../../hooks/usePullToRefresh';

interface PullToRefreshBannerProps {
  pullDistance: number;
  isRefreshing: boolean;
  refreshJustDone: boolean;
  refreshingLabel?: string;
  updatedLabel?: string;
}

export const PullToRefreshBanner: React.FC<PullToRefreshBannerProps> = ({
  pullDistance,
  isRefreshing,
  refreshJustDone,
  refreshingLabel = 'Refreshing...',
  updatedLabel = 'Updated!',
}) => {
  if (!(pullDistance > 8 || isRefreshing || refreshJustDone)) {
    return null;
  }

  return (
    <div
      style={{
        height: isRefreshing ? 46 : refreshJustDone ? 40 : Math.min(54, Math.max(28, pullDistance * 0.65)),
      }}
      className="flex items-center justify-center transition-all duration-200 overflow-hidden"
    >
      <div className="px-4 py-1.5 rounded-full bg-white dark:bg-[#1a1633] border border-[#7560DF]/35 shadow-md flex items-center gap-2 text-xs font-bold text-[#7560DF] dark:text-[#B09EFC]">
        {isRefreshing ? (
          <>
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>{refreshingLabel}</span>
          </>
        ) : refreshJustDone ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-emerald-600 dark:text-emerald-400">{updatedLabel}</span>
          </>
        ) : (
          <>
            <ArrowDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                pullDistance >= PULL_THRESHOLD ? 'rotate-180' : ''
              }`}
            />
            <span>
              {pullDistance >= PULL_THRESHOLD ? 'Hold or release to refresh' : 'Pull down to refresh'}
            </span>
          </>
        )}
      </div>
    </div>
  );
};
