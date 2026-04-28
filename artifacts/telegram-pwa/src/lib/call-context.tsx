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
import { getSharedAudioContext } from './audio-unlock';

// STUN + TURN configuration. Without TURN, calls fail on most real-world
// networks (mobile data, restrictive Wi-Fi, symmetric NAT, double-NAT).
// We use Metered.ca's free OpenRelay TURN, which exposes both UDP/3478 and
// the firewall-friendly TCP/443 + TLS ports — that combination tunnels out
// of nearly any restrictive network.
const PC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: 4,
};

// Target bitrates that produce noticeably better quality than the browser
// defaults while still being safe for typical mobile bandwidth.
const TARGET_VIDEO_BITRATE_BPS = 1_500_000; // 1.5 Mbps for HD video
const TARGET_AUDIO_BITRATE_BPS = 64_000;   //  64 kbps Opus stereo

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
  // Timer + original document title used by the incoming-call title flash.
  // Tracked on a ref so any code path (socket cleanup, cleanupPC, unmount)
  // can stop the flash without leaking the interval forever.
  const titleFlashTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const originalTitleRef = useRef<string | null>(null);

  const stopTitleFlash = useCallback(() => {
    if (titleFlashTimerRef.current) {
      clearInterval(titleFlashTimerRef.current);
      titleFlashTimerRef.current = null;
    }
    if (originalTitleRef.current !== null) {
      document.title = originalTitleRef.current;
      originalTitleRef.current = null;
    }
  }, []);

  useEffect(() => { stateRef.current = callState; }, [callState]);

  // Whenever the call leaves the `incoming` state (accepted, rejected, ended)
  // immediately stop flashing the tab title.
  useEffect(() => {
    if (callState.status !== 'incoming') stopTitleFlash();
  }, [callState.status, stopTitleFlash]);

  // Ask for OS notification permission once a user is authenticated. This
  // lets the browser surface incoming calls as system alerts even when the
  // app tab is in the background or the screen is asleep. We only prompt
  // once per session — if the user blocked it earlier we never bug them
  // again.
  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [user]);

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
      // Surface state transitions in the dev console so it's easy to tell a
      // failed call (network/NAT issue) apart from a connected-but-silent one.
      // eslint-disable-next-line no-console
      console.info('[call] pc.connectionState =', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        cleanupPC();
      }
    };

    pc.oniceconnectionstatechange = () => {
      // eslint-disable-next-line no-console
      console.info('[call] pc.iceConnectionState =', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        // Try a soft-restart of ICE before giving up.
        try { pc.restartIce(); } catch { /* old browsers */ }
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
    stopTitleFlash();
    setCallState(IDLE);
  }, [stopTitleFlash]);

  // ── Get user media ─────────────────────────────────────────────────────────
  // Audio: voice-grade Opus with echo cancellation, noise suppression and AGC,
  // sampled at 48 kHz so we keep the natural clarity that Opus is capable of.
  // Video: prefer 1280x720 @ 30 fps but let the browser pick a lower fallback
  // when the camera can't deliver that on a low-end device.
  const getMedia = async (video: boolean) => {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48_000,
        channelCount: 1,
      } as MediaTrackConstraints,
      video: video
        ? {
            facingMode: 'user',
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
          }
        : false,
    });
  };

  // ── Bump up encoder bitrates after the connection is set up ───────────────
  // Browsers cap streams at very modest defaults (≈ 300 kbps video,
  // ≈ 32 kbps audio) which is why most WebRTC apps sound and look bad out of
  // the box. We raise both with `setParameters` once the senders exist.
  const applySenderBitrates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    for (const sender of pc.getSenders()) {
      if (!sender.track) continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          (params as any).encodings = [{}];
        }
        const max =
          sender.track.kind === 'video'
            ? TARGET_VIDEO_BITRATE_BPS
            : TARGET_AUDIO_BITRATE_BPS;
        params.encodings.forEach((enc) => {
          enc.maxBitrate = max;
          if (sender.track?.kind === 'video') {
            (enc as any).maxFramerate = 30;
          }
        });
        await sender.setParameters(params);
      } catch {
        /* setParameters not supported on this browser — skip */
      }
    }
  }, []);

  // Patch the SDP to enable Opus stereo + FEC + a higher target bitrate.
  // `RTCRtpSender.setParameters` covers the encoder, but the Opus-specific
  // `fmtp` line in the SDP is what tells the *decoder* to expect those
  // higher quality features, so we set both.
  const tuneOpusInSdp = (sdp: string): string => {
    const lines = sdp.split('\r\n');
    const opusLine = lines.find((l) => /a=rtpmap:\d+ opus\/48000/i.test(l));
    if (!opusLine) return sdp;
    const match = opusLine.match(/a=rtpmap:(\d+) /);
    if (!match) return sdp;
    const pt = match[1];
    const fmtpIdx = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `));
    const params = [
      'minptime=10',
      'useinbandfec=1',
      'usedtx=0',
      'stereo=1',
      'sprop-stereo=1',
      `maxaveragebitrate=${TARGET_AUDIO_BITRATE_BPS}`,
    ].join(';');
    if (fmtpIdx === -1) {
      const opusIdx = lines.indexOf(opusLine);
      lines.splice(opusIdx + 1, 0, `a=fmtp:${pt} ${params}`);
    } else {
      lines[fmtpIdx] = `a=fmtp:${pt} ${params}`;
    }
    return lines.join('\r\n');
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

    const rawOffer = await pc.createOffer();
    const tunedOffer = { ...rawOffer, sdp: tuneOpusInSdp(rawOffer.sdp ?? '') };
    await pc.setLocalDescription(tunedOffer);
    await applySenderBitrates();

    setCallState({
      status: 'outgoing', conversationId, peerId, peerName, peerAvatar, isVideo,
      localStream, isMuted: false, isCameraOff: false, isScreenSharing: false, isMinimized: false, isSpeakerOn: true,
    });

    socket.emit('call_offer', {
      targetUserId: peerId, offer: tunedOffer, fromName: user.displayName,
      fromAvatar: (user as any).avatar, conversationId, isVideo,
    });
  }, [socket, user, createPC, applySenderBitrates]);

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

    const rawAnswer = await pc.createAnswer();
    const tunedAnswer = { ...rawAnswer, sdp: tuneOpusInSdp(rawAnswer.sdp ?? '') };
    await pc.setLocalDescription(tunedAnswer);
    await applySenderBitrates();

    setCallState(prev => ({ ...prev, localStream, status: 'active', startedAt: Date.now(), isMinimized: false, isSpeakerOn: prev.isSpeakerOn ?? true }));
    socket.emit('call_answer', { targetUserId: state.peerId, answer: tunedAnswer });
  }, [socket, createPC, applySenderBitrates]);

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
  //  - otherwise lower the <audio> element's volume; only fall back to a
  //    Web Audio low-pass filter when the user actively switches to earpiece,
  //    so the default speaker mode keeps the cleanest possible audio path.
  const applySpeakerMode = useCallback((speakerOn: boolean) => {
    const el = remoteAudioRef.current;
    if (!el) return;

    const anyEl = el as any;
    if (typeof anyEl.setSinkId === 'function') {
      anyEl.setSinkId(speakerOn ? 'default' : 'communications')
        .then(() => { el.volume = 1; })
        .catch(() => { /* fall through to Web Audio simulation */ });
    }

    if (speakerOn) {
      // Speaker → make sure the <audio> element is the active sink and tear
      // down any earpiece Web Audio graph. This guarantees we never end up
      // in a state where audio is silently routed nowhere.
      try { audioSourceRef.current?.disconnect(); } catch {}
      try { audioFilterRef.current?.disconnect(); } catch {}
      try { audioGainRef.current?.disconnect(); } catch {}
      audioSourceRef.current = null;
      audioFilterRef.current = null;
      audioGainRef.current = null;
      el.muted = false;
      el.volume = 1;
      return;
    }

    // Earpiece — build the Web Audio graph lazily on first switch.
    if (!audioCtxRef.current && el.srcObject) {
      try {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext = new AudioCtx();
        const source = ctx.createMediaStreamSource(el.srcObject as MediaStream);
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1500;
        source.connect(filter).connect(gain).connect(ctx.destination);
        audioCtxRef.current = ctx;
        audioSourceRef.current = source;
        audioGainRef.current = gain;
        audioFilterRef.current = filter;
        el.muted = true;
      } catch {
        // Web Audio failed → fall back to plain <audio> at low volume so the
        // user still hears the call (just not "earpiece-coloured").
        el.muted = false;
        el.volume = 0.18;
        return;
      }
    } else if (audioCtxRef.current && el.srcObject && !audioSourceRef.current) {
      try {
        const ctx = audioCtxRef.current;
        const source = ctx.createMediaStreamSource(el.srcObject as MediaStream);
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1500;
        source.connect(filter).connect(gain).connect(ctx.destination);
        audioSourceRef.current = source;
        audioGainRef.current = gain;
        audioFilterRef.current = filter;
        el.muted = true;
      } catch {
        // Same fallback — make sure the user keeps hearing audio.
        el.muted = false;
        el.volume = 0.18;
        return;
      }
    }

    if (audioGainRef.current && audioFilterRef.current) {
      audioGainRef.current.gain.value = 0.18;
      audioFilterRef.current.frequency.value = 1500;
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
      // Pre-warm the shared AudioContext so the ringtone effect can start
      // playing immediately without being blocked by autoplay policy.
      try { getSharedAudioContext()?.resume().catch(() => {}); } catch {}

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
        isSpeakerOn: true,
      });

      // OS-level notification + tab-title flash so the user notices the call
      // even if the app is in another tab or the screen is off.
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          const n = new Notification(
            data.isVideo ? 'Appel vidéo entrant' : 'Appel audio entrant',
            {
              body: `${data.fromName} vous appelle`,
              icon: data.fromAvatar || '/icon-notification.png',
              tag: `call-${data.fromUserId}`,
              requireInteraction: true,
              silent: false,
            } as NotificationOptions,
          );
          n.onclick = () => { window.focus(); n.close(); };
        }
      } catch { /* notifications unavailable */ }

      // Flash the tab title so the user notices an incoming call even when
      // the page is in the background. The interval is tracked on a ref so
      // it can always be cleared — by the status-change effect, by
      // cleanupPC, or by the socket-listener cleanup on unmount.
      stopTitleFlash();
      originalTitleRef.current = document.title;
      const flashLabels = [`Appel de ${data.fromName}`, document.title];
      let flashIdx = 0;
      titleFlashTimerRef.current = setInterval(() => {
        document.title = flashLabels[flashIdx % 2];
        flashIdx += 1;
      }, 1000);
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
      // Final safety net — never leave a dangling title-flash interval if
      // the socket reconnects mid-ring or the provider unmounts.
      stopTitleFlash();
    };
  }, [socket, cleanupPC, stopTitleFlash]);

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
