import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, X, Send, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { applyFormat } from './rich-text';
import type { FormatType } from './rich-text';
import { FormattingToolbar } from './formatting-toolbar';

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

// Compress an image file using canvas. Hardened so it can NEVER
// hang the send flow: every failure path resolves with the
// original file instead of leaving the promise pending.
async function compressImage(file: File, quality: MediaQuality): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    let settled = false;

    // Hard 8 s ceiling — if the browser silently fails to decode
    // a very large image, fail open with the original file
    // instead of leaving the user staring at a frozen spinner.
    const watchdog = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objUrl);
      resolve(file);
    }, 8000);

    const finish = (out: File) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      URL.revokeObjectURL(objUrl);
      resolve(out);
    };

    img.onload = () => {
      try {
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
        const ctx = canvas.getContext('2d');
        if (!ctx) { finish(file); return; }
        ctx.drawImage(img, 0, 0, w, h);

        canvas.toBlob(
          (blob) => {
            if (!blob) { finish(file); return; }
            finish(new File(
              [blob],
              file.name.replace(/\.[^.]+$/, '.jpg'),
              { type: 'image/jpeg' },
            ));
          },
          'image/jpeg',
          q,
        );
      } catch {
        // drawImage / toBlob can throw on mobile for very large
        // canvases (out-of-memory, max-canvas-size). Fall back
        // to the uncompressed original.
        finish(file);
      }
    };

    img.onerror = () => finish(file);
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
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const stripRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const longPressInputRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Drag-to-reorder state ──────────────────────────────────────────
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);

  // Block the native Android context menu on long-press in the caption field
  const handleCaptionTouchStart = useCallback(() => {
    if (longPressInputRef.current) clearTimeout(longPressInputRef.current);
    longPressInputRef.current = setTimeout(() => {
      const block = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
      document.addEventListener('contextmenu', block, { once: true, capture: true });
    }, 280);
  }, []);

  const handleCaptionTouchEnd = useCallback(() => {
    if (longPressInputRef.current) { clearTimeout(longPressInputRef.current); longPressInputRef.current = null; }
  }, []);

  const handleTextSelect = useCallback(() => {
    const ta = captionRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    setSelectionRange(start !== end ? { start, end } : null);
  }, []);

  const handleFormat = useCallback((fmt: FormatType) => {
    const ta = captionRef.current;
    if (!ta) return;
    const start = selectionRange?.start ?? ta.selectionStart ?? 0;
    const end = selectionRange?.end ?? ta.selectionEnd ?? 0;
    const { newText, newStart, newEnd } = applyFormat(caption, start, end, fmt);
    setCaption(newText);
    setSelectionRange(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newEnd, newEnd);
    });
  }, [caption, selectionRange]);

  const handleCopy = useCallback(() => {
    const ta = captionRef.current;
    if (!ta || !selectionRange) return;
    navigator.clipboard?.writeText(caption.slice(selectionRange.start, selectionRange.end));
  }, [caption, selectionRange]);

  const handlePaste = useCallback(async () => {
    const ta = captionRef.current;
    if (!ta) return;
    try {
      const text = await navigator.clipboard.readText();
      const start = ta.selectionStart ?? caption.length;
      const end = ta.selectionEnd ?? caption.length;
      const newCaption = caption.slice(0, start) + text + caption.slice(end);
      setCaption(newCaption);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + text.length, start + text.length);
      });
    } catch {}
  }, [caption]);

  const handleLinkRequest = useCallback(() => {
    setLinkMode(true);
    setLinkUrl('');
  }, []);

  const handleLinkConfirm = useCallback(() => {
    const ta = captionRef.current;
    if (!ta || !linkUrl) { setLinkMode(false); return; }
    const start = selectionRange?.start ?? ta.selectionStart ?? 0;
    const end = selectionRange?.end ?? ta.selectionEnd ?? 0;
    const { newText, newEnd } = applyFormat(caption, start, end, 'link', linkUrl);
    setCaption(newText);
    setSelectionRange(null);
    setLinkMode(false);
    setLinkUrl('');
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(newEnd, newEnd); });
  }, [caption, selectionRange, linkUrl]);

  const handleLinkCancel = useCallback(() => { setLinkMode(false); setLinkUrl(''); }, []);

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
      // Process each file independently so a single failing
      // compression can't poison the whole batch. Each promise
      // is wrapped to fall back to the original file on any
      // throw — combined with compressImage's own 8 s
      // watchdog, this guarantees the await below always
      // resolves and the spinner never spins forever.
      const processedFiles = await Promise.all(
        mediaFiles.map((m) =>
          m.type === 'image'
            ? compressImage(m.file, quality).catch(() => m.file)
            : Promise.resolve(m.file), // videos sent as-is
        ),
      );
      await onSend(processedFiles, caption.trim(), quality);
    } catch (err) {
      // Surface the failure in the console for diagnostics —
      // without this, a thrown onSend would just look like
      // "the button does nothing".
      console.error('[MediaPickerModal] send failed', err);
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
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 pt-safe glass gradient-hairline-bottom">
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
                  ? 'gradient-primary glow-primary-sm text-white'
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
      <div className="flex-shrink-0 py-2 glass">
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
                  isActive && dragIdx === null ? 'ring-2 ring-primary scale-105 glow-primary-sm' : ''
                } ${isDragged ? 'opacity-40 scale-95 ring-2 ring-primary' : ''}
                ${isOver ? 'ring-2 ring-primary/70 scale-110' : ''}
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

      {/* ── Formatting toolbar (same as chat — no double menu) ── */}
      <FormattingToolbar
        visible={true}
        hasSelection={!!selectionRange}
        linkMode={linkMode}
        linkUrl={linkUrl}
        onLinkUrlChange={setLinkUrl}
        onLinkConfirm={handleLinkConfirm}
        onLinkCancel={handleLinkCancel}
        onFormat={handleFormat}
        onLinkRequest={handleLinkRequest}
        onCopy={handleCopy}
        onPaste={handlePaste}
      />

      {/* ── Caption + Send ── */}
      <div
        className="flex-shrink-0 flex items-end gap-2 px-3 py-2 pb-safe glass gradient-hairline-top"
      >
        <div className="flex-1 rounded-2xl px-4 py-2.5 surface-elevated">
          <textarea
            ref={captionRef}
            value={caption}
            onChange={e => setCaption(e.target.value)}
            onSelect={handleTextSelect}
            onBlur={() => setSelectionRange(null)}
            onTouchStart={handleCaptionTouchStart}
            onTouchEnd={handleCaptionTouchEnd}
            onContextMenu={e => e.preventDefault()}
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
          className="flex-shrink-0 w-10 h-10 rounded-xl gradient-primary glow-primary-sm text-white transition-all flex items-center justify-center hover:opacity-95 active:scale-95 disabled:opacity-60"
        >
          {sending ? (
            // Spinner border was `border-primary` (purple) on a
            // purple `gradient-primary` button — invisible. Use
            // white so the user actually sees that the send is
            // in progress instead of a "filled-purple-blob"
            // button that looks broken.
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </motion.div>
  );
}
