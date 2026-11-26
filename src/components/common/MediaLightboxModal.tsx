import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useBackHandler } from '../../lib/backNavigation';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Download,
  Lock,
  ShieldAlert,
  Clock,
  Eye,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

export interface MediaLightboxModalProps {
  isOpen: boolean;
  mediaType: 'image' | 'video';
  mediaUrl: string;
  title?: string;
  fileName?: string;
  protectedMode?: boolean;
  viewerUsername?: string;
  expiresAt?: string;
  onSave?: () => void;
  onClose: () => void;
  onExpired?: () => void;
}

export const MediaLightboxModal: React.FC<MediaLightboxModalProps> = ({
  isOpen,
  mediaType,
  mediaUrl,
  title,
  fileName,
  protectedMode = false,
  viewerUsername,
  expiresAt,
  onSave,
  onClose,
  onExpired,
}) => {
  const { t } = useLanguage();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [shieldActive, setShieldActive] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [videoError, setVideoError] = useState(false);
  const [videoRetryTick, setVideoRetryTick] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; origX: number; origY: number } | null>(null);
  const pinchStartRef = useRef<{ dist: number; startScale: number } | null>(null);
  const lastTapRef = useRef<number>(0);

  useBackHandler(isOpen, onClose);

  // Reset zoom & shield whenever opened or media changes
  useEffect(() => {
    if (!isOpen) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setShieldActive(false);
    setVideoError(false);
    setVideoRetryTick(0);
  }, [isOpen, mediaUrl]);

  // Live ephemeral countdown timer (30sec self-destruct)
  useEffect(() => {
    if (!isOpen || !expiresAt) {
      setRemainingSeconds(null);
      return;
    }
    const updateCountdown = () => {
      const diff = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000);
      if (diff <= 0) {
        setRemainingSeconds(0);
        onExpired?.();
        onClose();
        return false;
      }
      setRemainingSeconds(diff);
      return true;
    };
    if (!updateCountdown()) return;
    const timer = setInterval(() => {
      if (!updateCountdown()) clearInterval(timer);
    }, 350);
    return () => clearInterval(timer);
  }, [isOpen, expiresAt, onClose, onExpired]);

  const engageShield = useCallback(() => {
    if (!protectedMode) return;
    setShieldActive(true);
    try {
      videoRef.current?.pause();
    } catch {}
    try {
      navigator.clipboard?.writeText('').catch(() => {});
    } catch {}
  }, [protectedMode]);

  // Web-layer screenshot / print / focus-loss / screen-record deterrence when protectedMode is active
  useEffect(() => {
    if (!isOpen || !protectedMode) return;

    const handleKeyGuard = (e: KeyboardEvent) => {
      const k = (e.key || '').toLowerCase();
      const isPrintScreen = e.key === 'PrintScreen' || e.code === 'PrintScreen';
      const isMacShot = e.metaKey && e.shiftKey && ['3', '4', '5', '6', 's'].includes(k);
      const isWinSnip = (e.ctrlKey || e.metaKey) && e.shiftKey && k === 's';
      const isPrint = (e.ctrlKey || e.metaKey) && k === 'p';
      if (isPrintScreen || isMacShot || isWinSnip || isPrint) {
        e.preventDefault();
        e.stopPropagation();
        engageShield();
      }
    };

    const handleVisibility = () => {
      if (document.hidden) engageShield();
    };

    const handleBlur = () => {
      engageShield();
    };

    const handleBeforePrint = () => {
      engageShield();
    };

    window.addEventListener('keydown', handleKeyGuard, true);
    window.addEventListener('keyup', handleKeyGuard, true);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('beforeprint', handleBeforePrint);
    document.addEventListener('visibilitychange', handleVisibility);

    // Intercept browser getDisplayMedia calls while protected media is displayed
    let origGetDisplayMedia: MediaDevices['getDisplayMedia'] | null = null;
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (md && typeof md.getDisplayMedia === 'function') {
      origGetDisplayMedia = md.getDisplayMedia.bind(md);
      md.getDisplayMedia = async () => {
        engageShield();
        throw new DOMException('Protected media cannot be screen recorded.', 'NotAllowedError');
      };
    }

    return () => {
      window.removeEventListener('keydown', handleKeyGuard, true);
      window.removeEventListener('keyup', handleKeyGuard, true);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('beforeprint', handleBeforePrint);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (md && origGetDisplayMedia) {
        md.getDisplayMedia = origGetDisplayMedia;
      }
    };
  }, [isOpen, protectedMode, engageShield]);

  // Escape key closes lightbox
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !mediaUrl) return null;

  const clampScale = (next: number) => Math.min(4, Math.max(1, Number(next.toFixed(2))));

  const handleZoomIn = () => setScale((s) => clampScale(s + 0.5));
  const handleZoomOut = () => {
    setScale((s) => {
      const next = clampScale(s - 0.5);
      if (next <= 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };
  const handleResetZoom = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleToggleDoubleTapZoom = () => {
    if (scale > 1.05) {
      handleResetZoom();
    } else {
      setScale(2.5);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (mediaType !== 'image') return;
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    setScale((s) => {
      const next = clampScale(s + delta);
      if (next <= 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (mediaType !== 'image' || scale <= 1) return;
    e.stopPropagation();
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current || scale <= 1) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setOffset({
      x: dragStartRef.current.origX + dx,
      y: dragStartRef.current.origY + dy,
    });
  };

  const handlePointerUp = () => {
    dragStartRef.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (mediaType !== 'image') return;
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartRef.current = { dist, startScale: scale };
      dragStartRef.current = null;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapRef.current < 280) {
        handleToggleDoubleTapZoom();
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (mediaType !== 'image' || e.touches.length !== 2 || !pinchStartRef.current) return;
    e.stopPropagation();
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const ratio = dist / Math.max(1, pinchStartRef.current.dist);
    const next = clampScale(pinchStartRef.current.startScale * ratio);
    setScale(next);
    if (next <= 1) setOffset({ x: 0, y: 0 });
  };

  const handleTouchEnd = () => {
    pinchStartRef.current = null;
  };

  return (
    <div
      onClick={onClose}
      onContextMenu={(e) => {
        if (protectedMode) e.preventDefault();
      }}
      className={`fixed inset-0 z-[70] bg-black/95 backdrop-blur-md flex flex-col animate-in fade-in duration-150 ${
        protectedMode ? 'protected-media-guard no-touch-callout' : ''
      }`}
    >
      {/* Top Toolbar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="px-4 py-3 flex items-center justify-between gap-2 bg-black/60 border-b border-white/10 text-white z-20 shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          {protectedMode && (
            <span className="px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-200 text-[11px] font-extrabold flex items-center gap-1 shrink-0">
              <Lock className="w-3 h-3" />
              <span>{t('mediaProtected')}</span>
            </span>
          )}
          {remainingSeconds !== null && (
            <span className="px-2.5 py-1 rounded-full bg-rose-500 text-white text-[11px] font-black flex items-center gap-1 shrink-0 animate-pulse">
              <Clock className="w-3 h-3" />
              <span>{remainingSeconds}s</span>
            </span>
          )}
          {(title || fileName) && (
            <span className="text-xs font-bold text-white/85 truncate">
              {title || fileName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {mediaType === 'image' && (
            <>
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={scale <= 1}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-35 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-[11px] font-extrabold px-1.5 min-w-[38px] text-center">
                {scale.toFixed(1)}x
              </span>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={scale >= 4}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-35 transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              {scale > 1 && (
                <button
                  type="button"
                  onClick={handleResetZoom}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                  title="Reset Zoom"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
            </>
          )}

          {!protectedMode && onSave && (
            <button
              type="button"
              onClick={onSave}
              className="px-3 py-1.5 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('saveToGallery')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Media Stage */}
      <div
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="flex-1 relative overflow-hidden flex items-center justify-center p-2 sm:p-6 touch-none"
      >
        {mediaType === 'image' ? (
          <img
            src={mediaUrl}
            alt={fileName || 'Photo'}
            draggable={false}
            onDoubleClick={handleToggleDoubleTapZoom}
            onContextMenu={(e) => {
              if (protectedMode) e.preventDefault();
            }}
            style={{
              transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
              transition: dragStartRef.current ? 'none' : 'transform 160ms ease-out',
            }}
            className={`max-w-full max-h-full object-contain select-none rounded-lg ${
              scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
            }`}
          />
        ) : videoError ? (
          <div className="flex flex-col items-center justify-center text-center gap-3 p-6 max-w-xs">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-400 flex items-center justify-center">
              <AlertCircle className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-white">
                This video cannot open right now
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">
                If your connection dropped, tap Retry to load it again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setVideoError(false);
                setVideoRetryTick((prev) => prev + 1);
              }}
              className="px-4 py-2 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold flex items-center gap-1.5 shadow-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        ) : (
          <video
            key={videoRetryTick}
            ref={videoRef}
            src={
              videoRetryTick > 0
                ? `${mediaUrl}${mediaUrl.includes('?') ? '&' : '?'}r=${videoRetryTick}`
                : mediaUrl
            }
            controls
            autoPlay
            playsInline
            onLoadedMetadata={() => setVideoError(false)}
            onError={() => setVideoError(true)}
            controlsList={protectedMode ? 'nodownload noremoteplayback' : undefined}
            disablePictureInPicture={protectedMode}
            onContextMenu={(e) => {
              if (protectedMode) e.preventDefault();
            }}
            className="max-w-full max-h-full rounded-xl bg-black shadow-2xl"
          />
        )}

        {/* Watermark deterrence overlay on protected media */}
        {protectedMode && !shieldActive && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-25 flex flex-wrap items-center justify-around gap-12 p-8 rotate-[-22deg] select-none">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className="text-white/80 font-black text-xs sm:text-sm tracking-widest uppercase drop-shadow"
              >
                @{viewerUsername || 'protected'} · PROTECTED
              </span>
            ))}
          </div>
        )}

        {/* Active Blackout Shield when screenshot/focus loss/screen-record trigger fires */}
        {protectedMode && shieldActive && (
          <div className="absolute inset-0 z-30 bg-black flex flex-col items-center justify-center p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <ShieldAlert className="w-9 h-9" />
            </div>
            <div className="space-y-1 max-w-xs">
              <h4 className="font-extrabold text-base text-white">
                {t('protectedShieldTitle')}
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                {t('protectedShieldNotice')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShieldActive(false)}
              className="px-5 py-2.5 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white text-xs font-bold flex items-center gap-2 shadow-lg"
            >
              <Eye className="w-4 h-4" />
              <span>{t('resumeViewingBtn')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
