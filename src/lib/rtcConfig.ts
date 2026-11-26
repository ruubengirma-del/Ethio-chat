export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
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
    const timeout = setTimeout(() => controller.abort(), 1200);
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
    // Use fast built-in Google + Cloudflare STUN servers immediately
  }

  cachedRtcConfig = DEFAULT_RTC_CONFIG;
  cachedAt = Date.now();
  return DEFAULT_RTC_CONFIG;
}
