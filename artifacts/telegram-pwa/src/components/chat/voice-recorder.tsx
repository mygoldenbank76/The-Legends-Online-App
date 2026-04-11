import { useState, useRef, useCallback } from 'react';
import { Mic, Square, Trash2, Send, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

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
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [sending, setSending] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4',
      });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        setAudioBlob(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start(100);
      mediaRecorderRef.current = mr;
      startTimeRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } catch (e) {
      console.error('Microphone access denied', e);
      alert('Accès au microphone refusé. Veuillez autoriser le microphone dans les paramètres de votre navigateur.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }, [recording]);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    setAudioBlob(null);
    setElapsed(0);
    onCancel();
  }, [recording, onCancel]);

  const sendVoice = useCallback(async () => {
    if (!audioBlob) return;
    setSending(true);
    try {
      await onSend(audioBlob, elapsed);
      setAudioBlob(null);
      setElapsed(0);
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  }, [audioBlob, elapsed, onSend]);

  if (!recording && !audioBlob) {
    return (
      <motion.button
        key="mic-idle"
        onClick={startRecording}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 hover:bg-primary/30 text-primary transition-colors flex items-center justify-center mb-0.5"
      >
        <Mic className="w-4 h-4" />
      </motion.button>
    );
  }

  if (recording) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 flex items-center gap-2 glass rounded-2xl border border-red-500/30 px-3 py-2"
      >
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
        <span className="text-red-400 text-sm font-mono flex-1">{formatTime(elapsed)}</span>
        <span className="text-xs text-muted-foreground">En cours...</span>
        <button onClick={cancelRecording} className="text-muted-foreground hover:text-red-400 transition-colors p-1">
          <Trash2 className="w-4 h-4" />
        </button>
        <button
          onClick={stopRecording}
          className="w-9 h-9 rounded-xl bg-red-500/20 border border-red-500/30 hover:bg-red-500/30 text-red-400 flex items-center justify-center flex-shrink-0 transition-colors"
        >
          <Square className="w-4 h-4" fill="currentColor" />
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 flex items-center gap-2 glass rounded-2xl border border-primary/30 px-3 py-2"
    >
      <Mic className="w-4 h-4 text-primary flex-shrink-0" />
      <span className="text-sm text-foreground flex-1">Message vocal · {formatTime(elapsed)}</span>
      <button onClick={cancelRecording} className="text-muted-foreground hover:text-red-400 transition-colors p-1">
        <Trash2 className="w-4 h-4" />
      </button>
      <button
        onClick={sendVoice}
        disabled={sending}
        className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/30 hover:bg-primary/30 text-primary flex items-center justify-center flex-shrink-0 transition-colors"
      >
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
      </button>
    </motion.div>
  );
}
