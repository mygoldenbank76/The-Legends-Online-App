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

  useEffect(() => { stateRef.current = callState; }, [callState]);

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
  const toggleSpeaker = useCallback(() => {
    setCallState(prev => ({ ...prev, isSpeakerOn: !prev.isSpeakerOn }));
  }, []);

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
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within a CallProvider');
  return ctx;
}
