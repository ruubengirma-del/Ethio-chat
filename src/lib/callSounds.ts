let sharedAudioCtx: AudioContext | null = null;
let activeTimer: ReturnType<typeof setInterval> | null = null;
let activeStopOscillators: Array<() => void> = [];
let activeMode: 'none' | 'ringback' | 'incoming' = 'none';

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function unlockCallAudio(): void {
  const ctx = getOrCreateAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

function stopCurrentOscillators(): void {
  const list = activeStopOscillators;
  activeStopOscillators = [];
  for (const stopFn of list) {
    try {
      stopFn();
    } catch {
      // ignore
    }
  }
}

export function stopCallSounds(): void {
  activeMode = 'none';
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = null;
  }
  stopCurrentOscillators();
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(0);
    }
  } catch {
    // ignore
  }
}

function playToneBurst(freqs: number[], durationSec: number, gainPeak: number, delaySec = 0): void {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;

  const startAt = ctx.currentTime + delaySec;
  const endAt = startAt + durationSec;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, startAt);
  master.gain.exponentialRampToValueAtTime(Math.max(0.001, gainPeak), startAt + 0.03);
  master.gain.setValueAtTime(Math.max(0.001, gainPeak), Math.max(startAt + 0.04, endAt - 0.06));
  master.gain.exponentialRampToValueAtTime(0.0001, endAt);
  master.connect(ctx.destination);

  const oscs: OscillatorNode[] = [];
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startAt);
    osc.connect(master);
    osc.start(startAt);
    osc.stop(endAt + 0.02);
    oscs.push(osc);
  }

  const cleanup = () => {
    for (const o of oscs) {
      try {
        o.stop();
        o.disconnect();
      } catch {
        // ignore
      }
    }
    try {
      master.disconnect();
    } catch {
      // ignore
    }
  };
  activeStopOscillators.push(cleanup);
}

/**
 * Caller hears a crisp telecom ringback tone while waiting for recipient to answer.
 */
export function startRingbackTone(): void {
  if (activeMode === 'ringback') return;
  stopCallSounds();
  activeMode = 'ringback';

  const triggerCycle = () => {
    if (activeMode !== 'ringback') return;
    stopCurrentOscillators();
    // Classic smooth dual-tone ringback (440 Hz + 480 Hz) for 1.15s
    playToneBurst([440, 480], 1.15, 0.11, 0);
  };

  triggerCycle();
  activeTimer = setInterval(triggerCycle, 3400);
}

/**
 * Callee hears a pleasant melodic ringtone + gentle vibration when a call arrives.
 */
export function startIncomingRingtone(): void {
  if (activeMode === 'incoming') return;
  stopCallSounds();
  activeMode = 'incoming';

  const triggerRingCycle = () => {
    if (activeMode !== 'incoming') return;
    stopCurrentOscillators();
    // Pleasant bright ascending chime (C5 -> E5 -> G5 -> C6)
    playToneBurst([523.25], 0.24, 0.16, 0.0);
    playToneBurst([659.25], 0.24, 0.16, 0.22);
    playToneBurst([783.99], 0.24, 0.16, 0.44);
    playToneBurst([1046.5, 523.25], 0.52, 0.14, 0.66);

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([260, 140, 260]);
      }
    } catch {
      // ignore
    }
  };

  triggerRingCycle();
  activeTimer = setInterval(triggerRingCycle, 2400);
}
