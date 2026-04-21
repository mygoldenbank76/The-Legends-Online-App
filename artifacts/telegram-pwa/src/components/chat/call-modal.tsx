/**
 * CallModal — full-screen overlay for incoming / outgoing / active WebRTC calls.
 * Renders on top of everything else; parents control visibility via callState.status.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff, PhoneIncoming, Mic, MicOff, Video, VideoOff, X } from 'lucide-react';
import { useCall } from '@/lib/call-context';

function formatCallDuration(startedAt?: number): string {
  if (!startedAt) return '0:00';
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function CallModal() {
  const { callState, acceptCall, rejectCall, endCall, toggleMute, toggleCamera } = useCall();
  const { status, peerName, peerAvatar, isVideo, localStream, remoteStream, isMuted, isCameraOff, startedAt } = callState;

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState('0:00');

  // Attach streams to video elements
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Call duration timer
  useEffect(() => {
    if (status !== 'active' || !startedAt) return;
    setDuration(formatCallDuration(startedAt));
    const id = setInterval(() => setDuration(formatCallDuration(startedAt)), 1000);
    return () => clearInterval(id);
  }, [status, startedAt]);

  const visible = status !== 'idle';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="call-modal"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-between"
          style={{
            background: 'linear-gradient(135deg, hsl(263 60% 10%), hsl(263 40% 5%))',
          }}
        >
          {/* Animated background rings */}
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

          {/* Top section: peer info */}
          <div className="flex-1 flex flex-col items-center justify-center gap-4 pt-16 relative z-10 w-full">
            {/* Remote video (full bg when video call active) */}
            {isVideo && remoteStream && (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted={false}
                className="absolute inset-0 w-full h-full object-cover opacity-70"
              />
            )}

            {/* Avatar */}
            <motion.div
              animate={status === 'incoming' ? { scale: [1, 1.08, 1] } : {}}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="relative"
            >
              <div className="w-28 h-28 rounded-full bg-primary/20 border-4 border-primary/40 flex items-center justify-center overflow-hidden shadow-2xl">
                {peerAvatar
                  ? <img src={peerAvatar} alt={peerName} className="w-full h-full object-cover" />
                  : <span className="text-4xl font-bold text-primary">{peerName?.charAt(0).toUpperCase()}</span>
                }
              </div>
              {status === 'active' && (
                <motion.div
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-green-500 border-2 border-background flex items-center justify-center"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
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
                {status === 'active' && duration}
              </p>
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

          {/* Local video (PiP when video call) */}
          {isVideo && localStream && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute top-4 right-4 w-28 h-40 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl z-20"
            >
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {isCameraOff && (
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                  <VideoOff className="w-6 h-6 text-white/60" />
                </div>
              )}
            </motion.div>
          )}

          {/* Bottom section: controls */}
          <div className="w-full px-8 pb-16 relative z-10">
            {status === 'incoming' ? (
              /* Incoming: accept + reject */
              <div className="flex items-center justify-center gap-16">
                <div className="flex flex-col items-center gap-2">
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={rejectCall}
                    className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg"
                  >
                    <PhoneOff className="w-7 h-7 text-white" />
                  </motion.button>
                  <span className="text-xs text-white/60">Refuser</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={acceptCall}
                    className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center shadow-lg"
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ repeat: Infinity, duration: 1.2 }}
                  >
                    <PhoneIncoming className="w-7 h-7 text-white" />
                  </motion.button>
                  <span className="text-xs text-white/60">Accepter</span>
                </div>
              </div>
            ) : (
              /* Outgoing / Active: controls row */
              <div className="flex items-center justify-center gap-6">
                {/* Mute */}
                <div className="flex flex-col items-center gap-2">
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={toggleMute}
                    className={`w-12 h-12 rounded-full flex items-center justify-center ${isMuted ? 'bg-red-500/20 border border-red-500/40' : 'bg-white/10 border border-white/20'}`}
                  >
                    {isMuted ? <MicOff className="w-5 h-5 text-red-400" /> : <Mic className="w-5 h-5 text-white" />}
                  </motion.button>
                  <span className="text-[10px] text-white/50">{isMuted ? 'Muet' : 'Micro'}</span>
                </div>

                {/* End call */}
                <div className="flex flex-col items-center gap-2">
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={endCall}
                    className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg"
                  >
                    <PhoneOff className="w-7 h-7 text-white" />
                  </motion.button>
                  <span className="text-[10px] text-white/50">Terminer</span>
                </div>

                {/* Camera toggle (video calls only) */}
                {isVideo ? (
                  <div className="flex flex-col items-center gap-2">
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={toggleCamera}
                      className={`w-12 h-12 rounded-full flex items-center justify-center ${isCameraOff ? 'bg-red-500/20 border border-red-500/40' : 'bg-white/10 border border-white/20'}`}
                    >
                      {isCameraOff ? <VideoOff className="w-5 h-5 text-red-400" /> : <Video className="w-5 h-5 text-white" />}
                    </motion.button>
                    <span className="text-[10px] text-white/50">{isCameraOff ? 'Caméra off' : 'Caméra'}</span>
                  </div>
                ) : (
                  /* Placeholder to keep layout symmetric */
                  <div className="w-12 h-12" />
                )}
              </div>
            )}
          </div>

          {/* Cancel outgoing (small X in corner) */}
          {status === 'outgoing' && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={endCall}
              className="absolute top-4 left-4 z-20 w-9 h-9 rounded-full bg-white/10 flex items-center justify-center"
            >
              <X className="w-4 h-4 text-white" />
            </motion.button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
