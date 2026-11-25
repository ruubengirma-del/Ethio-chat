import React from 'react';
import { useAuth } from '../../context/AuthContext';

interface GoldVerifiedBadgeProps {
  userId?: string | null;
  forceShow?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP: Record<NonNullable<GoldVerifiedBadgeProps['size']>, string> = {
  xs: 'w-3.5 h-3.5',
  sm: 'w-4 h-4',
  md: 'w-4.5 h-4.5',
  lg: 'w-5 h-5',
};

export const GoldVerifiedBadge: React.FC<GoldVerifiedBadgeProps> = ({
  userId,
  forceShow = false,
  size = 'sm',
  className = '',
}) => {
  const { isUserGoldVerified } = useAuth();
  const gradId = React.useId();
  const active = forceShow || isUserGoldVerified(userId);

  if (!active) return null;

  return (
    <span
      title="Gold Verified Premium Member"
      aria-label="Gold Verified Premium Member"
      className={`inline-flex items-center justify-center shrink-0 align-middle select-none ${SIZE_MAP[size]} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="w-full h-full drop-shadow-[0_1px_2px_rgba(217,119,6,0.35)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradId} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FDE047" />
            <stop offset="50%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#B45309" />
          </linearGradient>
        </defs>
        <path
          d="M12 1.75L14.62 3.8L17.9 3.45L18.92 6.6L21.75 8.28L20.9 11.45L22.25 14.5L19.85 16.75L19.65 20.05L16.4 20.55L14.25 23L12 21.5L9.75 23L7.6 20.55L4.35 20.05L4.15 16.75L1.75 14.5L3.1 11.45L2.25 8.28L5.08 6.6L6.1 3.45L9.38 3.8L12 1.75Z"
          fill={`url(#${gradId})`}
        />
        <path
          d="M8.6 12.2L10.95 14.55L15.65 9.65"
          stroke="#FFFFFF"
          strokeWidth="2.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
};
