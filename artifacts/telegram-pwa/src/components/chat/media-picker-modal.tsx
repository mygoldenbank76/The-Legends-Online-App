import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, X, Send, ChevronLeft, ChevronRight, Plus } from 'lucide-react';

export type MediaQuality = 'SD' | 'HD';

interface MediaFile {
  file: File;
  previewUrl: string;
  type: 'image' | 'video';
  id: string;
}

interface Props {
  initialFiles: File[];
  onClose: () => void;
  onSend: (files: File[], caption: string, quality: MediaQuality) => Promise<void>;
  addMoreInputRef: React.RefObject<HTMLInputElement>;
}

// Compress an image file using canvas
async function compressImage(file: File, quality: MediaQuality): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);

    img.onload = () => {
      const maxDim = quality === 'SD' ? 1280 : 4096;
      const q = quality === 'SD' ? 0.72 : 0.92;
      let { width: w, height: h } = img;

      if (Math.max(w, h) > maxDim) {
        const ratio = maxDim / Math.max(w, h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objUrl);
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
        },
        'image/jpeg',
        q,
      );
    };

    img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(file); };
    img.src = objUrl;
  });
}

function buildMediaFiles(files: File[]): MediaFile[] {
  return files.map((f, i) => ({
    file: f,
    previewUrl: URL.createObjectURL(f),
    type: f.type.startsWith('video/') ? 'video' : 'image',
    id: `${i}-${f.name}-${f.size}`,
  }));
}

export function MediaPickerModal({ initialFiles, onClose, onSend, addMoreInputRef }: Props) {
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>(() => buildMediaFiles(initialFiles));
  const [activeIdx, setActiveIdx] = useState(0);
  const [caption, setCaption] = useState('');
  const [quality, setQuality] = useState<MediaQuality>('HD');
  const [sending, setSending] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => { mediaFiles.forEach(m => URL.revokeObjectURL(m.previewUrl)); };
  }, []);

  // Scroll thumbnail strip so active thumb is visible
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const thumb = strip.children[activeIdx] as HTMLElement;
    if (thumb) thumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeIdx]);

  const removeFile = useCallback((idx: number) => {
    setMediaFiles(prev => {
      URL.revokeObjectURL(prev[idx].previewUrl);
      const next = prev.filter((_, i) => i !== idx);
      return next;
    });
    setActiveIdx(prev => Math.min(prev, Math.max(0, mediaFiles.length - 2)));
  }, [mediaFiles.length]);

  const handleAddMore = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const newMedia = buildMediaFiles(files);
    setMediaFiles(prev => [...prev, ...newMedia]);
    e.target.value = '';
  }, []);

  const handleSend = useCallback(async () => {
    if (!mediaFiles.length || sending) return;
    setSending(true);
    try {
      const processedFiles = await Promise.all(
        mediaFiles.map(async (m) => {
          if (m.type === 'image') return compressImage(m.file, quality);
          return m.file; // videos sent as-is
        })
      );
      await onSend(processedFiles, caption.trim(), quality);
    } finally {
      setSending(false);
    }
  }, [mediaFiles, caption, quality, sending, onSend]);

  if (!mediaFiles.length) { onClose(); return null; }

  const active = mediaFiles[activeIdx] ?? mediaFiles[0];
  const safeIdx = Math.min(activeIdx, mediaFiles.length - 1);

  return (
    <motion.div
      className="fixed inset-0 z-[500] flex flex-col bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {/* ── Top bar ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 pt-safe" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)' }}>
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>

        <span className="text-white text-sm font-semibold">
          {mediaFiles.length === 1 ? '1 fichier' : `${mediaFiles.length} fichiers`}
        </span>

        {/* Quality toggle */}
        <div className="flex items-center gap-1 bg-white/10 rounded-full p-0.5">
          {(['SD', 'HD'] as MediaQuality[]).map(q => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                quality === q
                  ? 'bg-white text-black shadow'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main preview ── */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-black">
        <AnimatePresence mode="wait">
          <motion.div
            key={active.id}
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
          >
            {active.type === 'video' ? (
              <video
                src={active.previewUrl}
                controls
                playsInline
                className="max-w-full max-h-full object-contain"
                style={{ maxHeight: 'calc(100vh - 200px)' }}
              />
            ) : (
              <img
                src={active.previewUrl}
                alt="preview"
                className="max-w-full max-h-full object-contain"
                style={{ maxHeight: 'calc(100vh - 200px)' }}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation arrows (when > 1 file) */}
        {mediaFiles.length > 1 && (
          <>
            <button
              onClick={() => setActiveIdx(i => Math.max(0, i - 1))}
              disabled={safeIdx === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center disabled:opacity-20 hover:bg-black/70 transition-colors z-10"
            >
              <ChevronLeft className="w-5 h-5 text-white" />
            </button>
            <button
              onClick={() => setActiveIdx(i => Math.min(mediaFiles.length - 1, i + 1))}
              disabled={safeIdx === mediaFiles.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center disabled:opacity-20 hover:bg-black/70 transition-colors z-10"
            >
              <ChevronRight className="w-5 h-5 text-white" />
            </button>
          </>
        )}

        {/* Quality indicator overlay */}
        <div className="absolute top-3 right-3 bg-black/60 rounded-md px-2 py-0.5 text-white text-xs font-bold tracking-wide">
          {quality}
        </div>

        {/* Remove current file */}
        {mediaFiles.length > 0 && (
          <button
            onClick={() => removeFile(safeIdx)}
            className="absolute top-3 left-3 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center hover:bg-red-500/80 transition-colors"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        )}
      </div>

      {/* ── Thumbnail strip ── */}
      <div className="flex-shrink-0 py-2" style={{ background: 'rgba(0,0,0,0.8)' }}>
        <div
          ref={stripRef}
          className="flex items-center gap-1.5 px-3 overflow-x-auto"
          style={{ touchAction: 'pan-x', scrollbarWidth: 'none' }}
        >
          {mediaFiles.map((m, i) => (
            <button
              key={m.id}
              onClick={() => setActiveIdx(i)}
              className={`flex-shrink-0 relative rounded-lg overflow-hidden transition-all ${
                i === safeIdx
                  ? 'ring-2 ring-white scale-105'
                  : 'opacity-60 hover:opacity-90'
              }`}
              style={{ width: 60, height: 60 }}
            >
              {m.type === 'video' ? (
                <video src={m.previewUrl} className="w-full h-full object-cover" muted />
              ) : (
                <img src={m.previewUrl} alt="" className="w-full h-full object-cover" />
              )}
              {m.type === 'video' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <div className="w-5 h-5 rounded-full bg-white/80 flex items-center justify-center">
                    <div className="w-0 h-0 border-y-[5px] border-y-transparent border-l-[8px] border-l-black ml-0.5" />
                  </div>
                </div>
              )}
              {/* Remove badge */}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center hover:bg-red-500 transition-colors"
              >
                <X className="w-2.5 h-2.5 text-white" />
              </button>
            </button>
          ))}

          {/* Add more button */}
          <button
            onClick={() => addMoreInputRef.current?.click()}
            className="flex-shrink-0 w-[60px] h-[60px] rounded-lg border-2 border-dashed border-white/30 flex items-center justify-center hover:border-white/60 hover:bg-white/5 transition-colors"
          >
            <Plus className="w-5 h-5 text-white/60" />
          </button>
        </div>
      </div>

      {/* ── Caption + Send ── */}
      <div
        className="flex-shrink-0 flex items-end gap-2 px-3 py-2 pb-safe"
        style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}
      >
        <div className="flex-1 rounded-2xl px-4 py-2.5" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}>
          <textarea
            ref={captionRef}
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Ajouter une légende..."
            rows={1}
            className="w-full bg-transparent text-white placeholder:text-white/40 text-sm resize-none outline-none leading-relaxed"
            style={{ maxHeight: 100 }}
            onInput={e => {
              const ta = e.currentTarget;
              ta.style.height = 'auto';
              ta.style.height = `${Math.min(ta.scrollHeight, 100)}px`;
            }}
          />
        </div>

        <button
          onClick={handleSend}
          disabled={sending}
          className="flex-shrink-0 w-11 h-11 rounded-full bg-primary flex items-center justify-center shadow-lg transition-all active:scale-95 disabled:opacity-60"
        >
          {sending ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="w-5 h-5 text-white ml-0.5" />
          )}
        </button>
      </div>
    </motion.div>
  );
}
