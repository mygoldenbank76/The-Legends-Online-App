import { useState, useRef, useCallback, useEffect } from 'react';
import { Square, Trash2, Send, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

type Props = {
  onSend: (audioBlob: Blob, duration: number) => Promise<void>;
  onCancel: () => void;
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const BAR_COUNT = 40;

export function VoiceRecorder({ onSend, onCancel }: Props) {
  const [phase, setPhase] = useState<'recording' | 'preview'>('recording');
  const [elapsed, setElapsed] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Captured waveform snapshot (one value 0–1 per bar) taken at stop time
  const [waveformSnapshot, setWaveformSnapshot] = useState<number[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioBlobRef = useRef<Blob | null>(null);
  const durationRef = useRef<number>(0);

  // Waveform canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const waveHistoryRef = useRef<number[]>(Array(BAR_COUNT).fill(0));

  // Auto-start recording on mount
  useEffect(() => {
    startRecording();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const data = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(data);

    // Compute average amplitude of current frame (0–1)
    const avg = data.reduce((s, v) => s + v, 0) / bufferLength / 255;

    // Shift history left, push new value
    waveHistoryRef.current.shift();
    waveHistoryRef.current.push(avg);

    // Draw bars
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const barW = W / BAR_COUNT - 1;
    waveHistoryRef.current.forEach((val, i) => {
      const barH = Math.max(3, val * H * 1.8);
      const x = i * (barW + 1);
      const y = (H - barH) / 2;

      // Gradient: older bars dimmer
      const alpha = 0.3 + (i / BAR_COUNT) * 0.7;
      ctx.fillStyle = `hsla(263, 90%, 70%, ${alpha})`;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 2);
      ctx.fill();
    });

    rafRef.current = requestAnimationFrame(drawWaveform);
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 48000 },
          sampleSize: { ideal: 16 },
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // ── Web Audio API for waveform ──────────────────────────────────────
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyserRef.current = analyser;
      waveHistoryRef.current = Array(BAR_COUNT).fill(0);
      rafRef.current = requestAnimationFrame(drawWaveform);

      // ── MediaRecorder ───────────────────────────────────────────────────
      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
        : '';

      let mr: MediaRecorder;
      const optionSets: MediaRecorderOptions[] = [
        ...(mimeType ? [{ mimeType, audioBitsPerSecond: 128_000 }] : []),
        ...(mimeType ? [{ mimeType }] : []),
        {},
      ];
      let created = false;
      mr = new MediaRecorder(stream);
      for (const opts of optionSets) {
        try { mr = new MediaRecorder(stream, opts); created = true; break; } catch { /* try next */ }
      }
      if (!created) mr = new MediaRecorder(stream);
      chunksRef.current = [];

      mr.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const type = mr.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        audioBlobRef.current = blob;
        durationRef.current = Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000));
        stream.getTracks().forEach(t => t.stop());
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        // Stop waveform animation and capture snapshot
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        analyserRef.current = null;
        setWaveformSnapshot([...waveHistoryRef.current]);
        setPhase('preview');
      };

      mr.start(100);
      mediaRecorderRef.current = mr;
      startTimeRef.current = Date.now();
      setElapsed(0);
      setPhase('recording');

      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } catch (e) {
      console.error('Microphone error:', e);
      setError('Accès au microphone refusé');
    }
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const cancelAll = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    audioBlobRef.current = null;
    onCancel();
  }, [onCancel]);

  const sendVoice = useCallback(async () => {
    const blob = audioBlobRef.current;
    if (!blob || sending) return;
    setSending(true);
    try {
      await onSend(blob, durationRef.current || elapsed);
    } catch (e) {
      console.error('Send error:', e);
      setError('Erreur lors de l\'envoi');
      setSending(false);
    }
  }, [sending, elapsed, onSend]);

  if (error) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="flex-1 flex items-center gap-2 glass rounded-2xl border border-red-500/30 px-3 py-2">
        <span className="text-red-400 text-xs flex-1">{error}</span>
        <button onClick={cancelAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors underline">
          Fermer
        </button>
      </motion.div>
    );
  }

  if (phase === 'recording') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="flex-1 flex items-center gap-2 glass rounded-2xl border border-red-500/40 px-3 py-2"
        style={{ boxShadow: '0 4px 14px -4px hsl(0 75% 55% / 0.35)' }}
      >
        <div className="relative flex-shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <div className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-60" />
        </div>
        <span className="text-red-400 text-sm font-mono flex-shrink-0 w-10">{formatTime(elapsed)}</span>
        {/* Live waveform canvas */}
        <canvas
          ref={canvasRef}
          width={160}
          height={32}
          className="flex-1 min-w-0"
          style={{ display: 'block', height: '32px' }}
        />
        <button onClick={cancelAll} className="text-muted-foreground hover:text-red-400 transition-colors p-1 flex-shrink-0" title="Annuler">
          <Trash2 className="w-4 h-4" />
        </button>
        <button
          onClick={stopRecording}
          className="w-9 h-9 rounded-xl bg-red-500/20 border border-red-500/30 hover:bg-red-500/30 text-red-400 flex items-center justify-center flex-shrink-0 transition-colors"
          title="Arrêter"
        >
          <Square className="w-4 h-4" fill="currentColor" />
        </button>
      </motion.div>
    );
  }

  // Preview phase: show static waveform from snapshot
  const snapshotBars = waveformSnapshot.length > 0
    ? waveformSnapshot
    : Array.from({ length: 18 }).map((_, i) => 0.3 + Math.sin(i * 0.7) * 0.3);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="flex-1 flex items-center gap-2 glass rounded-2xl border border-primary/35 px-3 py-2"
      style={{ boxShadow: '0 4px 14px -4px hsl(263 90% 65% / 0.35)' }}
    >
      <div className="flex gap-0.5 flex-1 items-center min-w-0">
        {snapshotBars.map((val, i) => (
          <div key={i}
            className="flex-shrink-0 rounded-full"
            style={{
              width: '3px',
              height: `${Math.max(4, val * 28)}px`,
              background: `hsla(263, 90%, 70%, ${0.4 + val * 0.6})`,
            }}
          />
        ))}
        <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{formatTime(durationRef.current || elapsed)}</span>
      </div>
      <button onClick={cancelAll} className="text-muted-foreground hover:text-red-400 transition-colors p-1 flex-shrink-0">
        <Trash2 className="w-4 h-4" />
      </button>
      <button
        onClick={sendVoice}
        disabled={sending}
        className="w-9 h-9 rounded-xl gradient-primary glow-primary-sm text-white flex items-center justify-center flex-shrink-0 hover:opacity-95 active:scale-95 transition-all disabled:opacity-50"
      >
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
      </button>
    </motion.div>
  );
}
