export interface MediaAcquireResult {
  stream: MediaStream | null;
  audioGranted: boolean;
  videoGranted: boolean;
  errorMessage: string | null;
  permissionDenied: boolean;
}

interface PendingPrimeEntry {
  wantAudio: boolean;
  wantVideo: boolean;
  promise: Promise<MediaAcquireResult>;
  createdAt: number;
}

const primedEntries = new Map<string, PendingPrimeEntry>();

export function formatMediaPermissionError(err: unknown): {
  message: string;
  permissionDenied: boolean;
} {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name || '') : '';
  const rawMsg =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: string }).message || '')
      : typeof err === 'string'
      ? err
      : '';

  const isDenied =
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError' ||
    /permission|denied|not allowed|blocked/i.test(rawMsg);

  if (isDenied) {
    return {
      permissionDenied: true,
      message:
        'Hayyamni Camera/Microphone dhorkameera (Permission denied). Mallattoo 🔒 URL biraa ykn Settings browser keessaa Camera fi Mic "Allow" godhaa, sana booda "Retry / Hayyama Kenni" tuqaa.',
    };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      permissionDenied: false,
      message: 'Camera ykn Microphone bilbila/kompiitara kana irratti hin argamne.',
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      permissionDenied: false,
      message: 'Camera ykn Microphone app biraan qabamee jira. App biraa cufaatii irra deebi’aa yaalaa.',
    };
  }

  return {
    permissionDenied: false,
    message: rawMsg || 'Camera ykn Microphone banuu hin dandeenye. Irra deebi’aa yaalaa.',
  };
}

async function tryGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Browser kun live camera fi microphone (HTTPS/WebRTC) hin deeggaru.');
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}

/**
 * Acquires audio/video with graceful fallbacks so an unavailable or blocked camera
 * never kills audio or WebRTC signaling.
 */
export async function acquireMediaWithFallback(opts: {
  wantAudio: boolean;
  wantVideo: boolean;
  facingMode?: 'user' | 'environment';
}): Promise<MediaAcquireResult> {
  const { wantAudio, wantVideo, facingMode = 'user' } = opts;

  // 1. Primary attempt with requested facingMode
  if (wantAudio || wantVideo) {
    const primaryConstraints: MediaStreamConstraints = {
      audio: wantAudio ? { echoCancellation: true, noiseSuppression: true } : false,
      video: wantVideo ? { facingMode: { ideal: facingMode } } : false,
    };

    try {
      const stream = await tryGetUserMedia(primaryConstraints);
      return {
        stream,
        audioGranted: stream.getAudioTracks().length > 0,
        videoGranted: stream.getVideoTracks().length > 0,
        errorMessage: null,
        permissionDenied: false,
      };
    } catch (primaryErr) {
      // 2. Retry with plain video: true in case facingMode/echoCancellation overconstrained hardware
      if (wantVideo) {
        try {
          const simpleStream = await tryGetUserMedia({
            audio: wantAudio,
            video: true,
          });
          return {
            stream: simpleStream,
            audioGranted: simpleStream.getAudioTracks().length > 0,
            videoGranted: simpleStream.getVideoTracks().length > 0,
            errorMessage: null,
            permissionDenied: false,
          };
        } catch {
          // continue to audio-only fallback
        }
      }

      // 3. Fallback to audio-only if both audio & video were requested
      if (wantAudio && wantVideo) {
        try {
          const audioOnly = await tryGetUserMedia({ audio: true, video: false });
          const formatted = formatMediaPermissionError(primaryErr);
          return {
            stream: audioOnly,
            audioGranted: audioOnly.getAudioTracks().length > 0,
            videoGranted: false,
            errorMessage: formatted.permissionDenied
              ? 'Camera hayyama hin arganne — ammaaf sagalee (Audio) qofaan itti fufa. Camera banuuf "Cam On" ykn "Retry" tuqaa.'
              : formatted.message,
            permissionDenied: formatted.permissionDenied,
          };
        } catch (audioErr) {
          const formatted = formatMediaPermissionError(audioErr);
          return {
            stream: null,
            audioGranted: false,
            videoGranted: false,
            errorMessage: formatted.message,
            permissionDenied: formatted.permissionDenied,
          };
        }
      }

      // 4. Audio-only or Video-only request failed
      const formatted = formatMediaPermissionError(primaryErr);
      return {
        stream: null,
        audioGranted: false,
        videoGranted: false,
        errorMessage: formatted.message,
        permissionDenied: formatted.permissionDenied,
      };
    }
  }

  return {
    stream: null,
    audioGranted: false,
    videoGranted: false,
    errorMessage: null,
    permissionDenied: false,
  };
}

/**
 * Acquires ONLY a fresh video track inside a user gesture (for Camera On / Front-Back Flip)
 * without touching or interrupting any live microphone audio track.
 */
export async function acquireVideoTrackOnly(facingMode: 'user' | 'environment' = 'user'): Promise<{
  track: MediaStreamTrack | null;
  errorMessage: string | null;
  permissionDenied: boolean;
}> {
  try {
    const stream = await tryGetUserMedia({
      audio: false,
      video: { facingMode: { ideal: facingMode } },
    });
    const track = stream.getVideoTracks()[0] || null;
    if (!track) {
      return {
        track: null,
        errorMessage: 'Camera track hin argamne.',
        permissionDenied: false,
      };
    }
    return { track, errorMessage: null, permissionDenied: false };
  } catch (err) {
    try {
      const fallback = await tryGetUserMedia({ audio: false, video: true });
      const track = fallback.getVideoTracks()[0] || null;
      if (track) {
        return { track, errorMessage: null, permissionDenied: false };
      }
    } catch {
      // use original formatted error
    }
    const formatted = formatMediaPermissionError(err);
    return {
      track: null,
      errorMessage: formatted.message,
      permissionDenied: formatted.permissionDenied,
    };
  }
}

/**
 * Must be called SYNCHRONOUSLY inside an onClick user gesture BEFORE any `await`
 * (like Firestore writes) so mobile Chrome / WebViews grant camera & mic cleanly.
 */
export function primeMediaStream(
  key: string,
  opts: { wantAudio: boolean; wantVideo: boolean; facingMode?: 'user' | 'environment' }
): void {
  // Clean up any stale unconsumed primed stream for this key
  const existing = primedEntries.get(key);
  if (existing) {
    primedEntries.delete(key);
    existing.promise.then((res) => {
      res.stream?.getTracks().forEach((tr) => tr.stop());
    }).catch(() => {});
  }

  const promise = acquireMediaWithFallback(opts);
  primedEntries.set(key, {
    wantAudio: opts.wantAudio,
    wantVideo: opts.wantVideo,
    promise,
    createdAt: Date.now(),
  });
}

export async function consumePrimedStream(
  key: string,
  expectedVideo?: boolean
): Promise<MediaAcquireResult | null> {
  const entry = primedEntries.get(key);
  if (!entry) return null;
  primedEntries.delete(key);

  // Ignore if older than 15 seconds
  if (Date.now() - entry.createdAt > 15000) {
    entry.promise.then((res) => res.stream?.getTracks().forEach((tr) => tr.stop())).catch(() => {});
    return null;
  }

  const res = await entry.promise;
  // If caller now needs video wasn't primed or stream didn't match, still salvage audio or stop cleanly
  if (expectedVideo === false && res.stream) {
    res.stream.getVideoTracks().forEach((tr) => {
      tr.stop();
      res.stream?.removeTrack(tr);
    });
    res.videoGranted = false;
  }
  return res;
}
