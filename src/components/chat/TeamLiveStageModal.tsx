import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Team,
  TeamLiveSeat,
  TeamLiveSeatRequest,
  TeamLiveComment,
  TeamMember,
  UserProfile,
  TeamLiveViewer
} from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { db } from '../../lib/firebase';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy
} from 'firebase/firestore';
import { compressImage } from '../../lib/mediaCompression';
import { REACTION_EMOJIS_8 } from '../../lib/socialHelpers';
import {
  X,
  Mic,
  MicOff,
  Video,
  VideoOff,
  RefreshCw,
  PhoneOff,
  Plus,
  Crown,
  UserMinus,
  Send,
  Image as ImageIcon,
  Lock,
  Unlock,
  Check,
  Radio,
  Users,
  MessageCircle,
  Loader2,
  Smile,
  Eye,
  ShieldAlert
} from 'lucide-react';
import {
  acquireMediaWithFallback,
  acquireVideoTrackOnly,
  consumePrimedStream,
} from '../../lib/mediaPermissions';

interface TeamLiveStageModalProps {
  team: Team;
  currentUser: UserProfile;
  members: TeamMember[];
  onClose: () => void;
}

interface RemotePeerInfo {
  userId: string;
  username: string;
  displayName: string;
  photoURL?: string;
  seatNumber: number | null;
  micMuted: boolean;
  cameraOn: boolean;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const SEAT_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

// Strictly bounded single seat video/audio player — renders ONLY inside that specific seat slot
const SeatVideoSlot: React.FC<{ stream: MediaStream; muted?: boolean }> = ({ stream, muted }) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={Boolean(muted)}
      className="w-full h-full object-cover"
    />
  );
};

// Hidden audio sink so unseated audience and seated participants hear every seated speaker even if camera is OFF
const PeerAudioSink: React.FC<{ stream: MediaStream }> = ({ stream }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]);
  return <audio ref={audioRef} autoPlay className="hidden" />;
};

function findLiveTransceiver(pc: RTCPeerConnection, kind: 'audio' | 'video'): RTCRtpTransceiver | undefined {
  return pc
    .getTransceivers()
    .find((t) => t.receiver?.track?.kind === kind || t.sender?.track?.kind === kind);
}

export const TeamLiveStageModal: React.FC<TeamLiveStageModalProps> = ({
  team,
  currentUser,
  members,
  onClose,
}) => {
  const { t } = useLanguage();
  const isOwner = team.ownerId === currentUser.userId;
  const isVideoRoom = team.liveRoom?.mode === 'video';
  const liveCommentsEnabled = team.liveRoom?.liveCommentsEnabled !== false;

  const [seats, setSeats] = useState<Record<number, TeamLiveSeat>>({});
  const [seatRequests, setSeatRequests] = useState<TeamLiveSeatRequest[]>([]);
  const [liveComments, setLiveComments] = useState<TeamLiveComment[]>([]);
  const [peersInRoom, setPeersInRoom] = useState<RemotePeerInfo[]>([]);
  const [liveViewerIds, setLiveViewerIds] = useState<Set<string>>(new Set());
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const [micMuted, setMicMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(isVideoRoom);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [retryingMedia, setRetryingMedia] = useState(false);

  // Assign picker modal when Owner clicks an empty Seat 2..10
  const [assigningSeatNum, setAssigningSeatNum] = useState<number | null>(null);

  // Live Stage-only Comment composer state (text + photo + emoji — never visible in Team Chat)
  const [commentText, setCommentText] = useState('');
  const [commentPhoto, setCommentPhoto] = useState<string>('');
  const [showEmojiTray, setShowEmojiTray] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);
  const [uploadingCommentPhoto, setUploadingCommentPhoto] = useState(false);
  const commentPhotoInputRef = useRef<HTMLInputElement>(null);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceMapRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const mySeatRef = useRef<number | null>(null);
  const cameraOnRef = useRef<boolean>(isVideoRoom);
  const cameraFacingRef = useRef<'user' | 'environment'>('user');
  const micMutedRef = useRef<boolean>(false);

  useEffect(() => {
    cameraOnRef.current = cameraOn;
  }, [cameraOn]);

  useEffect(() => {
    cameraFacingRef.current = cameraFacing;
  }, [cameraFacing]);

  useEffect(() => {
    micMutedRef.current = micMuted;
  }, [micMuted]);

  // Find which seat (1..6) the current user holds
  const mySeat = useMemo(() => {
    const entry = Object.values(seats).find((s) => s.userId === currentUser.userId);
    return entry ? entry.seatNumber : null;
  }, [seats, currentUser.userId]);

  useEffect(() => {
    mySeatRef.current = mySeat;
  }, [mySeat]);

  // Listen to Seats 1..6 in Firestore
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'teams', team.teamId, 'liveSeats'),
      (snap) => {
        const next: Record<number, TeamLiveSeat> = {};
        snap.forEach((d) => {
          const data = d.data() as TeamLiveSeat;
          if (data.seatNumber >= 1 && data.seatNumber <= 6) {
            next[data.seatNumber] = data;
          }
        });
        setSeats(next);
      },
      () => {}
    );
    return () => unsub();
  }, [team.teamId]);

  // Owner ensures Seat 1 belongs strictly to Owner upon opening stage
  useEffect(() => {
    if (!isOwner) return;
    const now = new Date().toISOString();
    setDoc(
      doc(db, 'teams', team.teamId, 'liveSeats', 'seat_1'),
      {
        seatNumber: 1,
        teamId: team.teamId,
        userId: currentUser.userId,
        username: currentUser.username,
        displayName: currentUser.displayName,
        ...(currentUser.photoURL ? { photoURL: currentUser.photoURL } : {}),
        micMuted: false,
        cameraOn: isVideoRoom,
        cameraFacing: 'user',
        updatedAt: now,
      },
      { merge: true }
    ).catch(() => {});
  }, [isOwner, team.teamId, currentUser.userId]);

  // Listen to Pending Seat Requests (Seats 2..10)
  useEffect(() => {
    const q = query(
      collection(db, 'teams', team.teamId, 'seatRequests'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: TeamLiveSeatRequest[] = [];
        snap.forEach((d) => {
          const r = d.data() as TeamLiveSeatRequest;
          if (r.status === 'pending') list.push(r);
        });
        setSeatRequests(list);
      },
      () => {}
    );
    return () => unsub();
  }, [team.teamId]);

  // Listen to Stage-Only Live Comments (isolated inside Voice/Video room ONLY)
  useEffect(() => {
    const q = query(
      collection(db, 'teams', team.teamId, 'liveComments'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: TeamLiveComment[] = [];
        snap.forEach((d) => list.push(d.data() as TeamLiveComment));
        setLiveComments(list);
      },
      () => {}
    );
    return () => unsub();
  }, [team.teamId]);

  // Real-Time Audience Watching Presence (+1 on join, -1 on leave / unmount / close)
  useEffect(() => {
    const viewerRef = doc(db, 'teams', team.teamId, 'liveViewers', currentUser.userId);
    const writePresence = () => {
      const payload: TeamLiveViewer = {
        userId: currentUser.userId,
        teamId: team.teamId,
        username: currentUser.username,
        displayName: currentUser.displayName,
        lastPingAt: new Date().toISOString(),
      };
      setDoc(viewerRef, payload, { merge: true }).catch(() => {});
    };

    writePresence();
    const heartbeat = setInterval(writePresence, 20000);

    const handleBeforeUnload = () => {
      deleteDoc(viewerRef).catch(() => {});
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    const unsub = onSnapshot(
      collection(db, 'teams', team.teamId, 'liveViewers'),
      (snap) => {
        const activeIds = new Set<string>();
        const cutoff = Date.now() - 60000;
        snap.forEach((d) => {
          const v = d.data() as TeamLiveViewer;
          const pingMs = v.lastPingAt ? new Date(v.lastPingAt).getTime() : 0;
          if (pingMs >= cutoff) {
            activeIds.add(v.userId);
          }
        });
        setLiveViewerIds(activeIds);
      },
      () => {}
    );

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      unsub();
      deleteDoc(viewerRef).catch(() => {});
    };
  }, [team.teamId, currentUser.userId, currentUser.username, currentUser.displayName]);

  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveComments.length]);

  // Close all peer connections and stop local stream
  const stopLocalMedia = () => {
    try {
      localStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    } catch {}
    localStreamRef.current = null;
    setLocalStream(null);
  };

  // Sync tracks on all open RTCPeerConnections cleanly WITHOUT tearing down audio
  const syncStreamToPeers = async (stream: MediaStream | null, seated: boolean): Promise<boolean> => {
    let needsRenegotiation = false;
    const audioTrack = stream?.getAudioTracks()[0] || null;
    const videoTrack = stream?.getVideoTracks()[0] || null;

    for (const pc of pcsRef.current.values()) {
      if (pc.signalingState === 'closed') continue;

      const audioTransceiver = findLiveTransceiver(pc, 'audio');
      if (audioTransceiver) {
        const targetDir: RTCRtpTransceiverDirection = seated ? 'sendrecv' : 'recvonly';
        if (audioTransceiver.direction !== targetDir) {
          audioTransceiver.direction = targetDir;
          needsRenegotiation = true;
        }
        await audioTransceiver.sender.replaceTrack(seated ? audioTrack : null).catch(() => {});
      } else if (seated && audioTrack && stream) {
        try {
          pc.addTrack(audioTrack, stream);
          needsRenegotiation = true;
        } catch {}
      }

      const videoTransceiver = findLiveTransceiver(pc, 'video');
      if (videoTransceiver) {
        const targetDir: RTCRtpTransceiverDirection = seated ? 'sendrecv' : 'recvonly';
        if (videoTransceiver.direction !== targetDir) {
          videoTransceiver.direction = targetDir;
          needsRenegotiation = true;
        }
        await videoTransceiver.sender.replaceTrack(seated ? videoTrack : null).catch(() => {});
      } else if (seated && videoTrack && stream) {
        try {
          pc.addTrack(videoTrack, stream);
          needsRenegotiation = true;
        } catch {}
      }
    }

    return needsRenegotiation;
  };

  const broadcastMediaState = (seatNumber: number | null, nextMicMuted: boolean, nextCameraOn: boolean) => {
    if (seatNumber !== null) {
      updateDoc(doc(db, 'teams', team.teamId, 'liveSeats', `seat_${seatNumber}`), {
        micMuted: nextMicMuted,
        cameraOn: nextCameraOn,
        cameraFacing: cameraFacingRef.current,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'media-state',
          seatNumber,
          micMuted: nextMicMuted,
          cameraOn: nextCameraOn,
        })
      );
    }
  };

  const renegotiateAllPeers = async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    for (const [peerId, pc] of pcsRef.current.entries()) {
      if (pc.signalingState === 'closed') continue;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(
          JSON.stringify({
            type: 'webrtc-offer',
            toUserId: peerId,
            sdp: { type: offer.type, sdp: offer.sdp },
          })
        );
      } catch {}
    }
  };

  const flushPeerIce = async (peerId: string, pc: RTCPeerConnection) => {
    if (!pc.remoteDescription) return;
    const list = pendingIceMapRef.current.get(peerId);
    if (!list || list.length === 0) return;
    pendingIceMapRef.current.set(peerId, []);
    for (const cand of list) {
      await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
    }
  };

  // Acquire mic + optional camera ONLY when entering/leaving a Speaker Seat (1..6).
  // Toggling Camera On/Off or Front/Back is handled directly by click handlers so mic audio is NEVER interrupted!
  useEffect(() => {
    let active = true;
    const isSeated = mySeat !== null && mySeat >= 1 && mySeat <= 6;

    if (!isSeated) {
      stopLocalMedia();
      syncStreamToPeers(null, false).then((reneg) => {
        if (reneg) renegotiateAllPeers();
      });
      broadcastMediaState(null, true, false);
      return;
    }

    const setupMedia = async () => {
      setMediaNotice(null);
      const wantVideo = isVideoRoom ? cameraOnRef.current : false;
      const primed = await consumePrimedStream('team-stage', wantVideo);
      const res =
        primed ||
        (await acquireMediaWithFallback({
          wantAudio: true,
          wantVideo,
          facingMode: cameraFacingRef.current,
        }));

      if (!active) {
        res.stream?.getTracks().forEach((tr) => tr.stop());
        return;
      }

      if (res.stream) {
        res.stream.getAudioTracks().forEach((tr) => {
          tr.enabled = !micMutedRef.current;
        });
      }

      const nextCamState = wantVideo ? res.videoGranted : false;
      setCameraOn(nextCamState);
      cameraOnRef.current = nextCamState;
      setMediaNotice(res.errorMessage);

      localStreamRef.current = res.stream;
      setLocalStream(res.stream ? new MediaStream(res.stream.getTracks()) : null);
      const needsReneg = await syncStreamToPeers(res.stream, true);
      if (needsReneg) {
        await renegotiateAllPeers();
      }
      broadcastMediaState(mySeat, micMutedRef.current, nextCamState);
    };

    setupMedia();

    return () => {
      active = false;
    };
  }, [mySeat]);

  // Direct click-driven Retry when permission was blocked on a mobile browser / WebView
  const handleRetryMedia = async () => {
    if (retryingMedia || mySeat === null) return;
    setRetryingMedia(true);
    try {
      const wantVideo = isVideoRoom;
      const res = await acquireMediaWithFallback({
        wantAudio: true,
        wantVideo,
        facingMode: cameraFacingRef.current,
      });

      if (res.stream) {
        localStreamRef.current?.getTracks().forEach((tr) => tr.stop());
        res.stream.getAudioTracks().forEach((tr) => {
          tr.enabled = !micMutedRef.current;
        });
        localStreamRef.current = res.stream;
        setLocalStream(new MediaStream(res.stream.getTracks()));
        const nextCam = wantVideo ? res.videoGranted : false;
        setCameraOn(nextCam);
        cameraOnRef.current = nextCam;
        const needsReneg = await syncStreamToPeers(res.stream, true);
        if (needsReneg) await renegotiateAllPeers();
        broadcastMediaState(mySeat, micMutedRef.current, nextCam);
      }
      setMediaNotice(res.errorMessage);
    } finally {
      setRetryingMedia(false);
    }
  };

  // Toggle Mic Mute (and acquire mic inside user gesture if previously denied)
  const handleToggleMic = async () => {
    if (mySeat === null) return;
    const existingAudio = localStreamRef.current?.getAudioTracks() || [];
    if (existingAudio.length === 0) {
      const res = await acquireMediaWithFallback({ wantAudio: true, wantVideo: false });
      if (res.stream) {
        const audioTrack = res.stream.getAudioTracks()[0];
        if (audioTrack) {
          const base = localStreamRef.current || new MediaStream();
          base.addTrack(audioTrack);
          const refreshed = new MediaStream(base.getTracks());
          localStreamRef.current = refreshed;
          setLocalStream(refreshed);
          setMicMuted(false);
          micMutedRef.current = false;
          setMediaNotice(null);
          const needsReneg = await syncStreamToPeers(refreshed, true);
          if (needsReneg) await renegotiateAllPeers();
          broadcastMediaState(mySeat, false, cameraOnRef.current);
          return;
        }
      }
      if (res.errorMessage) setMediaNotice(res.errorMessage);
      return;
    }

    const next = !micMuted;
    setMicMuted(next);
    micMutedRef.current = next;
    existingAudio.forEach((tr) => {
      tr.enabled = !next;
    });
    broadcastMediaState(mySeat, next, cameraOnRef.current);
  };

  // Toggle Camera ON / OFF inside user gesture without disturbing live mic audio
  const handleToggleCamera = async () => {
    if (mySeat === null) return;

    if (cameraOn) {
      const current = localStreamRef.current;
      if (current) {
        current.getVideoTracks().forEach((tr) => {
          tr.stop();
          current.removeTrack(tr);
        });
        const refreshed = new MediaStream(current.getTracks());
        localStreamRef.current = refreshed;
        setLocalStream(refreshed);
        await syncStreamToPeers(refreshed, true);
      } else {
        await syncStreamToPeers(null, true);
      }
      setCameraOn(false);
      cameraOnRef.current = false;
      broadcastMediaState(mySeat, micMutedRef.current, false);
      return;
    }

    // Turn Camera ON directly inside user tap gesture!
    setMediaNotice(null);
    const { track, errorMessage } = await acquireVideoTrackOnly(cameraFacingRef.current);
    if (!track) {
      setCameraOn(false);
      cameraOnRef.current = false;
      if (errorMessage) setMediaNotice(errorMessage);
      return;
    }

    const base = localStreamRef.current || new MediaStream();
    base.getVideoTracks().forEach((old) => {
      old.stop();
      base.removeTrack(old);
    });
    base.addTrack(track);
    const nextStream = new MediaStream(base.getTracks());
    localStreamRef.current = nextStream;
    setLocalStream(nextStream);
    setCameraOn(true);
    cameraOnRef.current = true;

    const needsReneg = await syncStreamToPeers(nextStream, true);
    if (needsReneg) await renegotiateAllPeers();
    broadcastMediaState(mySeat, micMutedRef.current, true);
  };

  // Switch Front / Back camera inside user gesture without killing mic audio
  const handleFlipCamera = async () => {
    if (mySeat === null || !cameraOn) return;
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    const { track, errorMessage } = await acquireVideoTrackOnly(nextFacing);
    if (!track) {
      if (errorMessage) setMediaNotice(errorMessage);
      return;
    }

    const base = localStreamRef.current || new MediaStream();
    base.getVideoTracks().forEach((old) => {
      old.stop();
      base.removeTrack(old);
    });
    base.addTrack(track);
    const nextStream = new MediaStream(base.getTracks());
    localStreamRef.current = nextStream;
    setLocalStream(nextStream);
    setCameraFacing(nextFacing);
    cameraFacingRef.current = nextFacing;
    setMediaNotice(null);

    const needsReneg = await syncStreamToPeers(nextStream, true);
    if (needsReneg) await renegotiateAllPeers();
    broadcastMediaState(mySeat, micMutedRef.current, true);
  };

  // Create or get RTCPeerConnection for a peer in the live room
  const getOrCreatePeerConnection = (remoteUserId: string): RTCPeerConnection => {
    const existing = pcsRef.current.get(remoteUserId);
    if (existing && existing.signalingState !== 'closed') return existing;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcsRef.current.set(remoteUserId, pc);

    const isSeated = mySeatRef.current !== null;
    const stream = localStreamRef.current;
    const audioTrack = isSeated ? stream?.getAudioTracks()[0] || null : null;
    const videoTrack = isSeated ? stream?.getVideoTracks()[0] || null : null;

    if (audioTrack && stream) {
      pc.addTrack(audioTrack, stream);
    } else {
      try {
        pc.addTransceiver('audio', { direction: isSeated ? 'sendrecv' : 'recvonly' });
      } catch {}
    }

    if (videoTrack && stream) {
      pc.addTrack(videoTrack, stream);
    } else {
      try {
        pc.addTransceiver('video', { direction: isSeated ? 'sendrecv' : 'recvonly' });
      } catch {}
    }

    pc.ontrack = (event) => {
      const track = event.track;
      setRemoteStreams((prev) => {
        const base = event.streams?.[0] || prev[remoteUserId] || new MediaStream();
        if (!base.getTracks().some((t) => t.id === track.id)) {
          base.addTrack(track);
        }
        return { ...prev, [remoteUserId]: new MediaStream(base.getTracks()) };
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'webrtc-ice-candidate',
            toUserId: remoteUserId,
            candidate: event.candidate.toJSON(),
          })
        );
      }
    };

    return pc;
  };

  // Real-Time WebSocket connection for Team Voice/Video stage
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/team-live`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'join-room',
          teamId: team.teamId,
          userId: currentUser.userId,
          username: currentUser.username,
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
          seatNumber: mySeatRef.current,
          micMuted: micMutedRef.current,
          cameraOn: cameraOnRef.current,
        })
      );
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'room-peers') {
          const list = (msg.peers || []) as RemotePeerInfo[];
          setPeersInRoom(list);
          for (const peer of list) {
            if (peer.userId === currentUser.userId) continue;
            if (currentUser.userId < peer.userId) {
              const pc = getOrCreatePeerConnection(peer.userId);
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              ws.send(
                JSON.stringify({
                  type: 'webrtc-offer',
                  toUserId: peer.userId,
                  sdp: { type: offer.type, sdp: offer.sdp },
                })
              );
            }
          }
        } else if (msg.type === 'peer-joined') {
          if (Array.isArray(msg.peers)) setPeersInRoom(msg.peers);
          const peer = msg.peer as RemotePeerInfo | undefined;
          if (peer && peer.userId !== currentUser.userId && currentUser.userId < peer.userId) {
            const pc = getOrCreatePeerConnection(peer.userId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ws.send(
              JSON.stringify({
                type: 'webrtc-offer',
                toUserId: peer.userId,
                sdp: { type: offer.type, sdp: offer.sdp },
              })
            );
          }
        } else if (msg.type === 'media-state') {
          if (Array.isArray(msg.peers)) setPeersInRoom(msg.peers);
        } else if (msg.type === 'peer-left') {
          if (Array.isArray(msg.peers)) setPeersInRoom(msg.peers);
          const leftId = String(msg.userId || '');
          const pc = pcsRef.current.get(leftId);
          if (pc) {
            pc.close();
            pcsRef.current.delete(leftId);
          }
          pendingIceMapRef.current.delete(leftId);
          setRemoteStreams((prev) => {
            const copy = { ...prev };
            delete copy[leftId];
            return copy;
          });
        } else if (msg.type === 'webrtc-offer') {
          const fromId = String(msg.fromUserId || '');
          if (!fromId || !msg.sdp) return;
          const pc = getOrCreatePeerConnection(fromId);
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await flushPeerIce(fromId, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(
            JSON.stringify({
              type: 'webrtc-answer',
              toUserId: fromId,
              sdp: { type: answer.type, sdp: answer.sdp },
            })
          );
        } else if (msg.type === 'webrtc-answer') {
          const fromId = String(msg.fromUserId || '');
          const pc = pcsRef.current.get(fromId);
          if (pc && msg.sdp && pc.signalingState !== 'closed') {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            await flushPeerIce(fromId, pc);
          }
        } else if (msg.type === 'webrtc-ice-candidate') {
          const fromId = String(msg.fromUserId || '');
          const pc = pcsRef.current.get(fromId);
          if (pc && msg.candidate && pc.signalingState !== 'closed') {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
            } else {
              const queue = pendingIceMapRef.current.get(fromId) || [];
              queue.push(msg.candidate);
              pendingIceMapRef.current.set(fromId, queue);
            }
          }
        }
      } catch {
        // ignore packet error
      }
    };

    return () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'leave-room' }));
        }
        ws.close();
      } catch {}
      wsRef.current = null;
      pcsRef.current.forEach((pc) => pc.close());
      pcsRef.current.clear();
      pendingIceMapRef.current.clear();
      stopLocalMedia();
    };
  }, [team.teamId, currentUser.userId]);

  // Trigger renegotiation when mySeat changes so audio/video tracks propagate to peers
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const timer = setTimeout(() => {
      peersInRoom.forEach((peer) => {
        if (peer.userId !== currentUser.userId) {
          getOrCreatePeerConnection(peer.userId);
        }
      });
      renegotiateAllPeers();
    }, 350);
    return () => clearTimeout(timer);
  }, [mySeat]);

  // Leave Room handler (vacates Seat 2..6 if occupied; Owner can leave or End Room)
  const handleLeaveStage = async () => {
    if (mySeat && mySeat >= 2 && mySeat <= 6) {
      await setDoc(
        doc(db, 'teams', team.teamId, 'liveSeats', `seat_${mySeat}`),
        {
          seatNumber: mySeat,
          teamId: team.teamId,
          userId: null,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});
    }
    await deleteDoc(doc(db, 'teams', team.teamId, 'liveViewers', currentUser.userId)).catch(() => {});
    stopLocalMedia();
    onClose();
  };

  // Owner ONLY: End live Voice/Video session completely for the whole Team
  const handleEndLiveRoomForAll = async () => {
    if (!isOwner) return;
    await updateDoc(doc(db, 'teams', team.teamId), {
      liveRoom: {
        active: false,
        mode: team.liveRoom?.mode || 'voice',
        liveCommentsEnabled: true,
      },
      updatedAt: new Date().toISOString(),
    }).catch(() => {});

    // Clear all seats
    await Promise.all(
      SEAT_NUMBERS.map((num) =>
        deleteDoc(doc(db, 'teams', team.teamId, 'liveSeats', `seat_${num}`)).catch(() => {})
      )
    );
    stopLocalMedia();
    onClose();
  };

  // Unseated Audience Member requests an empty Seat (2..10)
  const handleRequestSeat = async (seatNumber: number) => {
    if (seatNumber === 1 || mySeat !== null) return;
    const reqId = `req_${seatNumber}_${currentUser.userId}`;
    const payload: TeamLiveSeatRequest = {
      requestId: reqId,
      teamId: team.teamId,
      seatNumber,
      userId: currentUser.userId,
      username: currentUser.username,
      displayName: currentUser.displayName,
      ...(currentUser.photoURL ? { photoURL: currentUser.photoURL } : {}),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'teams', team.teamId, 'seatRequests', reqId), payload).catch(() => {});
  };

  // Owner Confirms or Cancels a Seat Request (Seats 2..10)
  const handleApproveSeatRequest = async (req: TeamLiveSeatRequest) => {
    if (!isOwner) return;
    const now = new Date().toISOString();
    // Ensure user isn't holding another seat
    const prevSeat = Object.values(seats).find((s) => s.userId === req.userId);
    if (prevSeat && prevSeat.seatNumber !== req.seatNumber && prevSeat.seatNumber >= 2) {
      await setDoc(
        doc(db, 'teams', team.teamId, 'liveSeats', `seat_${prevSeat.seatNumber}`),
        { seatNumber: prevSeat.seatNumber, teamId: team.teamId, userId: null, updatedAt: now }
      ).catch(() => {});
    }

    await setDoc(doc(db, 'teams', team.teamId, 'liveSeats', `seat_${req.seatNumber}`), {
      seatNumber: req.seatNumber,
      teamId: team.teamId,
      userId: req.userId,
      username: req.username,
      displayName: req.displayName,
      ...(req.photoURL ? { photoURL: req.photoURL } : {}),
      micMuted: false,
      cameraOn: isVideoRoom,
      cameraFacing: 'user',
      updatedAt: now,
    });

    await deleteDoc(doc(db, 'teams', team.teamId, 'seatRequests', req.requestId)).catch(() => {});
  };

  const handleDeclineSeatRequest = async (req: TeamLiveSeatRequest) => {
    if (!isOwner) return;
    await deleteDoc(doc(db, 'teams', team.teamId, 'seatRequests', req.requestId)).catch(() => {});
  };

  // Owner directly assigns a participant to Seat 2..6
  const handleOwnerAssignSeat = async (seatNumber: number, target: { userId: string; username: string; displayName: string; photoURL?: string }) => {
    if (!isOwner || seatNumber < 2 || seatNumber > 6) return;
    const now = new Date().toISOString();
    const prevSeat = Object.values(seats).find((s) => s.userId === target.userId);
    if (prevSeat && prevSeat.seatNumber >= 2) {
      await setDoc(doc(db, 'teams', team.teamId, 'liveSeats', `seat_${prevSeat.seatNumber}`), {
        seatNumber: prevSeat.seatNumber,
        teamId: team.teamId,
        userId: null,
        updatedAt: now,
      }).catch(() => {});
    }
    await setDoc(doc(db, 'teams', team.teamId, 'liveSeats', `seat_${seatNumber}`), {
      seatNumber,
      teamId: team.teamId,
      userId: target.userId,
      username: target.username,
      displayName: target.displayName,
      ...(target.photoURL ? { photoURL: target.photoURL } : {}),
      micMuted: false,
      cameraOn: isVideoRoom,
      cameraFacing: 'user',
      updatedAt: now,
    });
    setAssigningSeatNum(null);
  };

  // Owner removes user from Seats 2..10 (or user steps down themselves)
  const handleVacateSeat = async (seatNumber: number) => {
    if (seatNumber === 1) return;
    const occupant = seats[seatNumber];
    if (!isOwner && occupant?.userId !== currentUser.userId) return;
    await setDoc(doc(db, 'teams', team.teamId, 'liveSeats', `seat_${seatNumber}`), {
      seatNumber,
      teamId: team.teamId,
      userId: null,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  };

  // Owner ONLY: Open or Close Live Stage Comments
  const handleToggleLiveComments = async () => {
    if (!isOwner) return;
    await updateDoc(doc(db, 'teams', team.teamId), {
      liveRoom: {
        active: true,
        mode: team.liveRoom?.mode || 'voice',
        liveCommentsEnabled: !liveCommentsEnabled,
        startedBy: team.liveRoom?.startedBy || currentUser.userId,
        startedAt: team.liveRoom?.startedAt || new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  };

  // Live Comment photo picker
  const handleSelectCommentPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingCommentPhoto(true);
    try {
      const res = await compressImage(file, 720, 720, 0.72);
      setCommentPhoto(res.dataUrl);
    } catch {
      // quiet
    } finally {
      setUploadingCommentPhoto(false);
    }
  };

  const handleSendLiveComment = async (e?: React.FormEvent, quickEmoji?: string) => {
    if (e) e.preventDefault();
    if ((!liveCommentsEnabled && !isOwner) || sendingComment) return;
    const txt = quickEmoji ? quickEmoji : commentText.trim();
    if (!txt && !commentPhoto) return;

    setSendingComment(true);
    try {
      const commentId = `lcom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const payload: TeamLiveComment = {
        commentId,
        teamId: team.teamId,
        authorId: currentUser.userId,
        authorUsername: currentUser.username,
        authorDisplayName: currentUser.displayName,
        ...(currentUser.photoURL ? { authorPhotoURL: currentUser.photoURL } : {}),
        text: txt || '📷 Photo',
        ...(commentPhoto && !quickEmoji ? { photoUrl: commentPhoto } : {}),
        ...(quickEmoji ? { emoji: quickEmoji } : {}),
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'teams', team.teamId, 'liveComments', commentId), payload);
      if (!quickEmoji) {
        setCommentText('');
        setCommentPhoto('');
        setShowEmojiTray(false);
      }
    } finally {
      setSendingComment(false);
    }
  };

  // Combine peers + team members eligible to be assigned by Owner onto Seats 2..10
  const assignableParticipants = useMemo(() => {
    const seatedIds = new Set(
      Object.values(seats)
        .map((s) => s.userId)
        .filter(Boolean) as string[]
    );
    const map = new Map<string, { userId: string; username: string; displayName: string; photoURL?: string; inRoom: boolean }>();
    peersInRoom.forEach((p) => {
      if (p.userId !== team.ownerId && !seatedIds.has(p.userId)) {
        map.set(p.userId, { ...p, inRoom: true });
      }
    });
    members.forEach((m) => {
      if (m.userId !== team.ownerId && !seatedIds.has(m.userId) && !map.has(m.userId)) {
        map.set(m.userId, {
          userId: m.userId,
          username: m.username,
          displayName: m.displayName,
          photoURL: m.photoURL,
          inRoom: false,
        });
      }
    });
    return Array.from(map.values());
  }, [peersInRoom, members, seats, team.ownerId]);

  // Seated user IDs so we attach audio sinks strictly for seated speakers
  const seatedUserIds = useMemo(
    () =>
      new Set(
        Object.values(seats)
          .map((s) => s.userId)
          .filter((id): id is string => Boolean(id && id !== currentUser.userId))
      ),
    [seats, currentUser.userId]
  );

  // Union of active Firestore liveViewers + live WebSocket peers + self for accurate +1/-1 live count
  const watchingCount = useMemo(() => {
    const union = new Set<string>(liveViewerIds);
    peersInRoom.forEach((p) => {
      if (p.userId) union.add(p.userId);
    });
    union.add(currentUser.userId);
    return Math.max(1, union.size);
  }, [liveViewerIds, peersInRoom, currentUser.userId]);

  return (
    <div className="fixed inset-0 z-50 bg-[#0d0a1c] text-white flex flex-col">
      {/* Hidden audio sinks strictly for seated speakers (everyone hears seated speakers 1..6 even if camera is OFF) */}
      {Object.entries(remoteStreams).map(([uid, stream]) =>
        seatedUserIds.has(uid) ? <PeerAudioSink key={uid} stream={stream} /> : null
      )}

      {/* Top Live Header */}
      <div className="px-4 py-3 bg-[#16122e] border-b border-purple-900/50 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-rose-600 text-[10px] font-black uppercase tracking-wider">
                LIVE
              </span>
              <h3 className="font-extrabold text-sm truncate">{team.name}</h3>
            </div>
            <p className="text-[11px] text-purple-300/80 flex items-center gap-2">
              <span>{isVideoRoom ? 'Video Chat Stage' : 'Voice Chat Stage'}</span>
              <span>·</span>
              <span>{watchingCount} {t('watchingLiveLabel')}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div
            className="px-2.5 py-2 rounded-xl bg-white/10 border border-white/15 text-xs font-extrabold flex items-center gap-1.5 min-h-[40px]"
            title={`${watchingCount} ${t('watchingLiveLabel')}`}
          >
            <Eye className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{watchingCount}</span>
          </div>

          <button
            type="button"
            onClick={handleLeaveStage}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold flex items-center gap-1.5 min-h-[40px]"
          >
            <X className="w-4 h-4" />
            <span>{t('leaveLiveStage')}</span>
          </button>
          {isOwner && (
            <button
              type="button"
              onClick={handleEndLiveRoomForAll}
              className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold flex items-center gap-1.5 min-h-[40px]"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">End Room</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Scrollable Stage + Live Comments */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 max-w-2xl w-full mx-auto">
        {mediaNotice && (
          <div className="px-4 py-2.5 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-100 text-xs text-center space-y-2">
            <div className="flex items-center justify-center gap-1.5 font-semibold">
              <ShieldAlert className="w-4 h-4 text-amber-300 shrink-0" />
              <span>{mediaNotice}</span>
            </div>
            {mySeat !== null && (
              <button
                type="button"
                onClick={handleRetryMedia}
                disabled={retryingMedia}
                className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-[11px] inline-flex items-center gap-1.5 transition-colors disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${retryingMedia ? 'animate-spin' : ''}`} />
                <span>{retryingMedia ? 'Checking...' : 'Hayyama Camera & Mic Kenni / Retry'}</span>
              </button>
            )}
          </div>
        )}

        {/* Owner Pending Seat Requests Banner (Seats 2..6) */}
        {isOwner && seatRequests.length > 0 && (
          <div className="p-3 rounded-2xl bg-[#1e1842] border border-[#7560DF]/60 space-y-2">
            <p className="text-xs font-extrabold text-[#B09EFC] uppercase tracking-wider">
              Seat Requests ({seatRequests.length})
            </p>
            <div className="space-y-1.5">
              {seatRequests.map((req) => (
                <div
                  key={req.requestId}
                  className="flex items-center justify-between gap-2 p-2 rounded-xl bg-black/30"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <img
                      src={req.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${req.username}`}
                      alt={req.displayName}
                      className="w-7 h-7 rounded-full object-cover shrink-0"
                    />
                    <p className="text-xs truncate">
                      <span className="font-bold">{req.displayName}</span>{' '}
                      <span className="text-purple-300">requests Seat #{req.seatNumber}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleApproveSeatRequest(req)}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Confirm</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeclineSeatRequest(req)}
                      className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-rose-600/40 text-xs font-bold"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 6 Speaker Seats Grid — Strictly 2 Rows x 3 Columns (Row 1: #1–#3, Row 2: #4–#6) */}
        <div className="grid grid-cols-3 gap-2.5">
          {SEAT_NUMBERS.map((num) => {
            const seat = seats[num];
            const isSeat1 = num === 1;
            const occupantId = seat?.userId || null;
            const isMeOnSeat = occupantId === currentUser.userId;
            const peerState = occupantId ? peersInRoom.find((p) => p.userId === occupantId) : undefined;
            const seatCameraOn = isMeOnSeat
              ? cameraOn
              : Boolean(peerState?.cameraOn ?? seat?.cameraOn);
            const seatMicMuted = isMeOnSeat
              ? micMuted
              : Boolean(peerState?.micMuted ?? seat?.micMuted);

            const seatStream = isMeOnSeat
              ? localStream
              : occupantId
              ? remoteStreams[occupantId] || null
              : null;
            const hasVideoTrack = Boolean(seatStream && seatStream.getVideoTracks().length > 0);
            const showSeatVideo = Boolean(occupantId && seatCameraOn && seatStream && hasVideoTrack);

            const myPendingOnThisSeat = seatRequests.some(
              (r) => r.seatNumber === num && r.userId === currentUser.userId
            );

            return (
              <div
                key={num}
                className={`relative aspect-square rounded-2xl overflow-hidden border transition-all flex flex-col items-center justify-center p-2 ${
                  occupantId
                    ? isSeat1
                      ? 'bg-[#211a47] border-amber-400/70'
                      : 'bg-[#1a153a] border-[#7560DF]/60'
                    : 'bg-[#14102c] border-purple-900/40 border-dashed'
                }`}
              >
                {/* Seat Number & Owner Crown Badge */}
                <div className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded-md bg-black/65 backdrop-blur-sm text-[10px] font-extrabold flex items-center gap-1">
                  {isSeat1 && <Crown className="w-2.5 h-2.5 text-amber-400" />}
                  <span>#{num}</span>
                </div>

                {/* Drop Button on Seats 2..6 for Owner (or occupant stepping down) */}
                {occupantId && !isSeat1 && (isOwner || isMeOnSeat) && (
                  <button
                    type="button"
                    onClick={() => handleVacateSeat(num)}
                    className="absolute top-1.5 right-1.5 z-10 p-1 rounded-full bg-black/65 hover:bg-rose-600 text-white transition-colors"
                    title="Leave Seat"
                  >
                    <UserMinus className="w-3 h-3" />
                  </button>
                )}

                {occupantId ? (
                  <>
                    {/* STRICT PER-SEAT CAMERA VIDEO: renders ONLY inside this exact seat frame! */}
                    {showSeatVideo && seatStream ? (
                      <div className="absolute inset-0">
                        <SeatVideoSlot stream={seatStream} muted={isMeOnSeat} />
                      </div>
                    ) : (
                      <div className="relative flex flex-col items-center justify-center">
                        <img
                          src={
                            seat?.photoURL ||
                            `https://api.dicebear.com/7.x/bottts/svg?seed=${seat?.username || num}`
                          }
                          alt={seat?.displayName || `Seat ${num}`}
                          className={`w-12 h-12 rounded-full object-cover ring-2 ${
                            !seatMicMuted ? 'ring-emerald-400' : 'ring-slate-600'
                          }`}
                        />
                      </div>
                    )}

                    {/* Bottom Name + Live Mic Indicator */}
                    <div className="absolute bottom-1.5 left-1.5 right-1.5 z-10 px-2 py-0.5 rounded-lg bg-black/70 backdrop-blur-sm flex items-center justify-between gap-1">
                      <span className="text-[10px] font-bold truncate">
                        {seat?.displayName || 'Speaker'}
                      </span>
                      {seatMicMuted ? (
                        <MicOff className="w-3 h-3 text-rose-400 shrink-0" />
                      ) : (
                        <Mic className="w-3 h-3 text-emerald-400 shrink-0" />
                      )}
                    </div>
                  </>
                ) : isSeat1 ? (
                  <div className="text-center space-y-1">
                    <Crown className="w-5 h-5 text-amber-400/70 mx-auto" />
                    <p className="text-[10px] font-bold text-amber-300/80">Owner Only</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1.5 text-center">
                    {isOwner ? (
                      <button
                        type="button"
                        onClick={() => setAssigningSeatNum(num)}
                        className="px-2.5 py-1.5 rounded-xl bg-[#7560DF]/30 hover:bg-[#7560DF] text-white text-[11px] font-bold flex items-center gap-1 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    ) : mySeat === null ? (
                      <button
                        type="button"
                        disabled={myPendingOnThisSeat}
                        onClick={() => handleRequestSeat(num)}
                        className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-[#7560DF] disabled:opacity-60 text-white text-[11px] font-bold flex items-center gap-1 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{myPendingOnThisSeat ? 'Requested' : t('addUserBtn')}</span>
                      </button>
                    ) : (
                      <span className="text-[10px] text-purple-300/50">Empty</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Active Speaker Controls Bar (Seats 1..6 ONLY) vs Unseated Listener Notice */}
        <div className="p-3 rounded-2xl bg-[#16122e] border border-purple-900/50 flex flex-wrap items-center justify-between gap-2">
          {mySeat !== null ? (
            <>
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>On Seat #{mySeat} · Live audio active</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleMic}
                  className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 min-h-[40px] ${
                    micMuted ? 'bg-rose-600 text-white' : 'bg-white/15 hover:bg-white/25 text-white'
                  }`}
                >
                  {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  <span>{micMuted ? 'Unmute' : 'Mute'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleToggleCamera}
                  className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 min-h-[40px] ${
                    cameraOn ? 'bg-[#7560DF] text-white' : 'bg-white/15 hover:bg-white/25 text-white'
                  }`}
                >
                  {cameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                  <span>{cameraOn ? 'Cam On' : 'Cam Off'}</span>
                </button>

                {cameraOn && (
                  <button
                    type="button"
                    onClick={handleFlipCamera}
                    className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold flex items-center gap-1.5 min-h-[40px]"
                    title={t('switchCamera')}
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>{cameraFacing === 'user' ? 'Front' : 'Back'}</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-purple-200/80 py-1">
              <MicOff className="w-4 h-4 text-slate-400 shrink-0" />
              <span>{t('audienceListening')}</span>
            </div>
          )}
        </div>

        {/* STAGE-ONLY COMMENTS (Text, Photo, Emoji — Never appears inside main Team Chat) */}
        <div className="rounded-3xl bg-[#16122e] border border-purple-900/50 overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-purple-900/40 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-purple-200">
              <MessageCircle className="w-4 h-4 text-[#9E8CF8]" />
              <span>Live Stage Comments ({liveComments.length})</span>
            </div>
            {isOwner && (
              <button
                type="button"
                onClick={handleToggleLiveComments}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1 ${
                  liveCommentsEnabled
                    ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                }`}
              >
                {liveCommentsEnabled ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                <span>{liveCommentsEnabled ? t('liveCommentsClosed') : t('liveCommentsOpen')}</span>
              </button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto p-3 space-y-2">
            {liveComments.length === 0 ? (
              <p className="text-xs text-purple-300/60 text-center py-4">
                No comments in this live session yet. Say hi with text, a photo, or an emoji!
              </p>
            ) : (
              liveComments.map((c) => (
                <div key={c.commentId} className="flex items-start gap-2 text-xs">
                  <img
                    src={c.authorPhotoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${c.authorUsername}`}
                    alt={c.authorDisplayName}
                    className="w-6 h-6 rounded-full object-cover shrink-0 mt-0.5"
                  />
                  <div className="flex-1 min-w-0 bg-white/5 rounded-2xl px-3 py-1.5">
                    <span className="font-bold text-[#B09EFC] mr-1.5">{c.authorDisplayName}</span>
                    {c.emoji ? (
                      <span className="text-lg align-middle">{c.emoji}</span>
                    ) : (
                      <span className="text-white/95 break-words">{c.text}</span>
                    )}
                    {c.photoUrl && (
                      <img
                        src={c.photoUrl}
                        alt="Live comment photo"
                        className="mt-1.5 max-h-36 rounded-xl object-cover"
                      />
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={commentsEndRef} />
          </div>

          {/* Live Comment Input (Open or Owner-only when closed) */}
          {liveCommentsEnabled || isOwner ? (
            <div className="p-2.5 border-t border-purple-900/40 space-y-2 bg-[#120e26]">
              {commentPhoto && (
                <div className="relative inline-block">
                  <img src={commentPhoto} alt="Draft" className="h-14 rounded-xl object-cover border border-purple-700" />
                  <button
                    type="button"
                    onClick={() => setCommentPhoto('')}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center text-[10px]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {showEmojiTray && (
                <div className="flex items-center justify-around py-1.5 px-2 rounded-2xl bg-white/10">
                  {REACTION_EMOJIS_8.map((item) => (
                    <button
                      key={item.emoji}
                      type="button"
                      onClick={() => handleSendLiveComment(undefined, item.emoji)}
                      className="text-xl p-1 hover:scale-125 transition-transform"
                    >
                      {item.emoji}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={(e) => handleSendLiveComment(e)} className="flex items-center gap-1.5">
                <input
                  ref={commentPhotoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleSelectCommentPhoto}
                />
                <button
                  type="button"
                  disabled={uploadingCommentPhoto}
                  onClick={() => commentPhotoInputRef.current?.click()}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-purple-200 shrink-0"
                  title="Attach Photo"
                >
                  {uploadingCommentPhoto ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEmojiTray((v) => !v)}
                  className={`p-2 rounded-full shrink-0 ${
                    showEmojiTray ? 'bg-[#7560DF] text-white' : 'bg-white/10 hover:bg-white/20 text-purple-200'
                  }`}
                  title="Emojis"
                >
                  <Smile className="w-4 h-4" />
                </button>
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Comment inside live room..."
                  className="flex-1 min-w-0 px-3.5 py-2 rounded-full bg-white/10 text-xs text-white placeholder:text-purple-300/60 outline-none focus:ring-2 focus:ring-[#7560DF]"
                />
                <button
                  type="submit"
                  disabled={sendingComment || (!commentText.trim() && !commentPhoto)}
                  className="p-2 rounded-full bg-[#7560DF] hover:bg-[#624ec7] disabled:opacity-40 text-white shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          ) : (
            <div className="p-3 border-t border-purple-900/40 text-center text-xs font-bold text-amber-300 flex items-center justify-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>Comments closed by Team Owner</span>
            </div>
          )}
        </div>
      </div>

      {/* Owner Seat Assignment Modal (for Seat #2..#6) */}
      {isOwner && assigningSeatNum !== null && (
        <div
          onClick={() => setAssigningSeatNum(null)}
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-[#1a153a] border border-purple-800/60 p-4 space-y-3 max-h-[70vh] flex flex-col"
          >
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-[#9E8CF8]" />
                <span>Assign User to Seat #{assigningSeatNum}</span>
              </h4>
              <button
                type="button"
                onClick={() => setAssigningSeatNum(null)}
                className="p-1 rounded-full text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-1.5 flex-1">
              {assignableParticipants.length === 0 ? (
                <p className="text-xs text-purple-300/70 text-center py-6">
                  All other members are either already seated or haven’t joined yet.
                </p>
              ) : (
                assignableParticipants.map((p) => (
                  <button
                    key={p.userId}
                    type="button"
                    onClick={() => handleOwnerAssignSeat(assigningSeatNum, p)}
                    className="w-full p-2.5 rounded-2xl bg-white/5 hover:bg-[#7560DF]/30 flex items-center justify-between gap-2 text-left transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={p.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${p.username}`}
                        alt={p.displayName}
                        className="w-8 h-8 rounded-full object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{p.displayName}</p>
                        <p className="text-[10px] text-purple-300 truncate">@{p.username}</p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/10 shrink-0">
                      {p.inRoom ? 'In Room' : 'Team Member'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
