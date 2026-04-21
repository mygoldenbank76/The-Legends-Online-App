/**
 * WebRTC call context — manages peer connections, signaling via Socket.io,
 * and exposes call state + actions to the rest of the app.
 *
 * Supports audio + optional video calls, screen sharing, and minimize-to-banner mode.
 * STUN: Google public servers (no TURN needed for most LAN/direct connections).
 */
import {
  createContext, useContext, useRef, useState,
  useEffect, useCallback, ReactNode,
} from 'react';
import { useSocket } from './socket-context';
import { useAuth } from './auth-context';

const PC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

export type CallStatus =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'active'
  | 'ended';

export type CallState = {
  status: CallStatus;
  conversationId?: number;
  peerId?: number;
  peerName?: string;
  peerAvatar?: string;
  isVideo: boolean;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  isMinimized: boolean;
  isSpeakerOn: boolean;
  startedAt?: number;
  incomingOffer?: RTCSessionDescriptionInit;
};

type CallContextType = {
  callState: CallState;
  initiateCall: (params: { peerId: number; peerName: string; peerAvatar?: string; conversationId: number; isVideo: boolean }) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
  toggleSpeaker: () => void;
  minimize: () => void;
  maximize: () => void;
};

const CallContext = createContext<CallContextType | undefined>(undefined);

const IDLE: CallState = {
  status: 'idle', isVideo: false, isMuted: false, isCameraOff: false,
  isScreenSharing: false, isMinimized: false, isSpeakerOn: true,
};

export function CallProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocket();
  const { user } = useAuth();
  const [callState, setCallState] = useState<CallState>(IDLE);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const stateRef = useRef<CallState>(IDLE);
  // Reference to the "real" camera stream so we can restore it after screen share ends
  const cameraStreamRef = useRef<MediaStream | null>(null);
  // Always-mounted hidden audio element — primary remote audio output
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  // Web Audio nodes for speaker/earpiece simulation (low-pass filter + gain)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const audioFilterRef = useRef<BiquadFilterNode | null>(null);

  useEffect(() => { stateRef.current = callState; }, [callState]);

  // ── Attach remote stream to the hidden <audio> element + Web Audio graph ──
  const attachRemoteAudio = useCallback((stream: MediaStream) => {
    const el = remoteAudioRef.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    el.muted = false;
    el.volume = 1;
    el.play().catch(() => {});
  }, []);

  // ── Pre-warm audio playback inside a user gesture (so play() isn't blocked
  //    later when the remote stream actually arrives via ontrack). ──
  const unlockAudioPlayback = useCallback(() => {
    const el = remoteAudioRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1;
    // Calling play() with no srcObject is a no-op but consumes the gesture
    el.play().catch(() => {});
  }, []);

  // ── Create peer connection ─────────────────────────────────────────────────
  const createPC = useCallback((peerId: number) => {
    const pc = new RTCPeerConnection(PC_CONFIG);
    pcRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && socket) {
        socket.emit('call_ice_candidate', { targetUserId: peerId, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      const [remoteStream] = e.streams;
      // Pipe remote audio into our hidden <audio> element immediately so
      // playback starts without waiting for React to re-render.
      attachRemoteAudio(remoteStream);
      setCallState(prev => ({ ...prev, remoteStream, status: 'active', startedAt: prev.startedAt ?? Date.now() }));
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        cleanupPC();
      }
    };

    return pc;
  }, [socket]);

  const cleanupPC = useCallback(() => {
    const pc = pcRef.current;
    if (pc) { pc.close(); pcRef.current = null; }
    pendingCandidates.current = [];
    stateRef.current.localStream?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current = null;
    // Detach remote audio + tear down Web Audio graph
    const el = remoteAudioRef.current;
    if (el) { try { el.pause(); } catch {} el.srcObject = null; }
    try { audioSourceRef.current?.disconnect(); } catch {}
    try { audioFilterRef.current?.disconnect(); } catch {}
    try { audioGainRef.current?.disconnect(); } catch {}
    audioSourceRef.current = null;
    audioFilterRef.current = null;
    audioGainRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setCallState(IDLE);
  }, []);

  // ── Get user media ─────────────────────────────────────────────────────────
  const getMedia = async (video: boolean) => {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { facingMode: 'user' } : false,
    });
  };

  // ── Initiate outgoing call ─────────────────────────────────────────────────
  const initiateCall = useCallback(async ({ peerId, peerName, peerAvatar, conversationId, isVideo }: {
    peerId: number; peerName: string; peerAvatar?: string; conversationId: number; isVideo: boolean;
  }) => {
    if (!socket || !user) return;
    if (stateRef.current.status !== 'idle') return;

    let localStream: MediaStream;
    try {
      localStream = await getMedia(isVideo);
    } catch {
      alert('Accès au micro refusé');
      return;
    }
    cameraStreamRef.current = localStream;
    // Unlock audio playback NOW while still inside the user gesture
    unlockAudioPlayback();

    const pc = createPC(peerId);
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    setCallState({
      status: 'outgoing', conversationId, peerId, peerName, peerAvatar, isVideo,
      localStream, isMuted: false, isCameraOff: false, isScreenSharing: false, isMinimized: false, isSpeakerOn: true,
    });

    socket.emit('call_offer', {
      targetUserId: peerId, offer, fromName: user.displayName,
      fromAvatar: (user as any).avatar, conversationId, isVideo,
    });
  }, [socket, user, createPC]);

  // ── Accept incoming call ───────────────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    const state = stateRef.current;
    if (!socket || state.status !== 'incoming' || !state.peerId || !state.incomingOffer) return;

    let localStream: MediaStream;
    try {
      localStream = await getMedia(state.isVideo);
    } catch {
      alert('Accès au micro refusé');
      return;
    }
    cameraStreamRef.current = localStream;
    // Unlock audio playback NOW while still inside the user gesture (the Accept tap)
    unlockAudioPlayback();

    const pc = createPC(state.peerId);
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    await pc.setRemoteDescription(new RTCSessionDescription(state.incomingOffer));
    for (const c of pendingCandidates.current) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
    pendingCandidates.current = [];

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    setCallState(prev => ({ ...prev, localStream, status: 'active', startedAt: Date.now(), isMinimized: false, isSpeakerOn: prev.isSpeakerOn ?? true }));
    socket.emit('call_answer', { targetUserId: state.peerId, answer });
  }, [socket, createPC]);

  // ── Reject incoming call ───────────────────────────────────────────────────
  const rejectCall = useCallback(() => {
    const state = stateRef.current;
    if (!socket || state.status !== 'incoming' || !state.peerId) return;
    socket.emit('call_reject', { targetUserId: state.peerId });
    cleanupPC();
  }, [socket, cleanupPC]);

  // ── End call ──────────────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    const state = stateRef.current;
    if (state.peerId && socket) {
      socket.emit('call_end', { targetUserId: state.peerId });
    }
    cleanupPC();
  }, [socket, cleanupPC]);

  // ── Toggle mute ────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const stream = stateRef.current.localStream;
    if (!stream) return;
    const willMute = !stateRef.current.isMuted;
    stream.getAudioTracks().forEach(t => { t.enabled = !willMute; });
    setCallState(prev => ({ ...prev, isMuted: willMute }));
  }, []);

  // ── Toggle camera ──────────────────────────────────────────────────────────
  const toggleCamera = useCallback(() => {
    const stream = stateRef.current.localStream;
    if (!stream) return;
    const willOff = !stateRef.current.isCameraOff;
    stream.getVideoTracks().forEach(t => { t.enabled = !willOff; });
    setCallState(prev => ({ ...prev, isCameraOff: willOff }));
  }, []);

  // ── Screen share ───────────────────────────────────────────────────────────
  const stopScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    const cameraStream = cameraStreamRef.current;
    if (!pc || !cameraStream) {
      setCallState(prev => ({ ...prev, isScreenSharing: false }));
      return;
    }
    // Restore camera video track
    const cameraTrack = cameraStream.getVideoTracks()[0];
    if (cameraTrack) {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(cameraTrack).catch(() => {});
      }
    }
    setCallState(prev => ({ ...prev, isScreenSharing: false, localStream: cameraStream }));
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (stateRef.current.status !== 'active') return;

    if (stateRef.current.isScreenSharing) {
      await stopScreenShare();
      return;
    }

    let screenStream: MediaStream;
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
    } catch {
      return; // User cancelled or permission denied
    }

    const screenTrack = screenStream.getVideoTracks()[0];
    const pc = pcRef.current;
    if (!pc || !screenTrack) { screenStream.getTracks().forEach(t => t.stop()); return; }

    // Replace video sender
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) {
      await sender.replaceTrack(screenTrack).catch(() => {});
    } else {
      pc.addTrack(screenTrack, screenStream);
    }

    // Create a combined stream with screen video + mic audio
    const micTracks = cameraStreamRef.current?.getAudioTracks() ?? [];
    const displayStream = new MediaStream([screenTrack, ...micTracks]);

    setCallState(prev => ({ ...prev, isScreenSharing: true, localStream: displayStream }));

    // When user stops via browser "Stop sharing" button
    screenTrack.onended = () => { stopScreenShare(); };
  }, [stopScreenShare]);

  // ── Toggle speaker ─────────────────────────────────────────────────────────
  // True earpiece routing isn't possible on most browsers, so we simulate:
  //  - try setSinkId('communications') when supported (Android Chrome, etc.)
  //  - otherwise apply Web Audio gain (0.12) + low-pass filter (1500Hz)
  //    which sounds noticeably "tinny / muffled" like a phone earpiece.
  const applySpeakerMode = useCallback((speakerOn: boolean) => {
    const el = remoteAudioRef.current;
    if (!el) return;

    const anyEl = el as any;
    if (typeof anyEl.setSinkId === 'function') {
      anyEl.setSinkId(speakerOn ? 'default' : 'communications')
        .then(() => { el.volume = 1; })
        .catch(() => { /* fall through to Web Audio simulation */ });
    }

    // Set up Web Audio graph once (lazy)
    if (!audioCtxRef.current && el.srcObject) {
      try {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext = new AudioCtx();
        const source = ctx.createMediaStreamSource(el.srcObject as MediaStream);
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 22000; // bypass by default
        source.connect(filter).connect(gain).connect(ctx.destination);
        audioCtxRef.current = ctx;
        audioSourceRef.current = source;
        audioGainRef.current = gain;
        audioFilterRef.current = filter;
        // Mute the <audio> element so we don't get double playback
        el.muted = true;
      } catch {
        // Web Audio failed — fall back to volume only
        el.volume = speakerOn ? 1 : 0.12;
        return;
      }
    }

    if (audioGainRef.current && audioFilterRef.current) {
      audioGainRef.current.gain.value = speakerOn ? 1.0 : 0.18;
      audioFilterRef.current.frequency.value = speakerOn ? 22000 : 1500;
    }
  }, []);

  const toggleSpeaker = useCallback(() => {
    setCallState(prev => {
      const next = !prev.isSpeakerOn;
      // Apply on next tick so the audio element ref is current
      setTimeout(() => applySpeakerMode(next), 0);
      return { ...prev, isSpeakerOn: next };
    });
  }, [applySpeakerMode]);

  // ── Minimize / maximize ────────────────────────────────────────────────────
  const minimize = useCallback(() => {
    if (stateRef.current.status !== 'idle') {
      setCallState(prev => ({ ...prev, isMinimized: true }));
    }
  }, []);

  const maximize = useCallback(() => {
    setCallState(prev => ({ ...prev, isMinimized: false }));
  }, []);

  // ── Service worker message listener (for notif action buttons) ───────────
  useEffect(() => {
    const onSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ACCEPT_CALL') {
        acceptCall();
      } else if (event.data?.type === 'REJECT_CALL') {
        rejectCall();
      }
    };
    navigator.serviceWorker?.addEventListener('message', onSWMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onSWMessage);
  }, [acceptCall, rejectCall]);

  // ── Socket event listeners ─────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onOffer = async (data: {
      fromUserId: number; fromName: string; fromAvatar?: string;
      offer: RTCSessionDescriptionInit; conversationId: number; isVideo: boolean;
    }) => {
      if (stateRef.current.status !== 'idle') {
        socket.emit('call_reject', { targetUserId: data.fromUserId });
        return;
      }
      setCallState({
        status: 'incoming',
        conversationId: data.conversationId,
        peerId: data.fromUserId,
        peerName: data.fromName,
        peerAvatar: data.fromAvatar,
        isVideo: data.isVideo,
        incomingOffer: data.offer,
        isMuted: false,
        isCameraOff: false,
        isScreenSharing: false,
        isMinimized: false,
      });
    };

    const onAnswer = async ({ answer }: { fromUserId: number; answer: RTCSessionDescriptionInit }) => {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      for (const c of pendingCandidates.current) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      pendingCandidates.current = [];
      setCallState(prev => ({ ...prev, status: 'active', startedAt: Date.now() }));
    };

    const onIce = async ({ candidate }: { fromUserId: number; candidate: RTCIceCandidateInit }) => {
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingCandidates.current.push(candidate);
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    };

    const onEnded = () => cleanupPC();
    const onRejected = () => cleanupPC();

    socket.on('call_offer', onOffer);
    socket.on('call_answer', onAnswer);
    socket.on('call_ice_candidate', onIce);
    socket.on('call_ended', onEnded);
    socket.on('call_rejected', onRejected);

    return () => {
      socket.off('call_offer', onOffer);
      socket.off('call_answer', onAnswer);
      socket.off('call_ice_candidate', onIce);
      socket.off('call_ended', onEnded);
      socket.off('call_rejected', onRejected);
    };
  }, [socket, cleanupPC]);

  return (
    <CallContext.Provider value={{
      callState, initiateCall, acceptCall, rejectCall, endCall,
      toggleMute, toggleCamera, toggleScreenShare, toggleSpeaker, minimize, maximize,
    }}>
      {children}
      {/* Always-mounted hidden remote audio element. Lives outside the CallModal
          so playback isn't disrupted by modal mount/unmount, and play() can be
          called inside user-gesture handlers (initiateCall, acceptCall) to
          satisfy autoplay policies on iOS Safari and similar. */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ display: 'none' }}
      />
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within a CallProvider');
  return ctx;
}
