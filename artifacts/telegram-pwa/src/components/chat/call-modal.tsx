/**
 * CallModal + CallBanner
 *
 * CallModal   — full-screen overlay for incoming / outgoing / active calls.
 * CallBanner  — slim fixed bar (like Telegram/WhatsApp) shown when the call
 *               is minimized, so the user can return to the call from any page.
 *
 * Both are exported; App.tsx renders both at the same time (only one visible).
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, PhoneOff, PhoneIncoming, Mic, MicOff,
  Video, VideoOff, Monitor, MonitorOff, ChevronDown,
  ChevronUp, ScreenShare, ScreenShareOff, Volume2, VolumeX,
} from 'lucide-react';
import { useCall } from '@/lib/call-context';

function formatCallDuration(startedAt?: number): string {
  if (!startedAt) return '0:00';
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ── Mini call banner (always-visible when minimized) ─────────────────────────
export function CallBanner() {
  const { callState, maximize, endCall } = useCall();
  const { status, peerName, peerAvatar, startedAt, isMinimized, isVideo, isScreenSharing } = callState;
  const [duration, setDuration] = useState('0:00');

  useEffect(() => {
    if (status !== 'active' || !startedAt) return;
    setDuration(formatCallDuration(startedAt));
    const id = setInterval(() => setDuration(formatCallDuration(startedAt)), 1000);
    return () => clearInterval(id);
  }, [status, startedAt]);

  const visible = isMinimized && status !== 'idle';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="call-banner"
          initial={{ y: -56, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -56, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed left-0 right-0 z-[100] flex items-center gap-3 px-3"
          style={{
            top: '56px', // below the h-14 app header
            height: '48px',
            background: 'linear-gradient(90deg, hsl(263 60% 12%), hsl(263 40% 9%))',
            borderBottom: '1px solid hsl(263 60% 30% / 0.4)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {/* Pulsing green dot */}
          <div className="relative flex-shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
            <div className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-60" />
          </div>

          {/* Avatar */}
          <div className="w-7 h-7 rounded-full gradient-primary-soft flex-shrink-0 overflow-hidden border border-primary/40">
            {peerAvatar
              ? <img src={peerAvatar} alt={peerName} className="w-full h-full object-cover" />
              : <span className="w-full h-full flex items-center justify-center text-xs font-bold text-primary">
                  {peerName?.charAt(0).toUpperCase()}
                </span>
            }
          </div>

          {/* Info — tap to expand */}
          <button className="flex-1 min-w-0 text-left" onClick={maximize}>
            <div className="flex items-center gap-2">
              <span className="text-white text-sm font-semibold truncate">{peerName}</span>
              {isScreenSharing && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 flex-shrink-0">
                  Partage
                </span>
              )}
              {isVideo && !isScreenSharing && (
                <span className="text-[10px] px-1.5 py-0.5 rounded gradient-primary-soft border border-primary/40 text-primary flex-shrink-0">
                  Vidéo
                </span>
              )}
            </div>
            <p className="text-[11px] text-green-400 font-mono leading-none mt-0.5">
              {status === 'active' ? duration : status === 'outgoing' ? 'Appel en cours…' : 'Appel entrant'}
            </p>
          </button>

          {/* Return to call icon */}
          <button
            onClick={maximize}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors flex-shrink-0"
            title="Revenir à l'appel"
          >
            <ChevronUp className="w-4 h-4 text-white" />
          </button>

          {/* End call button */}
          <button
            onClick={endCall}
            className="w-8 h-8 rounded-full gradient-danger glow-danger flex items-center justify-center flex-shrink-0 border border-white/15 transition-[filter] hover:brightness-110 active:brightness-95"
            title="Terminer l'appel"
          >
            <PhoneOff className="w-4 h-4 text-white drop-shadow" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Full-screen call modal ────────────────────────────────────────────────────
export function CallModal() {
  const {
    callState, acceptCall, rejectCall, endCall,
    toggleMute, toggleCamera, toggleScreenShare, toggleSpeaker, minimize,
  } = useCall();
  const {
    status, peerName, peerAvatar, isVideo, localStream, remoteStream,
    isMuted, isCameraOff, isScreenSharing, isMinimized, isSpeakerOn, startedAt,
  } = callState;

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState('0:00');
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // True video call mode = active + video + remote stream → fullscreen WhatsApp-style UI
  const isFullscreenVideo = status === 'active' && isVideo && !!remoteStream;

  // Auto-hide controls after 4s during fullscreen video calls
  const scheduleHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 4000);
  };

  useEffect(() => {
    if (!isFullscreenVideo) {
      setControlsVisible(true);
      if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
      return;
    }
    setControlsVisible(true);
    scheduleHide();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullscreenVideo]);

  const toggleControls = () => {
    if (!isFullscreenVideo) return;
    if (controlsVisible) {
      setControlsVisible(false);
      if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    } else {
      setControlsVisible(true);
      scheduleHide();
    }
  };

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, isVideo]);

  useEffect(() => {
    if (status !== 'active' || !startedAt) return;
    setDuration(formatCallDuration(startedAt));
    const id = setInterval(() => setDuration(formatCallDuration(startedAt)), 1000);
    return () => clearInterval(id);
  }, [status, startedAt]);

  // ── Ringtone (incoming) + dial tone (outgoing) ─────────────────────────────
  // Generated with Web Audio API so we don't need an audio file.
  useEffect(() => {
    if (status !== 'incoming' && status !== 'outgoing') return;

    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx: AudioContext = new AudioCtx();
    let stopped = false;
    const oscillators: OscillatorNode[] = [];
    const gains: GainNode[] = [];

    function playPattern() {
      if (stopped || ctx.state === 'closed') return;
      const now = ctx.currentTime;

      if (status === 'incoming') {
        // Two-tone ring (440Hz / 480Hz, 1s on / 2s off)
        [440, 480].forEach((freq) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = freq;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
          gain.gain.setValueAtTime(0.15, now + 0.95);
          gain.gain.linearRampToValueAtTime(0, now + 1);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 1);
          oscillators.push(osc);
          gains.push(gain);
        });
        // Vibrate phone
        if ('vibrate' in navigator) navigator.vibrate([400, 200, 400]);
      } else {
        // Outgoing dial tone — single beep, 350Hz, 1s on / 2s off
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 350;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
        gain.gain.setValueAtTime(0.08, now + 0.95);
        gain.gain.linearRampToValueAtTime(0, now + 1);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1);
        oscillators.push(osc);
        gains.push(gain);
      }
    }

    // Resume audio context if suspended (autoplay policy)
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    playPattern();
    const intervalId = setInterval(playPattern, 3000);

    return () => {
      stopped = true;
      clearInterval(intervalId);
      oscillators.forEach(o => { try { o.stop(); o.disconnect(); } catch {} });
      gains.forEach(g => { try { g.disconnect(); } catch {} });
      if ('vibrate' in navigator) navigator.vibrate(0);
      ctx.close().catch(() => {});
    };
  }, [status]);

  // Show full-screen modal when not minimized and not idle
  const visible = !isMinimized && status !== 'idle';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="call-modal"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          onClick={toggleControls}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-between select-none"
          style={{
            background: isFullscreenVideo
              ? '#000'
              : 'linear-gradient(135deg, hsl(263 60% 10%), hsl(263 40% 5%))',
          }}
        >
          {/* Remote video — full screen background when active video call */}
          {isFullscreenVideo && (
            <video
              ref={remoteVideoRef}
              autoPlay playsInline
              className="absolute inset-0 w-full h-full object-cover bg-black"
              style={{ zIndex: 0 }}
            />
          )}

          {/* Animated background rings (only when no fullscreen video) */}
          {!isFullscreenVideo && (
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {[1, 2, 3].map(i => (
                <motion.div
                  key={i}
                  className="absolute rounded-full border border-primary/20"
                  style={{ inset: `${(i - 1) * 15}%` }}
                  animate={{ scale: [1, 1.05, 1], opacity: [0.3, 0.1, 0.3] }}
                  transition={{ duration: 3, repeat: Infinity, delay: i * 0.6, ease: 'easeInOut' }}
                />
              ))}
            </div>
          )}

          {/* Top bar: minimize + name (WhatsApp style during fullscreen video) */}
          <AnimatePresence>
            {(status === 'active' || status === 'outgoing') && (controlsVisible || !isFullscreenVideo) && (
              <motion.div
                key="top-bar"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
                className="absolute top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 pt-4 pb-6"
                style={isFullscreenVideo ? {
                  background: 'linear-gradient(180deg, rgba(0,0,0,0.6), transparent)',
                } : undefined}
                onClick={(e) => { e.stopPropagation(); }}
              >
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={(e) => { e.stopPropagation(); minimize(); }}
                  className="w-10 h-10 rounded-full bg-black/40 backdrop-blur flex items-center justify-center flex-shrink-0"
                  title="Réduire"
                >
                  <ChevronDown className="w-5 h-5 text-white" />
                </motion.button>
                {isFullscreenVideo && (
                  <div className="flex-1 text-center">
                    <p className="text-white font-semibold text-base leading-tight truncate">{peerName}</p>
                    <p className="text-white/70 text-xs font-mono leading-tight">{duration}</p>
                  </div>
                )}
                {isFullscreenVideo && <div className="w-10 flex-shrink-0" />}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main content (only when NOT in fullscreen video mode) */}
          {!isFullscreenVideo && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 pt-16 relative z-10 w-full">
              {/* Peer avatar */}
              <motion.div
                animate={status === 'incoming' ? { scale: [1, 1.08, 1] } : {}}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="relative"
              >
                <div
                  className="w-28 h-28 rounded-full gradient-primary-soft border-4 border-primary/50 flex items-center justify-center overflow-hidden shadow-2xl"
                  style={{ boxShadow: '0 14px 38px -10px hsl(263 90% 65% / .55), 0 0 30px hsl(280 88% 60% / .25)' }}
                >
                  {peerAvatar
                    ? <img src={peerAvatar} alt={peerName} className="w-full h-full object-cover" />
                    : <span className="text-4xl font-bold text-white">{peerName?.charAt(0).toUpperCase()}</span>
                  }
                </div>
                {status === 'active' && (
                  <motion.div
                    className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-green-500 border-2 border-background flex items-center justify-center"
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                  >
                    <Phone className="w-3.5 h-3.5 text-white" />
                  </motion.div>
                )}
              </motion.div>

              <div className="text-center relative z-10">
                <h2 className="text-2xl font-bold text-white">{peerName}</h2>
                <p className="text-sm text-white/60 mt-1">
                  {status === 'outgoing' && 'Appel en cours…'}
                  {status === 'incoming' && (isVideo ? 'Appel vidéo entrant' : 'Appel audio entrant')}
                  {status === 'active' && (
                    <span className="font-mono text-green-400">{duration}</span>
                  )}
                </p>
                {isScreenSharing && (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs text-blue-300 bg-blue-500/20 border border-blue-500/30 rounded-full px-2 py-0.5">
                    <Monitor className="w-3 h-3" />
                    Partage d'écran actif
                  </span>
                )}
              </div>

              {/* Outgoing: animated dots */}
              {status === 'outgoing' && (
                <div className="flex gap-2 mt-2">
                  {[0, 1, 2].map(i => (
                    <motion.div key={i} className="w-2 h-2 rounded-full bg-primary"
                      animate={{ y: [0, -8, 0] }}
                      transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Local video PiP — mirrored (selfie view feels natural) */}
          {(isVideo || isScreenSharing) && localStream && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: isFullscreenVideo && !controlsVisible ? 0.6 : 1,
                scale: 1,
              }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute w-24 h-36 sm:w-28 sm:h-40 rounded-2xl overflow-hidden border-2 border-white/30 shadow-2xl z-20 bg-black"
              style={{ top: isFullscreenVideo ? '72px' : '16px', left: '16px' }}
            >
              <video
                ref={localVideoRef}
                autoPlay playsInline muted
                className="w-full h-full object-cover"
                style={{ transform: isScreenSharing ? 'none' : 'scaleX(-1)' }}
              />
              {isCameraOff && !isScreenSharing && (
                <div className="absolute inset-0 bg-black/90 flex items-center justify-center">
                  <VideoOff className="w-6 h-6 text-white/60" />
                </div>
              )}
            </motion.div>
          )}

          {/* Controls */}
          <AnimatePresence>
          {(controlsVisible || !isFullscreenVideo) && (
          <motion.div
            key="bottom-controls"
            initial={isFullscreenVideo ? { opacity: 0, y: 30 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={isFullscreenVideo ? { opacity: 0, y: 30 } : undefined}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className={`w-full px-6 pb-12 pt-6 z-30 ${isFullscreenVideo ? 'absolute bottom-0 left-0 right-0' : 'relative mt-auto'}`}
            style={isFullscreenVideo ? {
              background: 'linear-gradient(0deg, rgba(0,0,0,0.85), rgba(0,0,0,0.4) 70%, transparent)',
            } : undefined}
          >
            {status === 'incoming' ? (
              /* Incoming: accept + reject */
              <div className="flex items-center justify-center gap-16">
                <div className="flex flex-col items-center gap-2">
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    whileHover={{ scale: 1.04 }}
                    onClick={rejectCall}
                    className="w-16 h-16 rounded-full gradient-danger glow-danger flex items-center justify-center border border-white/15 transition-[filter] hover:brightness-110 active:brightness-95"
                  >
                    <PhoneOff className="w-7 h-7 text-white drop-shadow" />
                  </motion.button>
                  <span className="text-xs text-white/60">Refuser</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    whileHover={{ scale: 1.04 }}
                    onClick={acceptCall}
                    className="w-16 h-16 rounded-full gradient-success pulse-glow-success flex items-center justify-center border border-white/15 transition-[filter] hover:brightness-110 active:brightness-95"
                    animate={{ scale: [1, 1.08, 1] }}
                    transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
                  >
                    <PhoneIncoming className="w-7 h-7 text-white drop-shadow" />
                  </motion.button>
                  <span className="text-xs text-white/60">Accepter</span>
                </div>
              </div>
            ) : (
              /* Active / outgoing: control grid */
              <div className="flex flex-col gap-4">
                {/* Row 1: secondary controls */}
                <div className="flex items-center justify-center gap-6">
                  {/* Mute */}
                  <CallCtrlBtn
                    onClick={toggleMute}
                    active={isMuted}
                    activeColor="red"
                    icon={isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    label={isMuted ? 'Muet' : 'Micro'}
                  />

                  {/* Camera toggle (video calls only) */}
                  {isVideo && (
                    <CallCtrlBtn
                      onClick={toggleCamera}
                      active={isCameraOff}
                      activeColor="red"
                      icon={isCameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                      label={isCameraOff ? 'Caméra off' : 'Caméra'}
                    />
                  )}

                  {/* Speaker toggle */}
                  <CallCtrlBtn
                    onClick={toggleSpeaker}
                    active={!isSpeakerOn}
                    activeColor="blue"
                    icon={isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                    label={isSpeakerOn ? 'Haut-parleur' : 'Écouteur'}
                  />

                  {/* Screen share */}
                  <CallCtrlBtn
                    onClick={toggleScreenShare}
                    active={isScreenSharing}
                    activeColor="blue"
                    icon={isScreenSharing ? <ScreenShareOff className="w-5 h-5" /> : <ScreenShare className="w-5 h-5" />}
                    label={isScreenSharing ? 'Arrêter' : 'Partager'}
                  />
                </div>

                {/* Row 2: End call (center, big) */}
                <div className="flex items-center justify-center">
                  <div className="flex flex-col items-center gap-1">
                    <motion.button
                      whileTap={{ scale: 0.92 }}
                      whileHover={{ scale: 1.04 }}
                      onClick={endCall}
                      className="w-16 h-16 rounded-full gradient-danger glow-danger-strong flex items-center justify-center border border-white/15 transition-[filter] hover:brightness-110 active:brightness-95"
                    >
                      <PhoneOff className="w-7 h-7 text-white drop-shadow" />
                    </motion.button>
                    <span className="text-[10px] text-white/50">Terminer</span>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
          )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Reusable control button ───────────────────────────────────────────────────
function CallCtrlBtn({
  onClick, active, activeColor, icon, label,
}: {
  onClick: () => void;
  active: boolean;
  activeColor: 'red' | 'blue' | 'green';
  icon: React.ReactNode;
  label: string;
}) {
  const colorMap = {
    red:   { bg: 'bg-red-500/20 border-red-500/40',   text: 'text-red-400', glow: '' },
    blue:  { bg: 'gradient-primary-soft border-primary/50', text: 'text-primary', glow: 'glow-primary-sm' },
    green: { bg: 'bg-green-500/20 border-green-500/40', text: 'text-green-400', glow: '' },
  };
  const { bg, text, glow } = colorMap[activeColor];

  return (
    <div className="flex flex-col items-center gap-1.5">
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={onClick}
        className={`w-12 h-12 rounded-full flex items-center justify-center border transition-colors ${
          active ? `${bg} ${text} ${glow}` : 'bg-white/10 border-white/20 text-white'
        }`}
      >
        {icon}
      </motion.button>
      <span className="text-[10px] text-white/50">{label}</span>
    </div>
  );
}
