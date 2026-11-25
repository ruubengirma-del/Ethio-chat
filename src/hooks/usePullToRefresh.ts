import React, { useState, useRef, useCallback, useEffect } from 'react';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  externalRefreshSignal?: number;
  disabled?: boolean;
}

export const PULL_THRESHOLD = 62;

export function usePullToRefresh({
  onRefresh,
  externalRefreshSignal = 0,
  disabled = false,
}: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshJustDone, setRefreshJustDone] = useState<boolean>(false);

  const touchStartYRef = useRef<number | null>(null);
  const isPointerDraggingRef = useRef<boolean>(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshingRef = useRef<boolean>(false);
  const pullDistanceRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const updatePullDistance = useCallback((value: number) => {
    pullDistanceRef.current = value;
    setPullDistance(value);
  }, []);

  const isAtTopOfScroll = useCallback(() => {
    if (typeof window !== 'undefined' && window.scrollY > 4) return false;
    let el: HTMLElement | null = containerRef.current;
    while (el) {
      if (el.scrollTop > 4) return false;
      el = el.parentElement;
    }
    return true;
  }, []);

  const triggerRefresh = useCallback(async () => {
    if (refreshingRef.current || disabled) return;
    refreshingRef.current = true;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    touchStartYRef.current = null;
    isPointerDraggingRef.current = false;
    setIsRefreshing(true);
    updatePullDistance(PULL_THRESHOLD);

    const startedAt = Date.now();
    try {
      await onRefresh();
    } catch (err) {
      console.warn('Pull-to-refresh error:', err);
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 550) {
        await new Promise((r) => setTimeout(r, 550 - elapsed));
      }
      refreshingRef.current = false;
      setIsRefreshing(false);
      updatePullDistance(0);
      setRefreshJustDone(true);
      setTimeout(() => setRefreshJustDone(false), 1800);
    }
  }, [onRefresh, disabled, updatePullDistance]);

  useEffect(() => {
    if (externalRefreshSignal > 0) {
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      triggerRefresh();
    }
  }, [externalRefreshSignal, triggerRefresh]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  const startPullGesture = (clientY: number) => {
    if (disabled || refreshingRef.current || !isAtTopOfScroll()) return;
    touchStartYRef.current = clientY;
  };

  const movePullGesture = (clientY: number) => {
    if (disabled || touchStartYRef.current === null || refreshingRef.current) return;
    if (!isAtTopOfScroll()) {
      touchStartYRef.current = null;
      updatePullDistance(0);
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      return;
    }

    const delta = clientY - touchStartYRef.current;
    if (delta <= 0) {
      updatePullDistance(0);
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      return;
    }

    const damped = Math.min(92, Math.round(delta * 0.52));
    updatePullDistance(damped);

    if (damped >= PULL_THRESHOLD) {
      if (!holdTimerRef.current) {
        holdTimerRef.current = setTimeout(() => {
          triggerRefresh();
        }, 380);
      }
    } else if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const endPullGesture = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const shouldRefresh = !disabled && pullDistanceRef.current >= PULL_THRESHOLD && !refreshingRef.current;
    touchStartYRef.current = null;
    isPointerDraggingRef.current = false;

    if (shouldRefresh) {
      triggerRefresh();
    } else if (!refreshingRef.current) {
      updatePullDistance(0);
    }
  };

  const pullHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length === 1) startPullGesture(e.touches[0].clientY);
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (e.touches.length === 1) movePullGesture(e.touches[0].clientY);
    },
    onTouchEnd: endPullGesture,
    onTouchCancel: endPullGesture,
    onMouseDown: (e: React.MouseEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
      isPointerDraggingRef.current = true;
      startPullGesture(e.clientY);
    },
    onMouseMove: (e: React.MouseEvent) => {
      if (isPointerDraggingRef.current) movePullGesture(e.clientY);
    },
    onMouseUp: () => {
      if (isPointerDraggingRef.current) endPullGesture();
    },
    onMouseLeave: () => {
      if (isPointerDraggingRef.current) endPullGesture();
    },
  };

  return {
    containerRef,
    pullDistance,
    isRefreshing,
    refreshJustDone,
    triggerRefresh,
    pullHandlers,
  };
}
