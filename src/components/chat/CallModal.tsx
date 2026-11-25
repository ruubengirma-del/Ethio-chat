import React, { useEffect, useRef, useState } from 'react';
import { CallSession } from '../../types';
import { db } from '../../lib/firebase';
import {
  doc,
  onSnapshot,
  updateDoc,
  collection,
  addDoc,
} from 'firebase/firestore';
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  RefreshCw,
  ShieldAlert,
  X
} from 'lucide-react';
import {
  acquireMediaWithFallback,
  acquireVideoTrackOnly,
  consumePrimedStream,
} from '../../lib/mediaPermissions';

interface CallModalProps {
  call: CallSession | null;
  currentUserId: string;
  onClose: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function findTransceiverByKind(pc: RTCPeerConnection, kind: 'audio' | 'video'): RTCRtpTransceiver | undefined {
  return pc
    .getTransceivers()
    .find(
      (t) =>
        t.receiver?.track?.kind === kind ||
        t.sender?.track?.kind === kind
    );
}

export const CallModal: React.FC<CallModalProps> = ({ call, currentUserId, onClose }) => {
  const [liveCall, setLiveCall] = useState<CallSession | null>(call);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(call?.callType !== 'video');
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [retryingMedia, setRetryingMedia] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const appliedAnswerSdpRef = useRef<string>('');
  const appliedOfferSdpRef = useRef<string>('');
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const unsubCandidatesRef = useRef<(() => void) | null>(null);

  const isCaller = call?.callerId === currentUserId;
  const isVideo = (liveCall?.callType || call?.callType) === 'video';

  const attachLocalStreamToElement = (stream: MediaStream | null) => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
  };

  const attachRemoteStreamTrack = (track: MediaStreamTrack, streams?: readonly MediaStream[]) => {
    let targetStream = streams && streams[0] ? streams[0] : remoteStreamRef.current;
    if (!targetStream) {
      targetStream = new MediaStream();
    }
    if (!targetStream.getTracks().some((t) => t.id === track.id)) {
      targetStream.addTrack(track);
    }
    remoteStreamRef.current = targetStream;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = targetStream;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = targetStream;
    }
  };

  const flushPendingIce = async (pc: RTCPeerConnection) => {
    if (!pc.remoteDescription) return;
    const queued = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];
    for (const cand of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
    }
  };

  const bindTracksToPeerConnection = async (
    pc: RTCPeerConnection,
    stream: MediaStream | null,
    wantVideoTransceiver: boolean
  ) => {
    const audioTrack = stream?.getAudioTracks()[0] || null;
    const videoTrack = stream?.getVideoTracks()[0] || null;

    const existingAudio = findTransceiverByKind(pc, 'audio');
    if (existingAudio) {
      if (existingAudio.direction === 'recvonly' && audioTrack) {
        existingAudio.direction = 'sendrecv';
      }
      await existingAudio.sender.replaceTrack(audioTrack).catch(() => {});
    } else if (audioTrack && stream) {
      pc.addTrack(audioTrack, stream);
    } else {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    }

    if (wantVideoTransceiver) {
      const existingVideo = findTransceiverByKind(pc, 'video');
      if (existingVideo) {
        if (existingVideo.direction === 'recvonly' && videoTrack) {
          existingVideo.direction = 'sendrecv';
        }
        await existingVideo.sender.replaceTrack(videoTrack).catch(() => {});
      } else if (videoTrack && stream) {
        pc.addTrack(videoTrack, stream);
      } else {
        pc.addTransceiver('video', { direction: 'sendrecv' });
      }
    }
  };

  const cleanupMedia = () => {
    try {
      unsubCandidatesRef.current?.();
    } catch {}
    unsubCandidatesRef.current = null;
    try {
      localStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    } catch {}
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;
    appliedAnswerSdpRef.current = '';
    appliedOfferSdpRef.current = '';
    pendingIceCandidatesRef.current = [];
  };

  // Keep liveCall synced with Firestore
  useEffect(() => {
    if (!call) return;
    setLiveCall(call);
    const unsub = onSnapshot(doc(db, 'calls', call.callId), (snap) => {
      if (snap.exists()) {
        const updated = snap.data() as CallSession;
        setLiveCall(updated);
        if (updated.status === 'ended' || updated.status === 'declined') {
          cleanupMedia();
          setTimeout(() => onClose(), 800);
        }
      }
    });
    return () => unsub();
  }, [call?.callId]);

  // Call timer when active
  useEffect(() => {
    if (liveCall?.status !== 'active') {
      setElapsedSec(0);
      return;
    }
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [liveCall?.status]);

  // Caller sets up RTCPeerConnection + offer (consuming primed gesture stream if available)
  useEffect(() => {
    if (!call || !isCaller) return;
    let active = true;
    let unsubAnswerCand: (() => void) | null = null;
    let unsubDoc: (() => void) | null = null;

    const startCaller = async () => {
      const wantVideo = call.callType === 'video';
      const primed = await consumePrimedStream('call', wantVideo);
      const res =
        primed ||
        (await acquireMediaWithFallback({
          wantAudio: true,
          wantVideo,
          facingMode: cameraFacing,
        }));

      if (!active) {
        res.stream?.getTracks().forEach((t) => t.stop());
        return;
      }

      localStreamRef.current = res.stream;
      attachLocalStreamToElement(res.stream);
      setCameraOff(!res.videoGranted);
      setMediaError(res.errorMessage);

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;

      await bindTracksToPeerConnection(pc, res.stream, wantVideo);

      pc.ontrack = (event) => {
        attachRemoteStreamTrack(event.track, event.streams);
      };

      const callerCandidatesRef = collection(db, 'calls', call.callId, 'callerCandidates');
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          addDoc(callerCandidatesRef, ev.candidate.toJSON()).catch(() => {});
        }
      };

      try {
        const offerDesc = await pc.createOffer();
        await pc.setLocalDescription(offerDesc);

        await updateDoc(doc(db, 'calls', call.callId), {
          offer: { type: offerDesc.type, sdp: offerDesc.sdp || '' },
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
      } catch {
        // ignore signaling error
      }

      unsubDoc = onSnapshot(doc(db, 'calls', call.callId), async (snap) => {
        const data = snap.data() as CallSession | undefined;
        if (!data?.answer?.sdp || pc.signalingState === 'closed') return;
        if (data.answer.sdp !== appliedAnswerSdpRef.current) {
          appliedAnswerSdpRef.current = data.answer.sdp;
          await pc
            .setRemoteDescription(
              new RTCSessionDescription({ type: data.answer.type as RTCSdpType, sdp: data.answer.sdp })
            )
            .catch(() => {});
          await flushPendingIce(pc);
        }
      });

      unsubAnswerCand = onSnapshot(
        collection(db, 'calls', call.callId, 'calleeCandidates'),
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const candData = change.doc.data() as RTCIceCandidateInit;
              if (pc.remoteDescription) {
                pc.addIceCandidate(new RTCIceCandidate(candData)).catch(() => {});
              } else {
                pendingIceCandidatesRef.current.push(candData);
              }
            }
          });
        }
      );
    };

    startCaller();

    return () => {
      active = false;
      unsubAnswerCand?.();
      unsubDoc?.();
      cleanupMedia();
    };
  }, [call?.callId, isCaller]);

  // If callee accepted before caller's offer arrived, apply the offer automatically once it arrives
  useEffect(() => {
    if (isCaller || !liveCall?.offer?.sdp) return;
    const pc = pcRef.current;
    if (!pc || pc.signalingState === 'closed') return;
    if (liveCall.status !== 'active') return;
    if (liveCall.offer.sdp === appliedOfferSdpRef.current) return;

    const applyRemoteOffer = async () => {
      try {
        appliedOfferSdpRef.current = liveCall.offer!.sdp;
        await pc.setRemoteDescription(
          new RTCSessionDescription({
            type: liveCall.offer!.type as RTCSdpType,
            sdp: liveCall.offer!.sdp,
          })
        );
        await flushPendingIce(pc);
        const answerDesc = await pc.createAnswer();
        await pc.setLocalDescription(answerDesc);
        await updateDoc(doc(db, 'calls', liveCall.callId), {
          answer: { type: answerDesc.type, sdp: answerDesc.sdp || '' },
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
      } catch {
        // ignore renegotiation error
      }
    };

    applyRemoteOffer();
  }, [isCaller, liveCall?.status, liveCall?.offer?.sdp]);

  // Callee accepts incoming call DIRECTLY inside user click gesture
  const handleAcceptCall = async () => {
    if (!liveCall) return;
    const wantVideo = liveCall.callType === 'video';
    const res = await acquireMediaWithFallback({
      wantAudio: true,
      wantVideo,
      facingMode: cameraFacing,
    });

    localStreamRef.current = res.stream;
    attachLocalStreamToElement(res.stream);
    setCameraOff(!res.videoGranted);
    setMediaError(res.errorMessage);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    await bindTracksToPeerConnection(pc, res.stream, wantVideo);

    pc.ontrack = (event) => {
      attachRemoteStreamTrack(event.track, event.streams);
    };

    const calleeCandidatesRef = collection(db, 'calls', liveCall.callId, 'calleeCandidates');
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        addDoc(calleeCandidatesRef, ev.candidate.toJSON()).catch(() => {});
      }
    };

    unsubCandidatesRef.current?.();
    unsubCandidatesRef.current = onSnapshot(
      collection(db, 'calls', liveCall.callId, 'callerCandidates'),
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const candData = change.doc.data() as RTCIceCandidateInit;
            if (pc.remoteDescription) {
              pc.addIceCandidate(new RTCIceCandidate(candData)).catch(() => {});
            } else {
              pendingIceCandidatesRef.current.push(candData);
            }
          }
        });
      }
    );

    if (liveCall.offer?.sdp) {
      try {
        appliedOfferSdpRef.current = liveCall.offer.sdp;
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: liveCall.offer.type as RTCSdpType, sdp: liveCall.offer.sdp })
        );
        await flushPendingIce(pc);
        const answerDesc = await pc.createAnswer();
        await pc.setLocalDescription(answerDesc);

        await updateDoc(doc(db, 'calls', liveCall.callId), {
          answer: { type: answerDesc.type, sdp: answerDesc.sdp || '' },
          status: 'active',
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
        return;
      } catch {
        // fall through to mark active so offer effect can retry
      }
    }

    await updateDoc(doc(db, 'calls', liveCall.callId), {
      status: 'active',
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  };

  // Explicit click-driven Retry when permission was initially blocked
  const handleRetryMedia = async () => {
    if (retryingMedia || !liveCall) return;
    setRetryingMedia(true);
    try {
      const wantVideo = liveCall.callType === 'video';
      const res = await acquireMediaWithFallback({
        wantAudio: true,
        wantVideo,
        facingMode: cameraFacing,
      });

      if (res.stream) {
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        res.stream.getAudioTracks().forEach((t) => {
          t.enabled = !micMuted;
        });
        localStreamRef.current = res.stream;
        attachLocalStreamToElement(res.stream);
        setCameraOff(!res.videoGranted);

        if (pcRef.current && pcRef.current.signalingState !== 'closed') {
          await bindTracksToPeerConnection(pcRef.current, res.stream, wantVideo);
        }
      }
      setMediaError(res.errorMessage);
    } finally {
      setRetryingMedia(false);
    }
  };

  const handleEndCall = async (nextStatus: 'ended' | 'declined' = 'ended') => {
    if (liveCall) {
      await updateDoc(doc(db, 'calls', liveCall.callId), {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }
    cleanupMedia();
    onClose();
  };

  const toggleMute = async () => {
    const existingAudio = localStreamRef.current?.getAudioTracks() || [];
    if (existingAudio.length === 0) {
      const res = await acquireMediaWithFallback({ wantAudio: true, wantVideo: false });
      if (res.stream) {
        const audioTrack = res.stream.getAudioTracks()[0];
        if (audioTrack) {
          const stream = localStreamRef.current || new MediaStream();
          stream.addTrack(audioTrack);
          localStreamRef.current = stream;
          if (pcRef.current && pcRef.current.signalingState !== 'closed') {
            await bindTracksToPeerConnection(pcRef.current, stream, isVideo);
          }
          setMicMuted(false);
          setMediaError(null);
          return;
        }
      }
      if (res.errorMessage) setMediaError(res.errorMessage);
      return;
    }

    const next = !micMuted;
    setMicMuted(next);
    existingAudio.forEach((tr) => {
      tr.enabled = !next;
    });
  };

  // True Hardware Camera ON / OFF without disrupting Mic Audio
  const toggleCam = async () => {
    if (!isVideo) return;

    if (!cameraOff) {
      const currentStream = localStreamRef.current;
      if (currentStream) {
        currentStream.getVideoTracks().forEach((tr) => {
          tr.stop();
          currentStream.removeTrack(tr);
        });
        const refreshed = new MediaStream(currentStream.getTracks());
        localStreamRef.current = refreshed;
        attachLocalStreamToElement(refreshed);
      }
      if (pcRef.current && pcRef.current.signalingState !== 'closed') {
        const videoTransceiver = findTransceiverByKind(pcRef.current, 'video');
        if (videoTransceiver) {
          await videoTransceiver.sender.replaceTrack(null).catch(() => {});
        }
      }
      setCameraOff(true);
      return;
    }

    // Turn Camera ON directly inside user tap gesture!
    setMediaError(null);
    const { track, errorMessage } = await acquireVideoTrackOnly(cameraFacing);
    if (!track) {
      setCameraOff(true);
      if (errorMessage) setMediaError(errorMessage);
      return;
    }

    const baseStream = localStreamRef.current || new MediaStream();
    baseStream.getVideoTracks().forEach((old) => {
      old.stop();
      baseStream.removeTrack(old);
    });
    baseStream.addTrack(track);
    const nextStream = new MediaStream(baseStream.getTracks());
    localStreamRef.current = nextStream;
    attachLocalStreamToElement(nextStream);
    setCameraOff(false);

    if (pcRef.current && pcRef.current.signalingState !== 'closed') {
      const videoTransceiver = findTransceiverByKind(pcRef.current, 'video');
      if (videoTransceiver) {
        if (videoTransceiver.direction === 'recvonly') {
          videoTransceiver.direction = 'sendrecv';
        }
        await videoTransceiver.sender.replaceTrack(track).catch(() => {});
      } else {
        pcRef.current.addTrack(track, nextStream);
      }
    }
  };

  const handleFlipCamera = async () => {
    if (!isVideo || cameraOff) return;
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    const { track, errorMessage } = await acquireVideoTrackOnly(nextFacing);
    if (!track) {
      if (errorMessage) setMediaError(errorMessage);
      return;
    }

    const baseStream = localStreamRef.current || new MediaStream();
    baseStream.getVideoTracks().forEach((old) => {
      old.stop();
      baseStream.removeTrack(old);
    });
    baseStream.addTrack(track);
    const nextStream = new MediaStream(baseStream.getTracks());
    localStreamRef.current = nextStream;
    attachLocalStreamToElement(nextStream);
    setCameraFacing(nextFacing);
    setMediaError(null);

    if (pcRef.current && pcRef.current.signalingState !== 'closed') {
      const videoTransceiver = findTransceiverByKind(pcRef.current, 'video');
      if (videoTransceiver) {
        await videoTransceiver.sender.replaceTrack(track).catch(() => {});
      }
    }
  };

  if (!call || !liveCall) return null;

  const peerName = isCaller ? liveCall.calleeDisplayName : liveCall.callerDisplayName;
  const peerPhoto = isCaller ? liveCall.calleePhotoURL : liveCall.callerPhotoURL;
  const peerUsername = isCaller ? liveCall.calleeUsername : liveCall.callerUsername;

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-between p-6 text-white animate-in fade-in duration-200">
      <audio ref={remoteAudioRef} autoPlay className="hidden" />

      {/* Top Info */}
      <div className="w-full max-w-md flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#B09EFC]">
          {isVideo ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
          <span>{isVideo ? 'Video Call' : 'Audio Call'}</span>
          {liveCall.status === 'active' && (
            <span className="ml-1 font-mono text-white/80">{formatDuration(elapsedSec)}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => handleEndCall('ended')}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Center Video or Avatar Stage */}
      <div className="flex-1 w-full max-w-md flex flex-col items-center justify-center relative my-4">
        {isVideo ? (
          <div className="relative w-full h-full max-h-[540px] rounded-3xl overflow-hidden bg-slate-900 border border-white/10 flex items-center justify-center">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {/* Local PiP Video */}
            <div className="absolute bottom-3 right-3 w-28 h-36 rounded-2xl overflow-hidden border-2 border-[#7560DF] shadow-xl bg-black flex items-center justify-center">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className={`w-full h-full object-cover ${cameraOff ? 'hidden' : ''}`}
              />
              {cameraOff && (
                <div className="flex flex-col items-center justify-center gap-1 text-white/70 p-2 text-center">
                  <VideoOff className="w-6 h-6 text-rose-400" />
                  <span className="text-[10px] font-bold">Cam Off</span>
                </div>
              )}
            </div>

            {liveCall.status !== 'active' && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-center p-4">
                <img
                  src={peerPhoto || `https://api.dicebear.com/7.x/bottts/svg?seed=${peerUsername}`}
                  alt={peerName}
                  className="w-24 h-24 rounded-full object-cover ring-4 ring-[#7560DF] mb-3 animate-pulse"
                />
                <h3 className="text-xl font-extrabold">{peerName}</h3>
                <p className="text-xs text-white/70 mt-1">
                  {liveCall.status === 'ringing'
                    ? isCaller
                      ? 'Ringing...'
                      : 'Incoming Video Call...'
                    : liveCall.status}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="relative">
              <img
                src={peerPhoto || `https://api.dicebear.com/7.x/bottts/svg?seed=${peerUsername}`}
                alt={peerName}
                className={`w-28 h-28 rounded-full object-cover ring-4 ring-[#7560DF] ${
                  liveCall.status === 'ringing' ? 'animate-pulse' : ''
                }`}
              />
            </div>
            <h3 className="text-2xl font-extrabold">{peerName}</h3>
            <p className="text-xs text-[#B09EFC]">@{peerUsername}</p>
            <p className="text-sm font-mono text-white/80">
              {liveCall.status === 'active'
                ? formatDuration(elapsedSec)
                : liveCall.status === 'ringing'
                ? isCaller
                  ? 'Calling...'
                  : 'Incoming Audio Call...'
                : liveCall.status}
            </p>
          </div>
        )}

        {mediaError && (
          <div className="mt-3 px-4 py-2.5 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-100 text-xs text-center max-w-sm space-y-2">
            <div className="flex items-center justify-center gap-1.5 font-semibold">
              <ShieldAlert className="w-4 h-4 text-amber-300 shrink-0" />
              <span>{mediaError}</span>
            </div>
            <button
              type="button"
              onClick={handleRetryMedia}
              disabled={retryingMedia}
              className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-[11px] inline-flex items-center gap-1.5 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${retryingMedia ? 'animate-spin' : ''}`} />
              <span>{retryingMedia ? 'Checking...' : 'Hayyama Camera & Mic Kenni / Retry'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 pb-4">
        {!isCaller && liveCall.status === 'ringing' ? (
          <>
            <button
              type="button"
              onClick={() => handleEndCall('declined')}
              className="p-4 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow-lg"
              title="Decline"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
            <button
              type="button"
              onClick={handleAcceptCall}
              className="p-4 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg animate-bounce"
              title="Accept"
            >
              {isVideo ? <Video className="w-6 h-6" /> : <Phone className="w-6 h-6" />}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleMute}
              className={`p-4 rounded-full transition-colors ${
                micMuted ? 'bg-rose-500/30 text-rose-300' : 'bg-white/15 hover:bg-white/25'
              }`}
              title={micMuted ? 'Unmute' : 'Mute'}
            >
              {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            {isVideo && (
              <button
                type="button"
                onClick={toggleCam}
                className={`p-4 rounded-full transition-colors ${
                  cameraOff ? 'bg-rose-500/30 text-rose-300' : 'bg-[#7560DF] hover:bg-[#624ec7]'
                }`}
                title={cameraOff ? 'Camera On' : 'Camera Off'}
              >
                {cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              </button>
            )}

            {isVideo && !cameraOff && (
              <button
                type="button"
                onClick={handleFlipCamera}
                className="p-4 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
                title="Switch Camera"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => handleEndCall('ended')}
              className="p-4 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow-lg"
              title="End Call"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
