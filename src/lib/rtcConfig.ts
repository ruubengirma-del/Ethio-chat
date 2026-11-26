export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:openrelay.metered.ca:80' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:80?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turns:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: DEFAULT_ICE_SERVERS,
  iceCandidatePoolSize: 4,
};

let cachedRtcConfig: RTCConfiguration | null = null;
let cachedAt = 0;

export async function getRtcConfiguration(): Promise<RTCConfiguration> {
  if (cachedRtcConfig && Date.now() - cachedAt < 10 * 60 * 1000) {
    return cachedRtcConfig;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    const resp = await fetch('/api/rtc-config', { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = (await resp.json()) as { iceServers?: RTCIceServer[] };
      if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        cachedRtcConfig = {
          iceServers: [...data.iceServers, ...DEFAULT_ICE_SERVERS],
          iceCandidatePoolSize: 4,
        };
        cachedAt = Date.now();
        return cachedRtcConfig;
      }
    }
  } catch {
    // Use built-in STUN + TURN servers immediately
  }

  cachedRtcConfig = DEFAULT_RTC_CONFIG;
  cachedAt = Date.now();
  return DEFAULT_RTC_CONFIG;
}
