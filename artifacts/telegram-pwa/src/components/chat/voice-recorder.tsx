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

export function VoiceRecorder({ onSend, onCancel }: Props) {
  const [phase, setPhase] = useState<'recording' | 'preview'>('recording');
  const [elapsed, setElapsed] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioBlobRef = useRef<Blob | null>(null);
  const durationRef = useRef<number>(0);

  // Auto-start recording on mount
  useEffect(() => {
    startRecording();
    return () => {
      // Cleanup on unmount
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
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

      // Pick the best supported codec — opus gives the best quality/size ratio
      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
        : '';

      // Build options — don't force audioBitsPerSecond, let the browser pick
      // (some Android Chrome versions reject explicit bitrates and throw)
      const options: MediaRecorderOptions = mimeType ? { mimeType } : {};

      let mr: MediaRecorder;
      try {
        mr = new MediaRecorder(stream, options);
      } catch {
        // Fallback: no options at all
        mr = new MediaRecorder(stream);
      }
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
        setPhase('preview');
      };

      mr.start(100); // 100 ms chunks — fine-grained for reliability
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
      >
        <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
        <span className="text-red-400 text-sm font-mono flex-1">{formatTime(elapsed)}</span>
        <span className="text-xs text-muted-foreground hidden sm:inline">Enregistrement...</span>
        <button onClick={cancelAll} className="text-muted-foreground hover:text-red-400 transition-colors p-1" title="Annuler">
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

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="flex-1 flex items-center gap-2 glass rounded-2xl border border-primary/30 px-3 py-2"
    >
      <div className="flex gap-0.5 flex-1 items-center">
        {Array.from({ length: 18 }).map((_, i) => (
          <div key={i} className="w-0.5 bg-primary/50 rounded-full flex-shrink-0"
            style={{ height: `${8 + Math.sin(i * 0.7) * 8}px` }} />
        ))}
        <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{formatTime(durationRef.current || elapsed)}</span>
      </div>
      <button onClick={cancelAll} className="text-muted-foreground hover:text-red-400 transition-colors p-1 flex-shrink-0">
        <Trash2 className="w-4 h-4" />
      </button>
      <button
        onClick={sendVoice}
        disabled={sending}
        className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/30 hover:bg-primary/30 text-primary flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-50"
      >
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
      </button>
    </motion.div>
  );
}
