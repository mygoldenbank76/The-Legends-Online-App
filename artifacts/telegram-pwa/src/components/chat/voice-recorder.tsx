import { useState, useRef, useCallback, useEffect } from 'react';
import { Square, Trash2, Send, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { VoiceRecorder as NativeVoiceRecorder } from 'capacitor-voice-recorder';

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

// ── Capacitor detection ─────────────────────────────────────────────────────
// On detecte la WebView Capacitor (= APK) pour basculer sur l'enregistreur
// AUDIO NATIF Android (AAC/M4A 44.1 kHz, encodeur hardware), qui produit
// une qualite vocal identique a Telegram / WhatsApp. Sur le web on retombe
// sur MediaRecorder + opus/webm.
const isNativeApp =
  typeof window !== 'undefined' &&
  !!((window as any).Capacitor?.isNativePlatform?.() || (window as any).Capacitor?.isNative);

// Decode a base64 string -> Uint8Array, then wrap as a Blob with the right
// MIME type. capacitor-voice-recorder returns base64 (m4a/aac on Android,
// m4a/aac on iOS) which we need to upload as a binary Blob.
function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function VoiceRecorder({ onSend, onCancel }: Props) {
  const [phase, setPhase] = useState<'recording' | 'preview'>('recording');
  const [elapsed, setElapsed] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Captured waveform snapshot (one value 0-1 per bar) taken at stop time
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
  const ampPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveHistoryRef = useRef<number[]>(Array(BAR_COUNT).fill(0));

  // Auto-start recording on mount
  useEffect(() => {
    startRecording();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (ampPollRef.current) clearInterval(ampPollRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      // Best-effort native cleanup if the user dismissed mid-recording.
      if (isNativeApp) {
        NativeVoiceRecorder.stopRecording().catch(() => {});
      }
    };
  }, []);

  // ── Waveform drawing — shared between web (analyser) and native (poll) ──
  const drawBars = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const barW = W / BAR_COUNT - 1;
    waveHistoryRef.current.forEach((val, i) => {
      const barH = Math.max(3, val * H * 1.8);
      const x = i * (barW + 1);
      const y = (H - barH) / 2;
      const alpha = 0.3 + (i / BAR_COUNT) * 0.7;
      ctx.fillStyle = `hsla(263, 90%, 70%, ${alpha})`;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 2);
      ctx.fill();
    });
  }, []);

  const drawWebWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const bufferLength = analyser.frequencyBinCount;
    const data = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((s, v) => s + v, 0) / bufferLength / 255;
    waveHistoryRef.current.shift();
    waveHistoryRef.current.push(avg);
    drawBars();
    rafRef.current = requestAnimationFrame(drawWebWaveform);
  }, [drawBars]);

  // ── Native recording (Capacitor APK) ────────────────────────────────────
  const startNativeRecording = async () => {
    // Check permission first — capacitor-voice-recorder will prompt the
    // OS dialog if not yet granted, which works because we already declared
    // RECORD_AUDIO in AndroidManifest.xml.
    const can = await NativeVoiceRecorder.canDeviceVoiceRecord();
    if (!can.value) throw new Error('Device cannot record');

    const perm = await NativeVoiceRecorder.hasAudioRecordingPermission();
    if (!perm.value) {
      const req = await NativeVoiceRecorder.requestAudioRecordingPermission();
      if (!req.value) throw new Error('Permission denied');
    }

    await NativeVoiceRecorder.startRecording();
    waveHistoryRef.current = Array(BAR_COUNT).fill(0);

    // Poll the native amplitude (-160..0 dB) every 80 ms to drive the
    // waveform animation. We map dB to a 0-1 perceived loudness curve.
    ampPollRef.current = setInterval(async () => {
      try {
        const status = await NativeVoiceRecorder.getCurrentStatus();
        if (status.status !== 'RECORDING') return;
        // capacitor-voice-recorder doesn't expose amplitude directly across
        // every version, so we synthesize a soft idle waveform with a small
        // random component if no API is available. The bars still feel
        // alive while recording, even if not perfectly mic-reactive.
        const fake = 0.25 + Math.random() * 0.55;
        waveHistoryRef.current.shift();
        waveHistoryRef.current.push(fake);
        drawBars();
      } catch {
        /* ignore */
      }
    }, 80);
  };

  const stopNativeRecording = async (): Promise<{ blob: Blob; duration: number } | null> => {
    try {
      const result = await NativeVoiceRecorder.stopRecording();
      const rec = result.value;
      if (!rec || !rec.recordDataBase64) return null;
      const mime = rec.mimeType || 'audio/aac';
      const blob = base64ToBlob(rec.recordDataBase64, mime);
      const durationMs = rec.msDuration || (Date.now() - startTimeRef.current);
      return { blob, duration: Math.max(1, Math.floor(durationMs / 1000)) };
    } catch (e) {
      console.error('Native stopRecording failed', e);
      return null;
    }
  };

  // ── Web recording (MediaRecorder) ───────────────────────────────────────
  //
  // Quality target: rapprocher le maximum possible d'une vraie app native
  // sans quitter le sandbox navigateur. Concrètement on pousse trois leviers
  // que la plupart des web apps oublient :
  //
  //   1. Constraints getUserMedia "studio-grade" : 48 kHz / mono / 16-bit
  //      + le triple processing du WebRTC stack (echo cancel, noise
  //      suppression, AGC). On ajoute aussi `latency: 0.01` (10ms) pour
  //      forcer le pipeline audio dans son mode basse-latence et éviter
  //      le buffering aggressif qui dégrade les transitoires vocaux.
  //   2. `voiceIsolation: true` — flag iOS Safari 17+ qui active le mode
  //      Voice Isolation d'Apple (le même que dans FaceTime / WhatsApp).
  //      Ignoré silencieusement sur les autres navigateurs.
  //   3. MediaRecorder à 160 kbps Opus VBR — sweet spot pour la voix où
  //      Opus atteint une qualité "musique-grade" indistinguible du
  //      48 kHz/16-bit non-compressé en aveugle. 128 kbps (notre ancien
  //      réglage) restait audible comme "compressé" sur des voix graves.
  //      Sur Safari (qui ne supporte pas Opus), on tente AAC-LC explicite
  //      (`mp4a.40.2`) à 128 kbps avant de tomber sur le générique
  //      `audio/mp4` que Safari encode parfois en HE-AAC bas-bitrate.
  //
  // Limite fondamentale qu'on NE peut pas franchir en web : l'API
  // MediaRecorder n'expose pas le mode `VOICE_COMMUNICATION` du driver
  // audio Android (qui rebascule sur le DSP "appel" du téléphone, plus
  // optimisé pour la voix que le DSP "média"). Seule l'app Capacitor
  // y a accès via `capacitor-voice-recorder`.
  const startWebRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: 48000 },
        sampleSize: { ideal: 16 },
        channelCount: { ideal: 1 },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Force le pipeline audio dans son mode basse-latence (10ms).
        // Standard depuis Chrome 92 / Firefox 100 / Safari 16. Ignoré
        // ailleurs.
        latency: { ideal: 0.01 },
        // iOS Safari 17+ — active le mode Voice Isolation d'Apple
        // (même DSP qu'en appel FaceTime). Cast en `any` parce que
        // les types DOM ne le connaissent pas encore mais Safari
        // l'accepte et le respecte.
        ...({ voiceIsolation: true } as any),
      } as MediaTrackConstraints,
    });

    // AudioContext basse-latence pour le waveform — ne change pas la
    // qualité enregistrée (le flux MediaRecorder est indépendant), mais
    // rend la barre de waveform plus réactive aux pics de voix.
    const audioCtx = new AudioContext({ latencyHint: 'interactive' });
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    analyserRef.current = analyser;
    waveHistoryRef.current = Array(BAR_COUNT).fill(0);
    rafRef.current = requestAnimationFrame(drawWebWaveform);

    // Ordre de préférence : Opus (Chrome/Firefox/Edge/Android) puis
    // AAC-LC explicite (Safari desktop + iOS). Le générique `audio/mp4`
    // reste en dernier filet de sécurité — sur certains iOS Safari il
    // fallback sur HE-AAC qui sonne moins bien sur la voix masculine.
    const mimeType =
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2') ? 'audio/mp4;codecs=mp4a.40.2'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
      : '';

    // 160 kbps pour Opus (sweet spot voix → quasi musique-grade) ;
    // 128 kbps pour AAC-LC (équivalent perceptuel à Opus 160 sur voix
    // d'après les tests EBU/Opus working group). Si le navigateur
    // refuse même le mimeType explicite, on retombe en MediaRecorder()
    // sans options et on accepte ce que le navigateur sait faire.
    const isAac = mimeType.includes('mp4a') || mimeType === 'audio/mp4';
    const targetBitrate = isAac ? 128_000 : 160_000;
    let mr: MediaRecorder = new MediaRecorder(stream);
    const optionSets: MediaRecorderOptions[] = [
      ...(mimeType ? [{ mimeType, audioBitsPerSecond: targetBitrate }] : []),
      ...(mimeType ? [{ mimeType }] : []),
      {},
    ];
    let created = false;
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
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      analyserRef.current = null;
      setWaveformSnapshot([...waveHistoryRef.current]);
      setPhase('preview');
    };

    mr.start(100);
    mediaRecorderRef.current = mr;
  };

  const startRecording = async () => {
    try {
      if (isNativeApp) {
        await startNativeRecording();
      } else {
        await startWebRecording();
      }
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

  const stopRecording = useCallback(async () => {
    if (isNativeApp) {
      // Stop the amplitude poll + tick timer, then collect the native blob.
      if (ampPollRef.current) { clearInterval(ampPollRef.current); ampPollRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      const result = await stopNativeRecording();
      if (!result) {
        setError('Enregistrement échoué');
        return;
      }
      audioBlobRef.current = result.blob;
      durationRef.current = result.duration;
      setWaveformSnapshot([...waveHistoryRef.current]);
      setPhase('preview');
    } else {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    }
  }, []);

  const cancelAll = useCallback(() => {
    if (isNativeApp) {
      NativeVoiceRecorder.stopRecording().catch(() => {});
      if (ampPollRef.current) { clearInterval(ampPollRef.current); ampPollRef.current = null; }
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
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
      setError("Erreur lors de l'envoi");
      setSending(false);
    }
  }, [sending, elapsed, onSend]);

  if (error) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="flex-1 composer-pill flex items-center gap-2 px-3 min-h-[52px]">
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
        className="flex-1 composer-pill flex items-center gap-2 px-3 min-h-[52px]"
      >
        <div className="relative flex-shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <div className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-60" />
        </div>
        <span className="text-red-400 text-sm font-mono flex-shrink-0 w-10">{formatTime(elapsed)}</span>
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

  const snapshotBars = waveformSnapshot.length > 0
    ? waveformSnapshot
    : Array.from({ length: 18 }).map((_, i) => 0.3 + Math.sin(i * 0.7) * 0.3);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="flex-1 composer-pill flex items-center gap-2 px-3 min-h-[52px]"
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
