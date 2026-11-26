import { useEffect, useRef } from 'react';

interface BackEntry {
  id: number;
  close: () => void;
}

const backStack: BackEntry[] = [];
let nextBackId = 1;
let initialized = false;
let currentHistoryDepth = 0;
let pendingIgnoredPops = 0;
let syncScheduled = false;

function readHistoryDepth(state: unknown): number {
  if (state && typeof state === 'object' && '__ethioDepth' in state) {
    const val = (state as { __ethioDepth?: unknown }).__ethioDepth;
    if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
      return val;
    }
  }
  return 0;
}

function performHistorySync() {
  syncScheduled = false;
  if (typeof window === 'undefined' || !window.history) return;

  const targetDepth = backStack.length;
  if (targetDepth > currentHistoryDepth) {
    while (currentHistoryDepth < targetDepth) {
      currentHistoryDepth += 1;
      try {
        window.history.pushState({ __ethioDepth: currentHistoryDepth }, '');
      } catch {
        break;
      }
    }
  } else if (targetDepth < currentHistoryDepth) {
    const delta = currentHistoryDepth - targetDepth;
    pendingIgnoredPops += 1;
    currentHistoryDepth = targetDepth;
    try {
      window.history.go(-delta);
    } catch {
      pendingIgnoredPops = Math.max(0, pendingIgnoredPops - 1);
    }
  }
}

function scheduleHistorySync() {
  if (syncScheduled || typeof window === 'undefined') return;
  syncScheduled = true;
  queueMicrotask(performHistorySync);
}

export function initBackNavigation(): void {
  if (initialized || typeof window === 'undefined' || !window.history) return;
  initialized = true;

  try {
    const existingState =
      window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {};
    window.history.replaceState({ ...existingState, __ethioDepth: 0 }, '');
  } catch {
    // ignore history replace errors in restricted frames
  }
  currentHistoryDepth = 0;

  window.addEventListener('popstate', (event: PopStateEvent) => {
    const newDepth = readHistoryDepth(event.state);

    if (pendingIgnoredPops > 0) {
      pendingIgnoredPops -= 1;
      currentHistoryDepth = newDepth;
      if (backStack.length !== currentHistoryDepth) {
        scheduleHistorySync();
      }
      return;
    }

    // Ignore forward navigation past our current stack
    if (newDepth > currentHistoryDepth) {
      currentHistoryDepth = newDepth;
      if (backStack.length !== currentHistoryDepth) {
        scheduleHistorySync();
      }
      return;
    }

    currentHistoryDepth = newDepth;
    const top = backStack.pop();
    if (top) {
      try {
        top.close();
      } catch {
        // ignore handler error
      }
      // After React closes that view/modal, ensure history remains aligned if needed
      scheduleHistorySync();
    }
  });
}

export function registerBackHandler(close: () => void): () => void {
  initBackNavigation();
  const id = nextBackId++;
  backStack.push({ id, close });
  scheduleHistorySync();

  return () => {
    const idx = backStack.findIndex((entry) => entry.id === id);
    if (idx !== -1) {
      backStack.splice(idx, 1);
      scheduleHistorySync();
    }
  };
}

/**
 * Registers an active modal, drawer, lightbox, chat, or sub-view onto the phone/browser
 * hardware Back button stack. Closing via UI button pops the history entry cleanly;
 * pressing hardware Back invokes `onBack` instead of exiting the app.
 */
export function useBackHandler(active: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;
    return registerBackHandler(() => {
      onBackRef.current();
    });
  }, [active]);
}

/**
 * Registers `depth` sequential back steps (e.g., for multi-step tab history) so pressing
 * the phone Back button steps backwards through visited tabs one by one until reaching root.
 */
export function useBackDepth(depth: number, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const cleanupsRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    const target = Math.max(0, Math.floor(depth));
    while (cleanupsRef.current.length < target) {
      const cleanup = registerBackHandler(() => {
        onBackRef.current();
      });
      cleanupsRef.current.push(cleanup);
    }
    while (cleanupsRef.current.length > target) {
      const cleanup = cleanupsRef.current.pop();
      cleanup?.();
    }
  }, [depth]);

  useEffect(() => {
    return () => {
      while (cleanupsRef.current.length > 0) {
        const cleanup = cleanupsRef.current.pop();
        cleanup?.();
      }
    };
  }, []);
}
