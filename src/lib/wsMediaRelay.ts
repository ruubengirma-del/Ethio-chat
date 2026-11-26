const TARGET_AUDIO_SAMPLE_RATE = 16000;
const CAPTURE_BUFFER_SIZE = 2048;
const VIDEO_RELAY_INTERVAL_MS = 125; // ~8 FPS smooth video fallback
const VIDEO_MAX_DIMENSION = 280;

export interface WsMediaRelayCallbacks {
  onRelayConnectedChange?: (connected: boolean) => void;
  onPeerAudioPacket?: (fromUserId: string) => void;
  onPeerVideoFrame?: (fromUserId: string, frameDataUrl: string | null) => void;
  onAutoplayBlocked?: () => void;
}

function encodeRelayPacket(pcm: Int16Array): ArrayBuffer {
  const buf = new ArrayBuffer(1 + pcm.byteLength);
  const view = new Uint8Array(buf);
  view[0] = 0x01; // PCM 16kHz mono packet marker
  view.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 1);
  return buf;
}

function downsampleToInt16(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Int16Array {
  if (inputSampleRate === outputSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < outLength) {
    const nextOffsetBuffer = Math.min(input.length, Math.round((offsetResult + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += input[i];
      count++;
    }
    const sample = count > 0 ? accum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return out;
}

/**
 * Real-time WebSocket Audio + Video Relay used automatically whenever direct WebRTC P2P
 * is blocked by strict mobile NATs / symmetric firewalls (e.g. without external TURN).
 */
export class WsMediaRelay {
  private readonly roomId: string;
  private readonly userId: string;
  private readonly callbacks: WsMediaRelayCallbacks;

  private ws: WebSocket | null = null;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private audioCtx: AudioContext | null = null;
  private captureSource: MediaStreamAudioSourceNode | null = null;
  private captureProcessor: ScriptProcessorNode | null = null;
  private captureMuteGain: GainNode | null = null;
  private captureStream: MediaStream | null = null;

  private peerPlaybackNextTime = new Map<string, number>();
  private peerSuppressedIds = new Set<string>();
  private videoFrameClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private localStream: MediaStream | null = null;
  private sendAudioEnabled = false;
  private sendVideoEnabled = false;
  private globalAudioPaused = false;
  private globalVideoPaused = false;

  private videoTimer: ReturnType<typeof setInterval> | null = null;
  private captureVideoEl: HTMLVideoElement | null = null;
  private captureCanvas: HTMLCanvasElement | null = null;
  private lastVideoSentWasOff = true;

  constructor(roomId: string, userId: string, callbacks: WsMediaRelayCallbacks = {}) {
    this.roomId = roomId;
    this.userId = userId;
    this.callbacks = callbacks;
    this.connect();
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new Ctx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {
        this.callbacks.onAutoplayBlocked?.();
      });
    }
    return this.audioCtx;
  }

  public unlockAudio(): void {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  private connect(): void {
    if (this.destroyed || typeof window === 'undefined') return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/media-relay?roomId=${encodeURIComponent(
      this.roomId
    )}&userId=${encodeURIComponent(this.userId)}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      if (this.destroyed) {
        ws.close();
        return;
      }
      this.callbacks.onRelayConnectedChange?.(true);
    };

    ws.onmessage = (event) => {
      if (this.destroyed) return;
      if (event.data instanceof ArrayBuffer) {
        this.handleBinaryAudioMessage(event.data);
        return;
      }
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data) as {
            type?: string;
            fromUserId?: string;
            frame?: string | null;
          };
          if (!msg.fromUserId || msg.fromUserId === this.userId) return;
          if (msg.type === 'video-frame') {
            this.handleIncomingVideoFrame(msg.fromUserId, msg.frame ?? null);
          } else if (msg.type === 'video-off') {
            this.handleIncomingVideoFrame(msg.fromUserId, null);
          }
        } catch {
          // ignore malformed packet
        }
      }
    };

    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
      }
      this.callbacks.onRelayConnectedChange?.(false);
      if (!this.destroyed) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 1500);
      }
    };
  }

  private handleIncomingVideoFrame(fromUserId: string, frame: string | null): void {
    const existingTimer = this.videoFrameClearTimers.get(fromUserId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.videoFrameClearTimers.delete(fromUserId);
    }

    this.callbacks.onPeerVideoFrame?.(fromUserId, frame);

    if (frame) {
      const timer = setTimeout(() => {
        this.videoFrameClearTimers.delete(fromUserId);
        this.callbacks.onPeerVideoFrame?.(fromUserId, null);
      }, 2800);
      this.videoFrameClearTimers.set(fromUserId, timer);
    }
  }

  private handleBinaryAudioMessage(buffer: ArrayBuffer): void {
    // Format from server: [1 byte senderIdLength][UTF-8 senderId][1 byte marker][Int16 PCM bytes]
    if (buffer.byteLength < 6) return;
    const bytes = new Uint8Array(buffer);
    const idLen = bytes[0];
    if (idLen <= 0 || 1 + idLen + 1 >= bytes.length) return;

    const fromUserId = new TextDecoder().decode(bytes.subarray(1, 1 + idLen));
    if (!fromUserId || fromUserId === this.userId) return;
    if (this.peerSuppressedIds.has(fromUserId)) return;

    this.callbacks.onPeerAudioPacket?.(fromUserId);

    const payloadStart = 1 + idLen + 1; // skip packet marker byte
    const pcmByteLen = bytes.byteLength - payloadStart;
    const sampleCount = Math.floor(pcmByteLen / 2);
    if (sampleCount <= 0) return;

    const ctx = this.getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      this.callbacks.onAutoplayBlocked?.();
      return;
    }

    const pcmSlice = buffer.slice(payloadStart, payloadStart + sampleCount * 2);
    const int16 = new Int16Array(pcmSlice);
    const float32 = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      float32[i] = int16[i] / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, sampleCount, TARGET_AUDIO_SAMPLE_RATE);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    let scheduledAt = this.peerPlaybackNextTime.get(fromUserId) ?? now + 0.05;
    // Catch up smoothly if jitter buffer drifted far behind or ahead
    if (scheduledAt < now) {
      scheduledAt = now + 0.04;
    } else if (scheduledAt > now + 0.45) {
      scheduledAt = now + 0.06;
    }

    source.start(scheduledAt);
    this.peerPlaybackNextTime.set(fromUserId, scheduledAt + audioBuffer.duration);
  }

  /**
   * Suppress relay audio playback from specific peer(s) whose WebRTC P2P audio is already live.
   */
  public setSuppressedAudioPeers(peerIds: Iterable<string>): void {
    this.peerSuppressedIds = new Set(peerIds);
  }

  /**
   * Pause upstream relay transmission when ALL peers have healthy WebRTC P2P audio/video.
   */
  public setUpstreamPaused(opts: { audioPaused?: boolean; videoPaused?: boolean }): void {
    if (typeof opts.audioPaused === 'boolean') {
      this.globalAudioPaused = opts.audioPaused;
    }
    if (typeof opts.videoPaused === 'boolean') {
      this.globalVideoPaused = opts.videoPaused;
    }
  }

  public updateMedia(
    stream: MediaStream | null,
    opts: { sendAudio: boolean; sendVideo: boolean }
  ): void {
    this.localStream = stream;
    this.sendAudioEnabled = opts.sendAudio;
    this.sendVideoEnabled = opts.sendVideo;

    this.syncAudioCapture();
    this.syncVideoCapture();
  }

  private teardownAudioCapture(): void {
    try {
      this.captureSource?.disconnect();
      this.captureProcessor?.disconnect();
      this.captureMuteGain?.disconnect();
    } catch {
      // ignore
    }
    if (this.captureProcessor) {
      this.captureProcessor.onaudioprocess = null;
    }
    this.captureSource = null;
    this.captureProcessor = null;
    this.captureMuteGain = null;
    this.captureStream = null;
  }

  private syncAudioCapture(): void {
    const audioTracks = this.localStream?.getAudioTracks().filter((t) => t.readyState === 'live') || [];
    if (!this.sendAudioEnabled || audioTracks.length === 0) {
      this.teardownAudioCapture();
      return;
    }

    // Check if already capturing the same active track
    const currentTrackId = this.captureStream?.getAudioTracks()[0]?.id;
    if (currentTrackId === audioTracks[0].id && this.captureProcessor) {
      return;
    }

    this.teardownAudioCapture();

    const ctx = this.getAudioContext();
    if (!ctx) return;

    const audioOnlyStream = new MediaStream([audioTracks[0]]);
    this.captureStream = audioOnlyStream;

    const source = ctx.createMediaStreamSource(audioOnlyStream);
    const processor = ctx.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1);
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0; // Prevents hearing own voice back locally

    processor.onaudioprocess = (ev) => {
      if (this.destroyed || !this.sendAudioEnabled || this.globalAudioPaused) return;
      const track = this.captureStream?.getAudioTracks()[0];
      if (!track || !track.enabled || track.readyState !== 'live') return;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      // Avoid saturating slow mobile uplink buffers
      if (this.ws.bufferedAmount > 64 * 1024) return;

      const input = ev.inputBuffer.getChannelData(0);
      const pcm = downsampleToInt16(input, ctx.sampleRate, TARGET_AUDIO_SAMPLE_RATE);
      this.ws.send(encodeRelayPacket(pcm));
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);

    this.captureSource = source;
    this.captureProcessor = processor;
    this.captureMuteGain = silentGain;
  }

  private teardownVideoCapture(): void {
    if (this.videoTimer) {
      clearInterval(this.videoTimer);
      this.videoTimer = null;
    }
    if (this.captureVideoEl) {
      try {
        this.captureVideoEl.pause();
        this.captureVideoEl.srcObject = null;
      } catch {
        // ignore
      }
      this.captureVideoEl = null;
    }
    if (!this.lastVideoSentWasOff && this.ws?.readyState === WebSocket.OPEN) {
      this.lastVideoSentWasOff = true;
      try {
        this.ws.send(JSON.stringify({ type: 'video-off' }));
      } catch {
        // ignore
      }
    }
  }

  private syncVideoCapture(): void {
    const videoTracks = this.localStream?.getVideoTracks().filter((t) => t.readyState === 'live') || [];
    if (!this.sendVideoEnabled || videoTracks.length === 0) {
      this.teardownVideoCapture();
      return;
    }

    if (!this.captureCanvas && typeof document !== 'undefined') {
      this.captureCanvas = document.createElement('canvas');
    }
    if (!this.captureVideoEl && typeof document !== 'undefined') {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      this.captureVideoEl = v;
    }

    const v = this.captureVideoEl;
    if (!v || !this.captureCanvas) return;
    v.srcObject = new MediaStream([videoTracks[0]]);
    v.play().catch(() => {});

    if (this.videoTimer) return;

    this.videoTimer = setInterval(() => {
      if (this.destroyed || !this.sendVideoEnabled || this.globalVideoPaused) return;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.ws.bufferedAmount > 96 * 1024) return;
      if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;

      const scale = Math.min(1, VIDEO_MAX_DIMENSION / Math.max(v.videoWidth, v.videoHeight));
      const w = Math.max(80, Math.round(v.videoWidth * scale));
      const h = Math.max(80, Math.round(v.videoHeight * scale));
      const canvas = this.captureCanvas!;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return;
      ctx2d.drawImage(v, 0, 0, w, h);
      const frame = canvas.toDataURL('image/jpeg', 0.52);
      this.lastVideoSentWasOff = false;
      this.ws.send(JSON.stringify({ type: 'video-frame', frame }));
    }, VIDEO_RELAY_INTERVAL_MS);
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const timer of this.videoFrameClearTimers.values()) {
      clearTimeout(timer);
    }
    this.videoFrameClearTimers.clear();
    this.peerPlaybackNextTime.clear();
    this.teardownAudioCapture();
    this.teardownVideoCapture();

    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
    }
    this.audioCtx = null;
  }
}
