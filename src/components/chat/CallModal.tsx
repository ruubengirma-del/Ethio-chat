import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Volume2,
  X,
} from 'lucide-react';
import {
  acquireMediaWithFallback,
  acquireVideoTrackOnly,
  consumePrimedStream,
} from '../../lib/mediaPermissions';
import { getRtcConfiguration } from '../../lib/rtcConfig';

interface CallModalProps {
  call: CallSession | null;
  currentUserId: string;
  onClose: () => void;
}

interface SignalingPayload {
  type: string;
  sdp: string;
  by?: string;
  seq?: number;
}

function findTransceiverByKind(
  pc: RTCPeerConnection,
  kind: 'audio' | 'video'
): RTCRtpTransceiver | undefined {
  return pc
    .getTransceivers()
    .find(
      (t) =>
        t.receiver?.track?.kind === kind ||
        t.sender?.track?.kind === kind
    );
}

function getSignalKey(sig?: SignalingPayload | null): string {
  if (!sig?.sdp) return '';
  return `${sig.seq ?? 0}:${sig.sdp.length}:${sig.sdp.slice(0, 64)}`;
}

export const CallModal: React.FC<CallModalProps> = ({ call, currentUserId, onClose }) => {
  const [liveCall, setLiveCall] = useState<CallSession | null>(call);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(call?.callType !== 'video');
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [retryingMedia, setRetryingMedia] = useState(false);
  const [localStreamState, setLocalStreamState] = useState<MediaStream | null>(null);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [iceConnected, setIceConnected] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteTracksRef = useRef<Map<string, MediaStreamTrack>>(new Map());
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const appliedAnswerKeyRef = useRef<string>('');
  const appliedOfferKeyRef = useRef<string>('');
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const unsubCandidatesRef = useRef<(() => void) | null>(null);
  const makingOfferRef = useRef<boolean>(false);
  const signalingChainRef = useRef<Promise<void>>(Promise.resolve());
  const acceptedRef = useRef<boolean>(false);
  const iceRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isCaller = call?.callerId === currentUserId;
  const isPolite = !isCaller;
  const isVideo = (liveCall?.callType || call?.callType) === 'video';
  const callId = call?.callId || '';

  const enqueueSignaling = useCallback((fn: () => Promise<void>) => {
    signalingChainRef.current = signalingChainRef.current.then(fn).catch(() => {});
    return signalingChainRef.current;
  }, []);

  const syncRemoteMediaElements = useCallback(() => {
    const allTracks = Array.from(remoteTracksRef.current.values()).filter(
      (t) => t.readyState === 'live'
    );
    const audioTracks = allTracks.filter((t) => t.kind === 'audio');
    const videoTracks = allTracks.filter((t) => t.kind === 'video');

    const hasActiveVideo = videoTracks.some((t) => !t.muted);
    setHasRemoteVideo(hasActiveVideo);

    if (remoteAudioRef.current) {
      if (audioTracks.length > 0) {
        const audioStream = new MediaStream(audioTracks);
        remoteAudioRef.current.srcObject = audioStream;
        remoteAudioRef.current.muted = false;
        remoteAudioRef.current.volume = 1;
        remoteAudioRef.current
          .play()
          .then(() => setAudioBlocked(false))
          .catch((err) => {
            if (err && err.name === 'NotAllowedError') {
              setAudioBlocked(true);
            }
          });
      } else {
        remoteAudioRef.current.srcObject = null;
      }
    }

    if (remoteVideoRef.current) {
      if (videoTracks.length > 0) {
        const videoStream = new MediaStream(videoTracks);
        remoteVideoRef.current.srcObject = videoStream;
        remoteVideoRef.current.play().catch(() => {});
      } else {
        remoteVideoRef.current.srcObject = null;
      }
    }
  }, []);

  const attachRemoteStreamTrack = useCallback(
    (track: MediaStreamTrack) => {
      remoteTracksRef.current.set(track.id, track);

      track.onunmute = () => {
        syncRemoteMediaElements();
      };
      track.onmute = () => {
        syncRemoteMediaElements();
      };
      track.onended = () => {
        remoteTracksRef.current.delete(track.id);
        syncRemoteMediaElements();
      };

      syncRemoteMediaElements();
    },
    [syncRemoteMediaElements]
  );

  const unlockAudioPlayback = useCallback(() => {
    if (remoteAudioRef.current && remoteAudioRef.current.srcObject) {
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.volume = 1;
      remoteAudioRef.current
        .play()
        .then(() => setAudioBlocked(false))
        .catch(() => {});
    }
    if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
      remoteVideoRef.current.play().catch(() => {});
    }
  }, []);

  // Keep local PiP video element attached reliably even if mounted after stream acquisition
  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    if (localStreamState && !cameraOff && localStreamState.getVideoTracks().length > 0) {
      el.srcObject = new MediaStream(localStreamState.getVideoTracks());
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [localStreamState, cameraOff, isVideo]);

  // Re-sync remote video when remoteVideoRef mounts or callType updates
  useEffect(() => {
    syncRemoteMediaElements();
  }, [isVideo, hasRemoteVideo, syncRemoteMediaElements]);

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
      if (audioTrack && (existingAudio.direction === 'recvonly' || existingAudio.direction === 'inactive')) {
        existingAudio.direction = 'sendrecv';
      }
      await existingAudio.sender.replaceTrack(audioTrack).catch(() => {});
    } else if (audioTrack && stream) {
      pc.addTrack(audioTrack, stream);
    } else {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    }

    if (wantVideoTransceiver || videoTrack) {
      const existingVideo = findTransceiverByKind(pc, 'video');
      if (existingVideo) {
        if (videoTrack && (existingVideo.direction === 'recvonly' || existingVideo.direction === 'inactive')) {
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

  const sendRenegotiationOffer = useCallback(
    async (pc: RTCPeerConnection, targetCallId: string) => {
      if (!targetCallId || pc.signalingState === 'closed') return;
      await enqueueSignaling(async () => {
        if (pc.signalingState !== 'stable') return;
        makingOfferRef.current = true;
        try {
          const offerDesc = await pc.createOffer();
          if (pc.signalingState !== 'stable') return;
          await pc.setLocalDescription(offerDesc);
          const payload: SignalingPayload = {
            type: offerDesc.type,
            sdp: offerDesc.sdp || '',
            by: currentUserId,
            seq: Date.now(),
          };
          await updateDoc(doc(db, 'calls', targetCallId), {
            offer: payload,
            updatedAt: new Date().toISOString(),
          }).catch(() => {});
        } finally {
          makingOfferRef.current = false;
        }
      });
    },
    [currentUserId, enqueueSignaling]
  );

  const wirePeerConnectionHandlers = useCallback(
    (pc: RTCPeerConnection, targetCallId: string, candidateSubcollection: 'callerCandidates' | 'calleeCandidates') => {
      pc.ontrack = (event) => {
        attachRemoteStreamTrack(event.track);
      };

      const candRef = collection(db, 'calls', targetCallId, candidateSubcollection);
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          addDoc(candRef, ev.candidate.toJSON()).catch(() => {});
        }
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if (state === 'connected' || state === 'completed') {
          setIceConnected(true);
          if (iceRestartTimerRef.current) {
            clearTimeout(iceRestartTimerRef.current);
            iceRestartTimerRef.current = null;
          }
        } else if (state === 'disconnected') {
          if (!iceRestartTimerRef.current) {
            iceRestartTimerRef.current = setTimeout(() => {
              iceRestartTimerRef.current = null;
              if (pc.signalingState !== 'closed' && (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed')) {
                try {
                  pc.restartIce();
                  if (isCaller) void sendRenegotiationOffer(pc, targetCallId);
                } catch {}
              }
            }, 4000);
          }
        } else if (state === 'failed') {
          setIceConnected(false);
          try {
            pc.restartIce();
            if (isCaller) void sendRenegotiationOffer(pc, targetCallId);
          } catch {}
        } else if (state === 'closed') {
          setIceConnected(false);
        }
      };
    },
    [attachRemoteStreamTrack, isCaller, sendRenegotiationOffer]
  );

  const cleanupMedia = useCallback(() => {
    if (iceRestartTimerRef.current) {
      clearTimeout(iceRestartTimerRef.current);
      iceRestartTimerRef.current = null;
    }
    try {
      unsubCandidatesRef.current?.();
    } catch {}
    unsubCandidatesRef.current = null;
    try {
      localStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    } catch {}
    localStreamRef.current = null;
    setLocalStreamState(null);
    remoteTracksRef.current.clear();
    setHasRemoteVideo(false);
    setAudioBlocked(false);
    setIceConnected(false);
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;
    appliedAnswerKeyRef.current = '';
    appliedOfferKeyRef.current = '';
    pendingIceCandidatesRef.current = [];
    makingOfferRef.current = false;
    acceptedRef.current = false;
  }, []);

  // Process remote Firestore signaling (offers & answers from the other user) cleanly via Perfect Negotiation
  const handleRemoteSignalingSnapshot = useCallback(
    (data: CallSession) => {
      const pc = pcRef.current;
      if (!pc || pc.signalingState === 'closed') return;
      if (!isCaller && !acceptedRef.current && data.status !== 'active') return;

      const remoteOffer = data.offer as SignalingPayload | undefined;
      const offerFromOther = Boolean(
        remoteOffer?.sdp &&
          (remoteOffer.by ? remoteOffer.by !== currentUserId : !isCaller)
      );
      const offerKey = getSignalKey(remoteOffer);

      if (offerFromOther && offerKey && offerKey !== appliedOfferKeyRef.current) {
        appliedOfferKeyRef.current = offerKey;
        void enqueueSignaling(async () => {
          if (pc.signalingState === 'closed') return;
          const offerCollision =
            makingOfferRef.current || pc.signalingState !== 'stable';
          if (offerCollision && !isPolite) {
            return;
          }
          if (offerCollision && pc.signalingState !== 'stable') {
            await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
          }
          await pc.setRemoteDescription(
            new RTCSessionDescription({
              type: remoteOffer!.type as RTCSdpType,
              sdp: remoteOffer!.sdp,
            })
          );
          await bindTracksToPeerConnection(
            pc,
            localStreamRef.current,
            data.callType === 'video'
          );
          await flushPendingIce(pc);
          const answerDesc = await pc.createAnswer();
          await pc.setLocalDescription(answerDesc);
          const answerPayload: SignalingPayload = {
            type: answerDesc.type,
            sdp: answerDesc.sdp || '',
            by: currentUserId,
            seq: Date.now(),
          };
          await updateDoc(doc(db, 'calls', data.callId), {
            answer: answerPayload,
            ...(data.status === 'ringing' ? { status: 'active' } : {}),
            updatedAt: new Date().toISOString(),
          }).catch(() => {});
        });
      }

      const remoteAnswer = data.answer as SignalingPayload | undefined;
      const answerFromOther = Boolean(
        remoteAnswer?.sdp &&
          (remoteAnswer.by ? remoteAnswer.by !== currentUserId : isCaller)
      );
      const answerKey = getSignalKey(remoteAnswer);

      if (answerFromOther && answerKey && answerKey !== appliedAnswerKeyRef.current) {
        appliedAnswerKeyRef.current = answerKey;
        void enqueueSignaling(async () => {
          if (pc.signalingState === 'closed') return;
          if (pc.signalingState !== 'have-local-offer') return;
          await pc.setRemoteDescription(
            new RTCSessionDescription({
              type: remoteAnswer!.type as RTCSdpType,
              sdp: remoteAnswer!.sdp,
            })
          );
          await flushPendingIce(pc);
        });
      }
    },
    [currentUserId, enqueueSignaling, isCaller, isPolite]
  );

  // Keep liveCall & signaling synced with Firestore
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
          return;
        }
        handleRemoteSignalingSnapshot(updated);
      }
    });
    return () => unsub();
  }, [call?.callId, cleanupMedia, handleRemoteSignalingSnapshot]);

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

    const startCaller = async () => {
      const wantVideo = call.callType === 'video';
      const [rtcConfig, primed] = await Promise.all([
        getRtcConfiguration(),
        consumePrimedStream('call', wantVideo),
      ]);
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
      setLocalStreamState(res.stream ? new MediaStream(res.stream.getTracks()) : null);
      setCameraOff(!res.videoGranted);
      setMediaError(res.errorMessage);

      const pc = new RTCPeerConnection(rtcConfig);
      pcRef.current = pc;
      wirePeerConnectionHandlers(pc, call.callId, 'callerCandidates');

      await bindTracksToPeerConnection(pc, res.stream, wantVideo);

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

      await sendRenegotiationOffer(pc, call.callId);
    };

    void startCaller();

    return () => {
      active = false;
      unsubAnswerCand?.();
      cleanupMedia();
    };
  }, [call?.callId, isCaller, cleanupMedia, sendRenegotiationOffer, wirePeerConnectionHandlers]);

  // Callee accepts incoming call DIRECTLY inside user click gesture
  const handleAcceptCall = async () => {
    if (!liveCall || acceptedRef.current) return;
    acceptedRef.current = true;
    unlockAudioPlayback();

    const wantVideo = liveCall.callType === 'video';
    const [rtcConfig, res] = await Promise.all([
      getRtcConfiguration(),
      acquireMediaWithFallback({
        wantAudio: true,
        wantVideo,
        facingMode: cameraFacing,
      }),
    ]);

    localStreamRef.current = res.stream;
    setLocalStreamState(res.stream ? new MediaStream(res.stream.getTracks()) : null);
    setCameraOff(!res.videoGranted);
    setMediaError(res.errorMessage);

    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;
    wirePeerConnectionHandlers(pc, liveCall.callId, 'calleeCandidates');

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
      await updateDoc(doc(db, 'calls', liveCall.callId), {
        status: 'active',
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
      handleRemoteSignalingSnapshot({ ...liveCall, status: 'active' });
      return;
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
    unlockAudioPlayback();
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
        const nextStream = new MediaStream(res.stream.getTracks());
        localStreamRef.current = nextStream;
        setLocalStreamState(nextStream);
        setCameraOff(!res.videoGranted);

        if (pcRef.current && pcRef.current.signalingState !== 'closed') {
          await bindTracksToPeerConnection(pcRef.current, nextStream, wantVideo);
          await sendRenegotiationOffer(pcRef.current, liveCall.callId);
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
    unlockAudioPlayback();
    const existingAudio = localStreamRef.current?.getAudioTracks() || [];
    if (existingAudio.length === 0) {
      const res = await acquireMediaWithFallback({ wantAudio: true, wantVideo: false });
      if (res.stream) {
        const audioTrack = res.stream.getAudioTracks()[0];
        if (audioTrack) {
          const stream = localStreamRef.current || new MediaStream();
          stream.addTrack(audioTrack);
          const refreshed = new MediaStream(stream.getTracks());
          localStreamRef.current = refreshed;
          setLocalStreamState(refreshed);
          if (pcRef.current && pcRef.current.signalingState !== 'closed') {
            await bindTracksToPeerConnection(pcRef.current, refreshed, isVideo);
            if (callId) await sendRenegotiationOffer(pcRef.current, callId);
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
    unlockAudioPlayback();

    if (!cameraOff) {
      const currentStream = localStreamRef.current;
      if (currentStream) {
        currentStream.getVideoTracks().forEach((tr) => {
          tr.stop();
          currentStream.removeTrack(tr);
        });
        const refreshed = new MediaStream(currentStream.getTracks());
        localStreamRef.current = refreshed;
        setLocalStreamState(refreshed);
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
    setLocalStreamState(nextStream);
    setCameraOff(false);

    if (pcRef.current && pcRef.current.signalingState !== 'closed') {
      const videoTransceiver = findTransceiverByKind(pcRef.current, 'video');
      let needsReneg = false;
      if (videoTransceiver) {
        if (videoTransceiver.direction === 'recvonly' || videoTransceiver.direction === 'inactive') {
          videoTransceiver.direction = 'sendrecv';
          needsReneg = true;
        }
        await videoTransceiver.sender.replaceTrack(track).catch(() => {});
      } else {
        pcRef.current.addTrack(track, nextStream);
        needsReneg = true;
      }
      if (needsReneg && callId) {
        await sendRenegotiationOffer(pcRef.current, callId);
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
    setLocalStreamState(nextStream);
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
    <div
      onClick={audioBlocked ? unlockAudioPlayback : undefined}
      className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-between p-6 text-white animate-in fade-in duration-200"
    >
      {/* Dedicated audio sink using sr-only (not display:none) so mobile Chrome/WebView plays audio reliably */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="sr-only" />

      {/* Top Info */}
      <div className="w-full max-w-md flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#B09EFC]">
          {isVideo ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
          <span>{isVideo ? 'Video Call' : 'Audio Call'}</span>
          {liveCall.status === 'active' && (
            <span className="ml-1 font-mono text-white/80">
              {iceConnected ? formatDuration(elapsedSec) : 'Connecting...'}
            </span>
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

      {/* Tap to enable sound banner if mobile browser blocked async audio autoplay */}
      {audioBlocked && (
        <button
          type="button"
          onClick={unlockAudioPlayback}
          className="mt-2 px-4 py-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs inline-flex items-center gap-2 shadow-lg animate-bounce"
        >
          <Volume2 className="w-4 h-4" />
          <span>Sagalee Bani / Tap to Hear Sound</span>
        </button>
      )}

      {/* Center Video or Avatar Stage */}
      <div className="flex-1 w-full max-w-md flex flex-col items-center justify-center relative my-4">
        {isVideo ? (
          <div className="relative w-full h-full max-h-[540px] rounded-3xl overflow-hidden bg-slate-900 border border-white/10 flex items-center justify-center">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${hasRemoteVideo ? '' : 'opacity-0'}`}
            />

            {liveCall.status === 'active' && !hasRemoteVideo && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 pointer-events-none">
                <img
                  src={peerPhoto || `https://api.dicebear.com/7.x/bottts/svg?seed=${peerUsername}`}
                  alt={peerName}
                  className="w-24 h-24 rounded-full object-cover ring-4 ring-[#7560DF] mb-3"
                />
                <h3 className="text-lg font-extrabold">{peerName}</h3>
                <p className="text-xs text-white/60 mt-1">
                  {iceConnected ? 'Camera off' : 'Connecting video...'}
                </p>
              </div>
            )}

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
                ? iceConnected
                  ? formatDuration(elapsedSec)
                  : 'Connecting audio...'
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
