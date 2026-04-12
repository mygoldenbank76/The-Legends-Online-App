import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, X, Send, ChevronLeft, ChevronRight, Plus, Bold, Italic, Underline, Strikethrough, Eye } from 'lucide-react';
import { applyFormat } from './rich-text';
import type { FormatType } from './rich-text';

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
  const [hasSelection, setHasSelection] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);

  // ── Drag-to-reorder state ──────────────────────────────────────────
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);

  const handleFormat = useCallback((fmt: FormatType) => {
    const ta = captionRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const { newText, newStart, newEnd } = applyFormat(caption, start, end, fmt);
    setCaption(newText);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newStart, newEnd);
    });
  }, [caption]);

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

  // ── Drag-to-reorder helpers ────────────────────────────────────────
  const getThumbIndexFromX = useCallback((clientX: number): number | null => {
    const strip = stripRef.current;
    if (!strip) return null;
    const children = Array.from(strip.children) as HTMLElement[];
    for (let j = 0; j < children.length - 1; j++) { // exclude "+" button
      const rect = children[j].getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return j;
    }
    return null;
  }, []);

  const applyReorder = useCallback((from: number, to: number) => {
    if (from === to) return;
    setMediaFiles(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setActiveIdx(to);
  }, []);

  const onThumbPointerDown = useCallback((e: React.PointerEvent, i: number) => {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    draggingRef.current = false;
    longPressRef.current = setTimeout(() => {
      draggingRef.current = true;
      setDragIdx(i);
      setOverIdx(i);
      try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    }, 220);
  }, []);

  const onThumbPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const hit = getThumbIndexFromX(e.clientX);
    if (hit !== null) setOverIdx(hit);
  }, [getThumbIndexFromX]);

  const onThumbPointerUp = useCallback((e: React.PointerEvent, i: number) => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    if (draggingRef.current && dragIdx !== null && overIdx !== null) {
      applyReorder(dragIdx, overIdx);
    } else if (!draggingRef.current) {
      setActiveIdx(i);
    }
    draggingRef.current = false;
    setDragIdx(null);
    setOverIdx(null);
  }, [dragIdx, overIdx, applyReorder]);

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

      </div>

      {/* ── Thumbnail strip ── */}
      <div className="flex-shrink-0 py-2" style={{ background: 'rgba(0,0,0,0.8)' }}>
        {dragIdx !== null && (
          <p className="text-center text-white/50 text-[10px] mb-1">Glisse pour réordonner</p>
        )}
        <div
          ref={stripRef}
          className="flex items-center gap-1.5 px-3 overflow-x-auto"
          style={{ touchAction: dragIdx !== null ? 'none' : 'pan-x', scrollbarWidth: 'none', userSelect: 'none' }}
        >
          {mediaFiles.map((m, i) => {
            const isActive = i === safeIdx;
            const isDragged = i === dragIdx;
            const isOver = i === overIdx && dragIdx !== null && dragIdx !== i;
            return (
              <div
                key={m.id}
                className={`flex-shrink-0 relative rounded-lg overflow-hidden transition-all duration-150 cursor-grab active:cursor-grabbing ${
                  isActive && dragIdx === null ? 'ring-2 ring-white scale-105' : ''
                } ${isDragged ? 'opacity-40 scale-95 ring-2 ring-primary' : ''}
                ${isOver ? 'ring-2 ring-white/70 scale-110' : ''}
                ${!isActive && dragIdx === null ? 'opacity-60' : ''}`}
                style={{ width: 60, height: 60, touchAction: 'none' }}
                onPointerDown={e => onThumbPointerDown(e, i)}
                onPointerMove={onThumbPointerMove}
                onPointerUp={e => onThumbPointerUp(e, i)}
                onPointerCancel={() => { draggingRef.current = false; setDragIdx(null); setOverIdx(null); }}
              >
                {m.type === 'video' ? (
                  <video src={m.previewUrl} className="w-full h-full object-cover pointer-events-none" muted />
                ) : (
                  <img src={m.previewUrl} alt="" className="w-full h-full object-cover pointer-events-none" draggable={false} />
                )}
                {m.type === 'video' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                    <div className="w-5 h-5 rounded-full bg-white/80 flex items-center justify-center">
                      <div className="w-0 h-0 border-y-[5px] border-y-transparent border-l-[8px] border-l-black ml-0.5" />
                    </div>
                  </div>
                )}
                {/* Order badge */}
                <div className="absolute bottom-0.5 left-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center pointer-events-none">
                  <span className="text-white text-[9px] font-bold leading-none">{i + 1}</span>
                </div>
                {/* Remove badge */}
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center hover:bg-red-500 transition-colors"
                >
                  <X className="w-2.5 h-2.5 text-white" />
                </button>
              </div>
            );
          })}

          {/* Add more button */}
          <button
            onClick={() => addMoreInputRef.current?.click()}
            className="flex-shrink-0 w-[60px] h-[60px] rounded-lg border-2 border-dashed border-white/30 flex items-center justify-center hover:border-white/60 hover:bg-white/5 transition-colors"
          >
            <Plus className="w-5 h-5 text-white/60" />
          </button>
        </div>
      </div>

      {/* ── Formatting toolbar (appears when text is selected) ── */}
      <AnimatePresence>
        {hasSelection && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.13 }}
            className="flex-shrink-0 flex items-center justify-around px-2 py-1 overflow-hidden"
            style={{ background: 'rgba(30,20,50,0.95)', borderTop: '1px solid rgba(255,255,255,0.08)' }}
          >
            {([
              { fmt: 'bold' as FormatType, icon: <Bold className="w-4 h-4" />, label: 'Gras' },
              { fmt: 'italic' as FormatType, icon: <Italic className="w-4 h-4" />, label: 'Italique' },
              { fmt: 'underline' as FormatType, icon: <Underline className="w-4 h-4" />, label: 'Souligner' },
              { fmt: 'strike' as FormatType, icon: <Strikethrough className="w-4 h-4" />, label: 'Barrer' },
              { fmt: 'spoiler' as FormatType, icon: <Eye className="w-4 h-4" />, label: 'Spoiler' },
            ]).map(({ fmt, icon, label }) => (
              <button
                key={fmt}
                onMouseDown={e => { e.preventDefault(); handleFormat(fmt); }}
                onTouchEnd={e => { e.preventDefault(); handleFormat(fmt); }}
                className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-white/80 hover:bg-white/10 hover:text-white active:scale-95 transition-all"
                title={label}
              >
                {icon}
                <span className="text-[9px] leading-none">{label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

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
            onSelect={e => {
              const ta = e.currentTarget;
              setHasSelection((ta.selectionEnd ?? 0) > (ta.selectionStart ?? 0));
            }}
            onBlur={() => setHasSelection(false)}
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
          className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 hover:bg-primary/30 text-primary transition-colors flex items-center justify-center active:scale-95 disabled:opacity-60"
        >
          {sending ? (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </motion.div>
  );
}
