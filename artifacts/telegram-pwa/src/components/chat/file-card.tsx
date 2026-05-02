import { useEffect, useState } from 'react';
import { Download, FileText, FileSpreadsheet, FileImage, FileVideo, FileAudio, FileCode, Archive, FileType } from 'lucide-react';

type Props = {
  url: string;
  name: string;
  isMine: boolean;
};

const sizeCache = new Map<string, number>();
const sizePending = new Map<string, Promise<number | null>>();

function fetchSize(url: string): Promise<number | null> {
  if (sizeCache.has(url)) return Promise.resolve(sizeCache.get(url)!);
  const inflight = sizePending.get(url);
  if (inflight) return inflight;
  const p = fetch(url, { method: 'HEAD' })
    .then((r) => {
      const len = r.headers.get('content-length');
      if (!len) return null;
      const n = parseInt(len, 10);
      if (!isFinite(n)) return null;
      sizeCache.set(url, n);
      return n;
    })
    .catch(() => null)
    .finally(() => { sizePending.delete(url); });
  sizePending.set(url, p);
  return p;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

export function getFileExtension(urlOrName: string): string {
  const clean = urlOrName.split('?')[0].split('#')[0];
  const m = clean.match(/\.([a-zA-Z0-9]{1,8})$/);
  return m ? m[1].toLowerCase() : '';
}

const ICON_BY_EXT: Record<string, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  doc: FileText, docx: FileText, odt: FileText, rtf: FileText, txt: FileText, md: FileText,
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, csv: FileSpreadsheet, ods: FileSpreadsheet,
  ppt: FileType, pptx: FileType, odp: FileType, key: FileType,
  zip: Archive, rar: Archive, '7z': Archive, tar: Archive, gz: Archive,
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, webp: FileImage, svg: FileImage, bmp: FileImage, heic: FileImage,
  mp4: FileVideo, webm: FileVideo, mov: FileVideo, avi: FileVideo, mkv: FileVideo,
  mp3: FileAudio, m4a: FileAudio, ogg: FileAudio, wav: FileAudio, opus: FileAudio, aac: FileAudio,
  js: FileCode, ts: FileCode, tsx: FileCode, jsx: FileCode, json: FileCode, html: FileCode, css: FileCode, py: FileCode, rb: FileCode, go: FileCode, rs: FileCode, java: FileCode, c: FileCode, cpp: FileCode, h: FileCode, sh: FileCode, yml: FileCode, yaml: FileCode, xml: FileCode,
};

export function FileCard({ url, name, isMine }: Props) {
  const ext = getFileExtension(name) || getFileExtension(url);
  const Icon = (ext && ICON_BY_EXT[ext]) || FileText;
  const [size, setSize] = useState<number | null>(() => sizeCache.get(url) ?? null);

  useEffect(() => {
    let alive = true;
    if (sizeCache.has(url)) { setSize(sizeCache.get(url)!); return; }
    fetchSize(url).then((n) => { if (alive) setSize(n); });
    return () => { alive = false; };
  }, [url]);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'document';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  // Subtitle: "EXT" or "EXT · 1.4 Mo"
  const subtitle = [
    ext ? ext.toUpperCase() : null,
    size != null ? formatSize(size) : null,
  ].filter(Boolean).join(' · ');

  // Color tokens — match the bubble style (white-on-violet for mine, glass for theirs)
  const containerClass = isMine
    ? 'bg-white/12 hover:bg-white/15 border border-white/15'
    : 'bg-foreground/[0.045] hover:bg-foreground/[0.07] border border-border/60';
  const nameClass = isMine ? 'text-white' : 'text-foreground';
  const subClass  = isMine ? 'text-white/65' : 'text-muted-foreground';
  const dlClass   = isMine ? 'text-white/85 hover:text-white' : 'text-primary/85 hover:text-primary';

  return (
    <div
      className={`mb-1.5 -mx-1.5 -mt-0.5 flex items-center gap-3 px-2.5 py-2 rounded-[10px] cursor-pointer active:scale-[0.99] transition-all select-none ${containerClass}`}
      onClick={handleDownload}
      role="button"
      aria-label={`Télécharger ${name}`}
    >
      {/* Icon block — violet gradient square with the file icon (Telegram-style) */}
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, hsl(263 90% 70%), hsl(280 85% 55%))',
          boxShadow: '0 4px 14px -3px hsl(263 90% 60% / 0.55)',
        }}
      >
        <Icon className="w-5 h-5 text-white" />
        {/* Extension chip in the corner */}
        {ext && ext.length <= 4 && (
          <span className="absolute bottom-0.5 right-0.5 text-[8px] font-bold text-white/90 leading-none px-1 py-0.5 rounded bg-black/30 uppercase tracking-tight">
            {ext}
          </span>
        )}
      </div>

      {/* Name + size */}
      <div className="flex-1 min-w-0">
        <p className={`text-[13.5px] font-semibold truncate leading-tight ${nameClass}`}>
          {name}
        </p>
        {subtitle && (
          <p className={`text-[11px] mt-0.5 leading-tight truncate ${subClass}`}>
            {subtitle}
          </p>
        )}
      </div>

      {/* Download button */}
      <Download className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${dlClass}`} />
    </div>
  );
}

/**
 * Detect whether a media URL refers to a document (anything that's not
 * an image or a video). Used by chat-area to route the bubble to FileCard
 * instead of CachedImg / VideoThumbnail.
 */
export function isDocumentUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const ext = getFileExtension(url);
  if (!ext) return false;
  const isImage = /^(png|jpe?g|gif|webp|svg|avif|bmp|heic|heif|ico)$/i.test(ext);
  const isVideo = /^(mp4|webm|mov|avi|mkv|m4v)$/i.test(ext);
  return !isImage && !isVideo;
}

/** Strip the leading 📎 emoji + space from a document message's content. */
export function stripDocPrefix(content: string | null | undefined): string {
  if (!content) return '';
  return content.replace(/^📎\s*/, '').trim();
}

/**
 * Whether a message should be rendered as a document (file card) rather than
 * an image / video bubble. Two independent signals:
 *
 *  • Primary: the synthetic "📎 <filename>" content payload our /uploads/document
 *    path emits. This catches the case where the user attached an image-typed
 *    file (jpg/png) through the Document picker — we still want a file card,
 *    not a photo bubble + duplicated filename row.
 *
 *  • Fallback: URL extension is non-image / non-video. This catches messages
 *    sent without our 📎 prefix, e.g. legacy data or future API additions.
 *
 * The 📎 detector requires a leading "📎 ", at least one non-space char, and
 * a single line — so a real user caption that happens to start with 📎 is
 * never collapsed.
 */
export function isDocumentMessage(
  msg: { content?: string | null; imageUrl?: string | null } | null | undefined,
): boolean {
  if (!msg || !msg.imageUrl) return false;
  if (msg.content && /^📎\s+\S/.test(msg.content) && !msg.content.includes('\n')) {
    return true;
  }
  return isDocumentUrl(msg.imageUrl);
}
