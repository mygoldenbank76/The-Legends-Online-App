import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useListMessages, useGetConversation, useSendMessage,
  useMarkConversationRead, useAddReaction, useUploadImage,
  useEditMessage, useDeleteMessage, usePinMessage,
  getListMessagesQueryKey, getListConversationsQueryKey, getGetConversationQueryKey,
  listMessages,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useSocket, activeConversationIdRef } from '@/lib/socket-context';
import { usePreferences } from '@/lib/preferences-context';
import { translateGroupName } from '@/lib/i18n';
import { getAuthHeaders } from '@/lib/auth-fetch';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  ArrowLeft, Loader2, Send, Plus, Smile,
  Reply, Pin, Pencil, Trash2, Languages, X, Check, PinOff, MoreVertical, Link2,
  Mic, Copy, Heart, CheckCheck, ChevronDown,
  Search, Bell, BellOff, ChevronUp,
  Phone, Video as VideoIcon,
  Sparkles, Clock,
} from 'lucide-react';
import { format } from 'date-fns';
import { AttachmentSheet } from './attachment-sheet';
import { PollCreator } from './poll-creator';
import { PollMessage } from './poll-message';
import { AudioPlayer } from './audio-player';
import { VoiceRecorder } from './voice-recorder';
import { GroupInfoSheet } from './group-info-sheet';
import { UserProfileSheet } from './user-profile-sheet';
import { LinkPreviewCard } from './link-preview';
import { FormattingToolbar } from './formatting-toolbar';
import { RichText, applyFormat } from './rich-text';
import type { FormatType } from './rich-text';
import { GifPicker } from './gif-picker';
import { getMediaDimensions, captureVideoFirstFrame } from '@/lib/media-dimensions';
import { generateLqip } from '@/lib/lqip';
import { NativeComposer, isNativeComposerAvailable } from '@/lib/native-composer';
import type { PluginListenerHandle } from '@capacitor/core';
import type { GifResult } from './gif-picker';
import { MediaPickerModal, compressImage } from './media-picker-modal';
import type { MediaQuality } from './media-picker-modal';
import { MediaViewer } from './media-viewer';
import { CachedImg, InstantImg } from './cached-img';
import { DustEffect, DUST_DURATION } from './dust-effect';
import { UploadProgressOverlay } from './upload-progress-overlay';
import { uploadFileWithProgress, UploadAbortError } from '@/lib/upload-with-progress';
import { preloadMedia, registerBlob } from '@/lib/media-cache';
import { prewarmIframe } from '@/lib/iframe-pool';
import { VideoThumbnail, cacheVideoPosterBlob, cacheVideoAspect, getVideoPoster } from './video-thumbnail';
import { getCachedImageAspect, probeImageAspect } from '@/lib/image-aspect-cache';
import { FileCard, isDocumentUrl, isDocumentMessage, stripDocPrefix } from './file-card';
import { useCall } from '@/lib/call-context';
import { CallBanner } from './call-modal';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥'];
const PICKER_EMOJIS = ['😀','😂','🤣','😊','😍','🥰','😘','😋','😎','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','😡','😠','🤬','😷','🤒','🤕','🤢','🤮','🤧','😇','🥳','🥺','🤠','🤡','🤥','🤫','🤭','🧐','🤓','😈','👿','👹','👺','💀','👻','👽','👾','🤖'];

type PollOption = {
  id: number;
  text: string;
  voteCount: number;
  percentage: number;
  voters: number[];
};

type Poll = {
  id: number;
  question: string;
  isAnonymous: boolean;
  isMultipleChoice: boolean;
  isQuiz: boolean;
  totalVotes: number;
  userVotedOptionIds: number[];
  options: PollOption[];
};

type Msg = {
  id: number;
  conversationId: number;
  senderId: number;
  sender?: { id: number; displayName: string; username?: string; avatar?: string | null; bio?: string | null };
  content?: string | null;
  imageUrl?: string | null;
  // Multi-attachment "album" payload (Telegram-style 2-6 media grid).
  // Stored separately from imageUrl so a single message can carry both
  // (legacy compat) without requiring extra type guards at the call site.
  mediaAlbum?: string[] | null;
  // Server-generated thumbnail for video messages (or a low-res preview
  // of the imageUrl for very large originals). When present, the bubble
  // paints this immediately so the user sees something while the full
  // media streams from object storage.
  thumbnailUrl?: string | null;
  // Intrinsic dimensions captured server-side at upload time so we can
  // size the bubble on the very first paint, with no orientation flash.
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  // Tiny base64 LQIP (`data:image/jpeg;base64,…`) painted as a blurred
  // background BEHIND the photo so receivers see a recognisable preview
  // on the very first frame instead of an empty placeholder while the
  // multi-MB original streams from object storage.
  mediaPreview?: string | null;
  audioUrl?: string | null;
  audioDuration?: number | null;
  poll?: Poll | null;
  linkPreview?: { url: string; title?: string | null; description?: string | null; image?: string | null; platform?: string | null; embedUrl?: string | null; siteName?: string | null } | null;
  replyTo?: Msg | null;
  editedAt?: string | null;
  isDeleted?: boolean;
  status?: 'sent' | 'delivered' | 'read';
  callType?: 'audio' | 'video' | null;
  callStatus?: 'missed' | 'answered' | 'declined' | 'ongoing' | null;
  callDuration?: number | null;
  reactions: Array<{ id: number; messageId: number; userId: number; emoji: string }>;
  createdAt: string;
};

type ChatAreaProps = { conversationId: number; onBack?: () => void; onOpenConversation?: (convId: number) => void };
type CtxMenu = { msgId: number } | null;

// Optimistic upload entry shown as a fake outgoing bubble while files upload
type PendingUpload = {
  id: string;             // local unique id
  groupId: string;        // groups files sent together (single bubble / album)
  conversationId: number; // bound to the conversation it was started in
  file: File;
  previewUrl: string;     // blob URL for instant preview
  isVideo: boolean;
  loaded: number;         // bytes uploaded
  total: number;          // total bytes
  abort: AbortController;
  caption?: string;       // only first item of a group carries the caption
  replyToId?: number;
  startedAt: number;      // ms epoch — used to render the bubble's "sent at" time
  status: 'uploading' | 'sent'; // 'sent' = server already has the message; placeholder kept until the real msg appears in the list
  uploadedUrl?: string;   // server URL once the XHR completes
  width?: number;         // intrinsic media width (px), computed before upload
  height?: number;        // intrinsic media height (px), computed before upload
  // For video uploads only: the JPEG first-frame Blob captured locally
  // BEFORE upload starts. Drives two things:
  //  • the placeholder bubble shows the real first frame instead of a
  //    grey rectangle (so the upload UI matches the final loaded UI).
  //  • the same Blob is then uploaded as the server thumbnail in step 3
  //    — captured once, used twice.
  posterBlob?: Blob;
  posterUrl?: string;     // object URL for posterBlob; revoked on cleanup
  // Tiny base64 LQIP generated locally before upload, forwarded to the
  // server so every recipient gets a blurred preview baked into the
  // message JSON.
  lqip?: string;
};
type TranslateEntry = { msgId: number; text: string };

async function translateText(text: string, targetLang: string): Promise<string> {
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`);
  const d = await r.json();
  const translated = d.responseData?.translatedText;
  if (!translated || translated === text || d.responseStatus !== 200) {
    throw new Error('Traduction indisponible');
  }
  return translated;
}

// ── Media thumbnail cell ────────────────────────────────────────────────
function MediaThumb({
  url, onClick, overlay, radius = '0px',
}: {
  url: string; onClick: () => void; overlay?: React.ReactNode; radius?: string;
}) {
  const vid = /\.(mp4|webm|mov|avi|mkv)$/i.test(url);
  return (
    <div
      className="relative w-full h-full overflow-hidden bg-foreground/10 cursor-pointer active:opacity-80 transition-opacity"
      style={{ borderRadius: radius }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {vid ? (
        // Reuse the cached video poster (captured the first time the user
        // saw the video bubble). When present, it paints the real first
        // frame instantly with no decode round-trip — same UX as the
        // chat bubble. Falls back to a parked <video> for cold caches.
        (() => {
          const poster = getVideoPoster(url);
          return poster ? (
            <InstantImg src={poster} alt="" className="w-full h-full object-cover" />
          ) : (
            <video src={url} className="w-full h-full object-cover" style={{ background: '#000' }} muted playsInline preload="metadata" />
          );
        })()
      ) : (
        <CachedImg src={url} alt="" className="w-full h-full object-cover" />
      )}
      {vid && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-black/65 flex items-center justify-center shadow-lg">
            <div className="w-0 h-0 border-y-[7px] border-y-transparent border-l-[12px] border-l-white ml-1" />
          </div>
        </div>
      )}
      {overlay}
    </div>
  );
}

// ── Album grid (Telegram-style multi-media layout) ────────────────────────
function AlbumGrid({ urls, onItemClick, tightBottom = false }: { urls: string[]; onItemClick: (i: number) => void; tightBottom?: boolean }) {
  const count = urls.length;
  const shown = urls.slice(0, Math.min(count, 6));
  const gap = 2;

  // WhatsApp-style corner radius map (outer corners only) — match bubble radius
  const r = (tl: boolean, tr: boolean, bl: boolean, br: boolean) =>
    `${tl ? 10 : 1}px ${tr ? 10 : 1}px ${br ? 10 : 1}px ${bl ? 10 : 1}px`;

  // Symmetric 2px visible border on every side of the album when the
  // bubble is media-only (time-overlay variant): bubble pads 6px T/B
  // and 10px L/R, the album wrapper pulls -4px / -8px → 2px gap on
  // every edge. When a caption / reactions / link-preview row sits
  // below the album, fall back to mb-1 so the next row keeps its
  // breathing room.
  const wrap = (content: React.ReactNode) => (
    <div
      className={`${tightBottom ? '-mb-1' : 'mb-1'} -mx-2 -mt-1 overflow-hidden rounded-[10px]`}
      onClick={e => e.stopPropagation()}
    >
      {content}
    </div>
  );

  // ── 1 media ──────────────────────────────────────────────────────
  if (count === 1) return wrap(
    <div style={{ width: '100%', height: 260 }}>
      <MediaThumb url={shown[0]} onClick={() => onItemClick(0)} radius="10px" />
    </div>
  );

  // ── 2 media ──────────────────────────────────────────────────────
  if (count === 2) return wrap(
    <div style={{ display: 'flex', gap, height: 210 }}>
      <div style={{ flex: 1 }}>
        <MediaThumb url={shown[0]} onClick={() => onItemClick(0)} radius={r(true, false, true, false)} />
      </div>
      <div style={{ flex: 1 }}>
        <MediaThumb url={shown[1]} onClick={() => onItemClick(1)} radius={r(false, true, false, true)} />
      </div>
    </div>
  );

  // ── 3 media — left tall + right 2 stacked ────────────────────────
  if (count === 3) return wrap(
    <div style={{ display: 'flex', gap, height: 230 }}>
      <div style={{ flex: 1.4 }}>
        <MediaThumb url={shown[0]} onClick={() => onItemClick(0)} radius={r(true, false, true, false)} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap }}>
        <div style={{ flex: 1 }}>
          <MediaThumb url={shown[1]} onClick={() => onItemClick(1)} radius={r(false, true, false, false)} />
        </div>
        <div style={{ flex: 1 }}>
          <MediaThumb url={shown[2]} onClick={() => onItemClick(2)} radius={r(false, false, false, true)} />
        </div>
      </div>
    </div>
  );

  // ── 4 media — 2x2 ────────────────────────────────────────────────
  if (count === 4) return wrap(
    <div style={{ display: 'flex', flexDirection: 'column', gap, height: 240 }}>
      <div style={{ display: 'flex', gap, flex: 1 }}>
        <div style={{ flex: 1 }}>
          <MediaThumb url={shown[0]} onClick={() => onItemClick(0)} radius={r(true, false, false, false)} />
        </div>
        <div style={{ flex: 1 }}>
          <MediaThumb url={shown[1]} onClick={() => onItemClick(1)} radius={r(false, true, false, false)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap, flex: 1 }}>
        <div style={{ flex: 1 }}>
          <MediaThumb url={shown[2]} onClick={() => onItemClick(2)} radius={r(false, false, true, false)} />
        </div>
        <div style={{ flex: 1 }}>
          <MediaThumb url={shown[3]} onClick={() => onItemClick(3)} radius={r(false, false, false, true)} />
        </div>
      </div>
    </div>
  );

  // ── 5+ media — top 2 + bottom 3 ──────────────────────────────────
  return wrap(
    <div style={{ display: 'flex', flexDirection: 'column', gap, height: 280 }}>
      {/* Top row: 2 equal */}
      <div style={{ display: 'flex', gap, flex: 1.1 }}>
        <div style={{ flex: 1 }}>
          <MediaThumb url={shown[0]} onClick={() => onItemClick(0)} radius={r(true, false, false, false)} />
        </div>
        <div style={{ flex: 1 }}>
          <MediaThumb url={shown[1]} onClick={() => onItemClick(1)} radius={r(false, true, false, false)} />
        </div>
      </div>
      {/* Bottom row: 3 equal */}
      <div style={{ display: 'flex', gap, flex: 1 }}>
        <div style={{ flex: 1 }}>
          <MediaThumb url={shown[2]} onClick={() => onItemClick(2)} radius={r(false, false, true, false)} />
        </div>
        <div style={{ flex: 1 }}>
          <MediaThumb url={shown[3]} onClick={() => onItemClick(3)} radius="2px" />
        </div>
        <div style={{ flex: 1 }}>
          <MediaThumb
            url={shown[4]}
            onClick={() => onItemClick(4)}
            radius={r(false, false, false, true)}
            overlay={count > 6 ? (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <span className="text-white text-xl font-bold">+{count - 5}</span>
              </div>
            ) : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function SheetItem({
  icon, label, onClick, divider = false, danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  divider?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-foreground/5 transition-colors text-left
        ${divider ? 'border-t border-foreground/5' : ''}
        ${danger ? 'text-red-400' : 'text-foreground'}`}
      onClick={onClick}
    >
      <span className={danger ? 'text-red-400' : 'text-muted-foreground'}>{icon}</span>
      <span className="text-sm">{label}</span>
    </button>
  );
}

// ── Skeleton shown while messages load for the first time ─────────────────────
const SKELETON_ROWS = [
  { mine: false, w: '52%',  h: 40 },
  { mine: true,  w: '38%',  h: 40 },
  { mine: false, w: '68%',  h: 56 },
  { mine: true,  w: '55%',  h: 40 },
  { mine: false, w: '44%',  h: 40 },
  { mine: false, w: '72%',  h: 56 },
  { mine: true,  w: '62%',  h: 40 },
  { mine: true,  w: '35%',  h: 40 },
  { mine: false, w: '58%',  h: 40 },
  { mine: true,  w: '48%',  h: 40 },
];

function EmptyConversation({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none px-6 z-10"
      style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-[280px]"
      >
        {/* Outer glow halo */}
        <motion.div
          aria-hidden
          animate={{ opacity: [0.55, 0.85, 0.55] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -inset-5 rounded-[2rem] bg-gradient-to-br from-primary/30 via-fuchsia-500/15 to-cyan-400/25 blur-2xl"
        />
        {/* Glass card */}
        <div className="relative glass rounded-3xl border border-white/10 px-6 pt-7 pb-5 flex flex-col items-center text-center shadow-2xl overflow-hidden">
          {/* Sweeping shimmer — back and forth, no pause */}
          <motion.div
            aria-hidden
            initial={{ x: '-120%' }}
            animate={{ x: '120%' }}
            transition={{ duration: 3.2, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none"
          />
          {/* Animated icon assembly */}
          <div className="relative w-20 h-20 mb-4 flex items-center justify-center">
            {/* Pulsing aura */}
            <motion.div
              aria-hidden
              animate={{ scale: [1, 1.3, 1], opacity: [0.55, 0.18, 0.55] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/55 to-fuchsia-500/40 blur-xl"
            />
            {/* Rotating dashed ring */}
            <motion.div
              aria-hidden
              animate={{ rotate: 360 }}
              transition={{ duration: 9, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-1 rounded-full border-2 border-dashed border-primary/45"
            />
            {/* Counter-rotating thin ring */}
            <motion.div
              aria-hidden
              animate={{ rotate: -360 }}
              transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-[-4px] rounded-full border border-cyan-400/25"
            />
            {/* Floating inner orb */}
            <motion.div
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="relative w-12 h-12 rounded-full bg-gradient-to-br from-primary via-fuchsia-500 to-cyan-400 flex items-center justify-center"
              style={{ boxShadow: '0 0 28px rgba(124, 92, 255, 0.55), inset 0 0 12px rgba(255,255,255,0.15)' }}
            >
              <Sparkles className="w-6 h-6 text-white" strokeWidth={2.2} />
            </motion.div>
          </div>
          <h3 className="relative text-base font-semibold text-gradient-primary mb-1.5 leading-tight tracking-tight">
            {title}
          </h3>
          <p className="relative text-[13px] text-muted-foreground/90 leading-snug">
            {subtitle}
          </p>
        </div>
      </motion.div>
    </div>
  );
}

/* ── Ghost-click shield ──
   Transparent overlay that swallows pointer/click/touch events for the
   first 400 ms after ChatArea mounts. Without this, the synthesised
   click that follows pointerUp on the conversation row in the list lands
   inside the freshly-mounted chat (on a link, image, etc.). */
function GhostClickShield() {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setActive(false), 400);
    return () => clearTimeout(t);
  }, []);
  if (!active) return null;
  return (
    <div
      aria-hidden
      className="absolute inset-0 z-[9999]"
      style={{ background: 'transparent', touchAction: 'none' }}
      onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onTouchStartCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onTouchEndCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onPointerDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onPointerUpCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
    />
  );
}

function MessagesSkeleton() {
  return (
    <div className="flex flex-col justify-end gap-1.5 px-3 pb-3 pt-6 min-h-full">
      {/* Date pill */}
      <div className="flex justify-center mb-2">
        <div className="h-5 w-28 rounded-full animate-pulse bg-foreground/10" />
      </div>
      {SKELETON_ROWS.map((row, i) => (
        <div key={i} className={`flex items-end gap-2 ${row.mine ? 'justify-end' : 'justify-start'}`}>
          {!row.mine && (
            <div className="w-7 h-7 rounded-full flex-shrink-0 animate-pulse bg-foreground/10" />
          )}
          <div
            className={`rounded-2xl animate-pulse ${row.mine ? 'bg-primary/20' : 'bg-foreground/10'}`}
            style={{
              width: row.w,
              height: row.h,
              animationDelay: `${i * 60}ms`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function ChatArea({ conversationId, onBack, onOpenConversation }: ChatAreaProps) {
  const { user } = useAuth();
  const { socket, joinConversation, leaveConversation, emitTyping, typingUsers, presenceMap, roomPresenceMap } = useSocket();
  const { initiateCall } = useCall();
  const queryClient = useQueryClient();
  const { translateLanguage, t: uiT, appLanguage } = usePreferences();

  const { data: rawMessages, isLoading } = useListMessages(conversationId);
  const { data: conversation } = useGetConversation(conversationId);
  const markRead = useMarkConversationRead();
  const sendMsg = useSendMessage();
  const addReaction = useAddReaction();
  const uploadImage = useUploadImage();
  const editMsg = useEditMessage();
  const deleteMsg = useDeleteMessage();
  const pinMsg = usePinMessage();

  // Refs (declared early so they can be used in callbacks below)
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pagination state — older messages prepended when scrolling to top.
  // `loadedAllOlder` is the only piece of pagination state we keep — it's
  // set to true the moment loadMore() returns a short batch (less than the
  // server's page size of 50). Outside of that, "is there more history"
  // is fully derived from the messages payload synchronously, so the
  // first paint already shows the correct top marker (button vs
  // "— début … —" pill) — no flicker, no swap, no layout shift.
  const [olderMessages, setOlderMessages] = useState<Msg[]>([]);
  const [loadedAllOlder, setLoadedAllOlder] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevConvIdRef = useRef<number | null>(null);

  // Reset pagination when conversation changes
  useEffect(() => {
    if (prevConvIdRef.current !== conversationId) {
      setOlderMessages([]);
      setLoadedAllOlder(false);
      setLoadingMore(false);
      prevConvIdRef.current = conversationId;
    }
  }, [conversationId]);

  // Derived "is there more older history" — computed synchronously every
  // render. Three cases:
  //   1. We've explicitly hit the end during a paginated loadMore call
  //      (`loadedAllOlder` flipped to true) → no more.
  //   2. The user has already paginated at least once and the latest
  //      paginated batch was a full 50 → likely more (loadedAllOlder
  //      stays false; another loadMore tap is needed to confirm).
  //   3. No pagination yet → derive from the initial useListMessages
  //      payload size: a full page (50) means more probably exists,
  //      a short page means we already have everything.
  // While the initial fetch is still loading we *show* nothing in the
  // top slot anyway (gated on `messages.length > 0`), so it doesn't
  // matter what hasMore returns during that frame.
  const recentLen = (rawMessages as Msg[] | undefined)?.length ?? 0;
  const hasMore = !loadedAllOlder && (
    olderMessages.length > 0
      ? true
      : recentLen >= 50
  );

  // Merge: older pages first, then real-time messages, deduplicated by id
  const recentIds = new Set((rawMessages as Msg[] | undefined)?.map(m => m.id) ?? []);
  const dedupedOlder = olderMessages.filter(m => !recentIds.has(m.id));
  const allMessages = [...dedupedOlder, ...((rawMessages as Msg[] | undefined) ?? [])];
  const messages = allMessages.filter(m => !m.isDeleted);

  // Preload all media in the current conversation into memory the moment messages arrive
  useEffect(() => {
    for (const m of messages) {
      // Photos: pull into RAM. Videos and documents are skipped here (videos
      // because they're large and loaded on-demand by the player; documents
      // because they're only fetched on tap and don't need a poster). Use
      // isDocumentMessage so a JPG/PNG sent through the Document picker (📎
      // prefix in content) is also skipped — otherwise we'd waste RAM on a
      // file that renders as a tap-to-download card, not as a photo.
      if (m.imageUrl && !m.imageUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i) && !isDocumentMessage(m)) {
        preloadMedia(m.imageUrl);
        // For legacy messages whose intrinsic dimensions never made
        // it into the database, probe + cache the photo's aspect
        // ratio in the background. The image render below uses the
        // cached value to reserve the right shape on first paint of
        // the NEXT visit, eliminating the "ça bouge en entrant" jump.
        if ((!m.mediaWidth || !m.mediaHeight) && !getCachedImageAspect(m.imageUrl)) {
          probeImageAspect(m.imageUrl);
        }
      }
      // Voice notes / music: cache the blob in RAM so playback is instant
      // on revisit and there's no re-streaming when the user navigates away
      // and comes back.
      if (m.audioUrl) {
        preloadMedia(m.audioUrl);
      }
      if (m.mediaAlbum) {
        for (const url of m.mediaAlbum) {
          if (!url.match(/\.(mp4|webm|mov|avi|mkv)$/i) && !isDocumentUrl(url)) preloadMedia(url);
        }
      }
      if (m.replyTo?.imageUrl && !m.replyTo.imageUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i) && !isDocumentMessage(m.replyTo)) {
        preloadMedia(m.replyTo.imageUrl);
      }
      // Preload link preview images + pre-warm embeds (Spotify, YouTube)
      if (m.linkPreview?.image) {
        preloadMedia(m.linkPreview.image);
      }
      if (m.linkPreview?.embedUrl && m.linkPreview.platform === 'spotify') {
        prewarmIframe(m.linkPreview.embedUrl, {
          allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
          height: '152',
        });
      }
    }
  // Only re-run when message count changes (new messages arrive)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Load older messages on demand (triggered by the "show previous" button).
  // Auto-load on scroll-to-top was removed: it caused a layout shift on
  // entry — the IntersectionObserver fires immediately when the sentinel
  // is briefly inside the viewport during the very first paint (before
  // the scroll snaps to the bottom), which then prepends 50 messages and
  // visually "pushes" everything down. Replacing the trigger with an
  // explicit button means entering a conversation is now stable: what
  // you see on the first frame is what stays.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || isLoading) return;
    const oldestId = messages[0]?.id;
    if (!oldestId) return;
    setLoadingMore(true);
    try {
      const container = scrollRef.current;
      const prevScrollHeight = container?.scrollHeight ?? 0;
      const batch = await listMessages(conversationId, { before: oldestId, limit: 50 });
      if (!batch || batch.length === 0) { setLoadedAllOlder(true); return; }
      if (batch.length < 50) setLoadedAllOlder(true);
      setOlderMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const newBatch = (batch as Msg[]).filter(m => !existingIds.has(m.id));
        return [...newBatch, ...prev];
      });
      // Restore scroll position after prepend so the message the user was
      // looking at stays under their thumb (the new batch is added above).
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        }
      });
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, loadingMore, hasMore, isLoading, messages]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const addMoreMediaRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [mediaPicker, setMediaPicker] = useState<File[] | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // True while the IME (GBoard, Samsung Keyboard, iOS QuickType, …) is in
  // the middle of a composition session — i.e. the user is typing a word
  // with auto-suggest, picking an emoji from the keyboard panel, or
  // gliding/swiping a word. Updating React state during composition tears
  // down the textarea's internal IME buffer on Android, which is what
  // caused the long list of keyboard bugs (cursor jumps to end, can't
  // insert an emoji mid-text, can't backspace an emoji, suggestions
  // disappear, auto-capitalize stops working). We pause state updates
  // while composing and re-sync once the IME commits.
  const isComposingRef = useRef(false);
  const autoGrowRaf = useRef<number | null>(null);
  // Last value we received from / pushed to the native EditText overlay
  // (Android APK only). Used as an echo-suppression token so the JS-side
  // "push content to native" effect does not bounce the same value back
  // when it originated FROM native typing in the first place.
  const lastNativeValueRef = useRef<string | null>(null);
  // Flips to true once the addListener('valueChanged') + show() pair on
  // the native side have BOTH resolved. The content/placeholder sync
  // effects are gated on this so they cannot push setValue/show before
  // the bridge has its listener attached — otherwise an early sync would
  // race the user's first native keystrokes and silently drop them.
  const bridgeReadyRef = useRef(false);
  // True only on the Android APK build. Captured once at mount so the
  // value is stable across renders and we can use it for inline style
  // gates without re-querying Capacitor on every render.
  const useNativeComposer = isNativeComposerAvailable();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressInputTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didTriggerMenu = useRef(false);
  const didJustSwipe = useRef(false);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const isSwiping = useRef(false);
  // Guard: timestamp when this conversation was opened — prevents ghost-touch
  // from the navigation tap immediately triggering the long-press menu
  const conversationOpenedAt = useRef<number>(Date.now());
  const typingStopTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  // Messages currently playing the Telegram-style "dust" delete animation.
  // The bubble stays in the DOM for DUST_DURATION ms after the user clicks
  // Delete, so the dissolve animation can play before the row collapses.
  const [dustingIds, setDustingIds] = useState<Set<number>>(new Set());
  // Messages whose dust animation has FINISHED but whose row is still
  // mounted (because the API delete + refetch hasn't completed yet). These
  // rows are hidden via `return null` in the timeline render so the bubble
  // can never pop back into view between the animation ending and the row
  // unmounting. Cleared by the same GC effect as `dustingIds` once the
  // message is gone from the messages list.
  const [deadIds, setDeadIds] = useState<Set<number>>(new Set());
  // Optimistic uploads shown as fake bubbles with a circular progress ring
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const pendingUploadsRef = useRef<PendingUpload[]>([]);
  pendingUploadsRef.current = pendingUploads;
  // Per-URL "sending started at" anchor — keyed by the server URL once it's
  // known. Lets us pin a video message to the position where it was first
  // queued for upload, so when the swap from optimistic placeholder → real
  // server message happens, the bubble does NOT jump in front of any text
  // messages the user typed during the upload (Telegram-style sticky
  // position). The ref persists across renders for as long as the user
  // stays in this conversation; it is cleared on conversation switch.
  const mediaSendAnchorRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    // Reset anchors when navigating between conversations.
    mediaSendAnchorRef.current = new Map();
  }, [conversationId]);
  // Whenever an upload completes (uploadedUrl populated), record the
  // anchor BEFORE the cleanup effect removes the pending entry.
  useEffect(() => {
    for (const p of pendingUploads) {
      if (p.uploadedUrl) mediaSendAnchorRef.current.set(p.uploadedUrl, p.startedAt);
    }
  }, [pendingUploads]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editState, setEditState] = useState<{ id: number; orig: string; mediaLabel?: string } | null>(null);
  // ── Composer link preview (auto-fetched as user types) ──────────────────
  const [linkPreview, setLinkPreview] = useState<{
    url: string;
    title?: string | null;
    description?: string | null;
    image?: string | null;
    siteName?: string | null;
    platform?: string | null;
  } | null>(null);
  const [linkPreviewLoading, setLinkPreviewLoading] = useState(false);
  const dismissedUrlsRef = useRef<Set<string>>(new Set());
  // The URL currently detected in the composer (set by the debounce effect).
  // Used so that clicking "X" while still loading correctly remembers the URL
  // as dismissed even before the OG metadata arrives.
  const currentPreviewUrlRef = useRef<string | null>(null);
  const [translations, setTranslations] = useState<TranslateEntry[]>([]);
  const [translatingId, setTranslatingId] = useState<number | null>(null);
  const [swipeOffsets, setSwipeOffsets] = useState<Record<number, number>>({});
  const [swipingId, setSwipingId] = useState<number | null>(null);
  const [prevMsgCount, setPrevMsgCount] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  // New UI states
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
  const [pollCreatorOpen, setPollCreatorOpen] = useState(false);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [pinnedIdx, setPinnedIdx] = useState(0);

  // Header ⋮ dropdown
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);

  // In-conversation search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Mute: derived from server conversation data + local optimistic override
  const [mutedOverride, setMutedOverride] = useState<boolean | null>(null);
  const conversationWithMute = conversation as (typeof conversation & { isMuted?: boolean }) | undefined;
  const isMuted = mutedOverride !== null ? mutedOverride : (conversationWithMute?.isMuted ?? false);

  // Reset state when conversation changes
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchMatchIdx(0);
    setHeaderMenuOpen(false);
    setMutedOverride(null);
  }, [conversationId]);

  // Whenever the group info sheet is opened or closed, defensively
  // close all chat-area transient overlays. This prevents the chat
  // header 3-dot menu (or emoji/GIF panel) from being left in an
  // "open" state behind the group info portal and reappearing once
  // the user navigates back.
  useEffect(() => {
    setHeaderMenuOpen(false);
    setEmojiOpen(false);
    setGifOpen(false);
  }, [groupInfoOpen]);

  // Close ANY open transient overlay (emoji panel, GIF picker, header
  // 3-dot menu) on outside tap. Elements that should NOT count as
  // "outside" are marked with `data-overlay-region` (the overlay
  // content itself and its trigger button). Mark `transientClosedAt`
  // so a subsequent click on a message bubble — which is the very same
  // tap that dismissed the overlay — doesn't also open the message
  // context menu (the user only wanted to close the overlay).
  useEffect(() => {
    if (!emojiOpen && !gifOpen && !headerMenuOpen) return;
    // Document-level CAPTURE-phase listener: when a tap lands outside
    // any `[data-overlay-region]`, close the open overlays AND stop
    // propagation so the click never reaches the underlying element's
    // onClick handler (e.g. a message bubble that would otherwise open
    // its context menu). The intent of an outside-tap is purely to
    // dismiss — not to trigger the underlying action. We also stamp a
    // timestamp as a defensive fallback for any code path that still
    // relies on it (`openCtxMenu`).
    const handler = (e: Event) => {
      const target = e.target as Element | null;
      if (target && target.closest && target.closest('[data-overlay-region]')) return;
      setEmojiOpen(false);
      setGifOpen(false);
      setHeaderMenuOpen(false);
      transientClosedAt.current = Date.now();
      // Block the underlying click/tap from reaching any other handler.
      e.stopPropagation();
      if (typeof (e as any).stopImmediatePropagation === 'function') {
        (e as any).stopImmediatePropagation();
      }
    };
    document.addEventListener('click', handler, true);
    document.addEventListener('touchstart', handler, true);
    return () => {
      document.removeEventListener('click', handler, true);
      document.removeEventListener('touchstart', handler, true);
    };
  }, [emojiOpen, gifOpen, headerMenuOpen]);

  // Focus search input when opened (without autoFocus to avoid keyboard layout shift)
  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery('');
      setSearchMatchIdx(0);
      return;
    }
    // Small delay so the header transition is done before keyboard opens
    const t = setTimeout(() => searchInputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [searchOpen]);

  // Toggle mute via API
  const toggleMute = async () => {
    const next = !isMuted;
    setMutedOverride(next);
    setHeaderMenuOpen(false);
    try {
      await fetch(`/api/conversations/${conversationId}/mute`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ muted: next }),
      });
    } catch {
      setMutedOverride(null);
    }
  };

  // Search: compute matching message indices
  const searchMatches = searchQuery.trim().length >= 1
    ? messages.reduce<number[]>((acc, m, i) => {
        if (m.content?.toLowerCase().includes(searchQuery.toLowerCase())) acc.push(i);
        return acc;
      }, [])
    : [];

  // Scroll to search match
  const scrollToSearchMatch = useCallback((idx: number) => {
    if (!searchMatches.length) return;
    const msgId = messages[searchMatches[idx]]?.id;
    if (!msgId) return;
    const el = document.getElementById(`msg-${msgId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [searchMatches, messages]);

  // ── Deep-link: scroll to a specific message + flash highlight ──────────
  // Fired by home.tsx after a notification tap (`?msg=…` URL param OR an
  // SW postMessage with messageId). The message may not be loaded yet
  // (the user could be deep in older history while the deep-linked
  // message lives in the latest page) — we retry every 250 ms for ~3 s
  // before giving up so the freshly-fetched bubble has time to render.
  useEffect(() => {
    function flashMessage(msgId: number, attempt = 0) {
      const el = document.getElementById(`msg-${msgId}`);
      if (!el) {
        if (attempt < 12) {
          setTimeout(() => flashMessage(msgId, attempt + 1), 250);
        }
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const bubble =
        (el.querySelector('.bubble-sent, .bubble-received') as HTMLElement | null) ?? el;
      bubble.classList.remove('pinned-flash');
      void bubble.offsetWidth;
      bubble.classList.add('pinned-flash');
      setTimeout(() => bubble.classList.remove('pinned-flash'), 1700);
    }
    function onJump(e: Event) {
      const detail = (e as CustomEvent).detail as { conversationId?: number; messageId?: number } | undefined;
      if (!detail?.messageId) return;
      // Only react if this chat-area instance is showing the right
      // conversation — otherwise the parent will swap conversations
      // and the next mount of chat-area will catch a re-fired event.
      if (detail.conversationId != null && detail.conversationId !== conversation?.id) return;
      flashMessage(detail.messageId);
    }
    window.addEventListener('chat:scroll-to-message', onJump as EventListener);
    return () => window.removeEventListener('chat:scroll-to-message', onJump as EventListener);
  }, [conversation?.id]);

  // Reset match index when query changes (no auto-scroll — user navigates manually)
  useEffect(() => {
    setSearchMatchIdx(0);
  }, [searchQuery]);

  // Media viewer (full-screen lightbox)
  const [mediaViewer, setMediaViewer] = useState<{ urls: string[]; index: number } | null>(null);

  // Poll votes viewer state
  const [pollVotes, setPollVotes] = useState<{ optionText: string; voters: { id: number; displayName: string }[] }[] | null>(null);

  // User profile sheet (click on avatar/name in group)
  const [profileUser, setProfileUser] = useState<{ id: number; displayName: string; username?: string; avatar?: string | null; bio?: string | null; isOnline?: boolean } | null>(null);

  // Context menu: reactions/views sub-panels
  type Reader = { id: number; displayName: string; username: string; avatar: string | null; readAt: string | null };
  const [ctxPanel, setCtxPanel] = useState<'reactions' | 'views' | null>(null);
  const [ctxReaders, setCtxReaders] = useState<Reader[]>([]);
  const [ctxReadersLoading, setCtxReadersLoading] = useState(false);

  // @mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartIdx, setMentionStartIdx] = useState(-1);

  // ── Socket ──────────────────────────────────────────────────
  // Join the room when this conversation is opened, and leave it when the user
  // switches to another chat — this drives per-room "who is here right now"
  // presence so other members see the count drop instantly.
  useEffect(() => {
    if (!socket || !conversationId) return;
    joinConversation(conversationId);
    return () => { leaveConversation(conversationId); };
  }, [socket, conversationId, joinConversation, leaveConversation]);

  useEffect(() => {
    if (!socket) return;
    const fn = () => joinConversation(conversationId);
    socket.on('connect', fn);
    return () => { socket.off('connect', fn); };
  }, [socket, conversationId, joinConversation]);

  // ── Scroll ─────────────────────────────────────────────────
  const [scrollReady, setScrollReady] = useState(false);
  const scrollReadyConvRef = useRef<number | null>(null);
  // Forward-declared here (used to gate the initial-snap layout
  // effect below, but the ResizeObserver wiring lives further
  // down with the rest of the composer plumbing). `null` means
  // "not yet measured" — see the long comment near the
  // composerRef block below for why we MUST wait on a real
  // measurement before snapping.
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const prevComposerHeightRef = useRef(0);
  // The "settle" window after initial load is now PASSIVE: we no longer
  // forcibly snap-to-bottom on every height change. Instead we rely on
  // the browser's native scroll anchoring (CSS `overflow-anchor: auto`
  // on `.scroll-container`) to keep the visible content rock-stable
  // when subresources (YouTube iframes, audio waveforms, late-decoded
  // images) finish loading and grow their bubbles. The previous
  // ResizeObserver-driven re-pin was the actual cause of the
  // "messages get pushed when I arrive in a conversation" report —
  // every iframe handshake or image fade-in fired a `scrollTop =
  // scrollHeight` that visibly nudged the stack. Native anchoring
  // achieves the goal (you stay where you are, content above you can
  // grow freely) without ever moving a pixel of what you can see.
  const msgsWrapRef   = useRef<HTMLDivElement>(null);
  // Reset visibility when conversation changes
  useEffect(() => {
    setScrollReady(false);
    scrollReadyConvRef.current = null;
  }, [conversationId]);

  // Initial scroll — synchronous (before paint) to avoid flash.
  // Gate on `composerHeight !== null` so we don't snap with a
  // placeholder paddingBottom that's about to change one frame
  // later (which would visibly slide the last message downward
  // when the real, smaller composer height got measured by the
  // ResizeObserver). The composer's own useLayoutEffect always
  // runs first within the same render commit and writes the
  // real height synchronously, so this gate adds no perceptible
  // delay — it just guarantees correctness.
  useLayoutEffect(() => {
    if (!messages || messages.length === 0 || isLoading) return;
    if (composerHeight === null) return;
    if (scrollReadyConvRef.current === conversationId) return;
    scrollReadyConvRef.current = conversationId;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    setScrollReady(true);
  });

  // Settle-window re-pinning — kept in a SEPARATE effect, keyed
  // on stable scalars `[scrollReady, conversationId]`, so the
  // timers can't be cancelled by incidental re-renders. The
  // snap effect above derives a fresh `messages` array every
  // render (the parent does `.filter(...)` on each pass), so
  // adding `messages` to a deps array still flagged the effect
  // as "changed" every render and the cleanup would clear all
  // timers before any could fire — silently turning the fix
  // into a no-op. Keying purely on `scrollReady` (which flips
  // false→true exactly once per conversation, see the reset
  // effect above) and `conversationId` avoids that whole class
  // of bugs.
  //
  // Why we need this at all: chats with media (images / videos
  // / link previews / GIFs) paint their bubbles at a reserved
  // aspect-ratio height first, then grow once the asset
  // decodes. Native `overflow-anchor` keeps the visible
  // content stable while that happens, which is the WRONG
  // behaviour right after entering a chat — it would leave
  // the user looking at older media in the middle of the
  // viewport instead of the latest message at the bottom
  // (the user's report: "j'ouvre la conversation et ça me
  // monte vers les média alors que je devrais être en bas").
  // We re-pin to the bottom a handful of times over ~1.5 s
  // to stay glued there as media bubbles finish growing.
  // Each re-pin guards on `wasAtBottomRef` so a user who
  // has already scrolled up to read history is never yanked.
  useEffect(() => {
    if (!scrollReady) return;
    const targetConv = conversationId;
    const repin = () => {
      if (scrollReadyConvRef.current !== targetConv) return;
      if (!wasAtBottomRef.current) return;
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    };
    const t1 = window.setTimeout(repin, 50);
    const t2 = window.setTimeout(repin, 200);
    const t3 = window.setTimeout(repin, 500);
    const t4 = window.setTimeout(repin, 1000);
    const t5 = window.setTimeout(repin, 1500);
    return () => {
      window.clearTimeout(t1); window.clearTimeout(t2);
      window.clearTimeout(t3); window.clearTimeout(t4);
      window.clearTimeout(t5);
    };
  }, [scrollReady, conversationId]);

  const scrollBottom = useCallback((delay = 0) => {
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, delay);
  }, []);

  // Track whether user is pinned to the bottom (updated on every scroll)
  const wasAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  // ── Composer height tracking — used so messages list & scroll-to-bottom
  // button always sit above the floating composer, even when reply/edit
  // preview is added inside the pill (composer grows taller).
  //
  // `null` means "not yet measured". The messages-snap useLayoutEffect
  // gates on a non-null value so its very first snap-to-bottom uses the
  // REAL composer height for paddingBottom — not a guess. Without this
  // gate the snap ran with a 64-px placeholder, paint happened, then
  // the ResizeObserver fired ~16 ms later with the actual (smaller)
  // composer height, paddingBottom shrunk, and scrollTop got clamped
  // by the browser to the new max — visibly sliding the last message
  // DOWNWARD by the delta. That late shrink was the residual "content
  // pushes down on entry" sensation that survived removing the
  // settling-window pin and adding overflow-anchor: it wasn't anything
  // INSIDE the messages stack, it was the container's bottom padding
  // changing AFTER the snap.
  // composerRef / composerHeight / prevComposerHeightRef are
  // forward-declared above (next to the scroll state) so the
  // initial-snap useLayoutEffect can list `composerHeight` in
  // its dep array without a TDZ TypeScript error.
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    // Synchronous first measurement — runs before the next paint and
    // before the messages-snap useLayoutEffect fires its scrollTop
    // assignment, so the initial snap sees the right scrollHeight.
    const h0 = Math.round(el.getBoundingClientRect().height);
    if (h0 > 0) setComposerHeight(h0);
    // Keep observing for runtime changes (reply pill opening, multi-
    // line text expansion, link-preview chip appearing in the pill).
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const h = Math.round(entry.contentRect.height);
        if (h > 0) setComposerHeight(h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // When the composer grows (e.g. reply/edit preview shown) AND we were at
  // the bottom, immediately scroll to keep the last message visible.
  useEffect(() => {
    if (composerHeight === null) return;
    const prev = prevComposerHeightRef.current;
    if (composerHeight > prev && wasAtBottomRef.current && scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
    prevComposerHeightRef.current = composerHeight;
  }, [composerHeight]);

  // Direct trigger when reply/edit preview opens — pin scrollTop to scrollHeight
  // throughout the composer's height animation (Framer Motion ~280ms) so the
  // last message glides up smoothly in lockstep with the growing preview,
  // instead of jumping to bottom in one snap once the animation finishes.
  useEffect(() => {
    if (!replyTo && !editState) return;
    if (!wasAtBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    let cancelled = false;
    const start = performance.now();
    const DURATION = 320;
    const tick = () => {
      if (cancelled) return;
      el.scrollTop = el.scrollHeight;
      if (performance.now() - start < DURATION) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
    return () => { cancelled = true; };
  }, [replyTo, editState]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrollReady) return;
    const onScroll = () => {
      // Threshold un peu plus généreux (140 au lieu de 80) : sur APK Android
      // edge-to-edge la safe-area-inset-bottom (gesture bar ~24–48 px) +
      // la marge naturelle du dernier bubble peuvent décaler le scrollTop
      // de >80 px même quand l'utilisateur EST visuellement en bas, ce qui
      // faisait échouer la détection « at bottom » et empêchait l'auto-
      // scroll sur réception d'un message comme dans le PWA.
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      wasAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
      if (atBottom) setUnreadCount(0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollReady]);

  // Reset unread counter when switching conversation
  useEffect(() => { setUnreadCount(0); setIsAtBottom(true); }, [conversationId]);

  // Keep the chat pinned to the bottom across BOTH keyboard transitions
  // (open AND close). Previously we only re-pinned on open: when the
  // keyboard closed the viewport grew back, the composer reclaimed its
  // safe-area padding, the scroll container's clientHeight shrank by a
  // few dozen px and the scrollTop was no longer at the bottom — so the
  // user landed several messages above the latest one. Mirroring the
  // logic for the close transition fixes that.
  //
  // We use a 60-px threshold to ignore tiny intermediate resizes that
  // Android fires during the keyboard show/hide animation (and the
  // browser URL bar collapsing) — only real keyboard transitions
  // trigger the re-pin.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let prevHeight = vv.height;

    const onViewportResize = () => {
      const newHeight = vv.height;
      const delta = newHeight - prevHeight;
      const keyboardOpened = delta < -60;
      const keyboardClosed = delta > 60;
      prevHeight = newHeight;

      if ((keyboardOpened || keyboardClosed) && wasAtBottomRef.current) {
        // Wait for the layout to reflow (App.tsx sets #root height on the
        // same resize event) then snap to the bottom of the scroll container.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = scrollRef.current;
            if (!el) return;
            el.scrollTop = el.scrollHeight;
            // Belt-and-suspenders: a third frame in case the composer's
            // safe-area padding only settles after the first reflow on
            // some Android WebViews (Samsung, MIUI).
            requestAnimationFrame(() => {
              if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }
            });
          });
        });
      }
    };

    vv.addEventListener('resize', onViewportResize);
    return () => vv.removeEventListener('resize', onViewportResize);
  }, []);

  // Set to true when the LOCAL user sends something — guarantees a scroll-to-bottom
  // on the next message list update, regardless of current scroll position.
  const forceScrollRef = useRef(false);

  // Track the ID of the most recent (last) message to distinguish real-time
  // new messages from old messages loaded by pagination (which are prepended).
  const lastMsgIdRef = useRef<number | null>(null);

  // Mirror the messages-effect for OPTIMISTIC media uploads. Sending a
  // media doesn't grow `messages` (the server message arrives later),
  // it grows `pendingUploads`. Without this effect, sending a photo
  // while at the bottom showed the optimistic bubble half-hidden behind
  // the composer because the bubble's image was still decoding when the
  // single rAF-scheduled scrollBottom fired — once the image decoded a
  // few frames later, the bubble grew downward but no one re-pinned
  // scrollTop. We use the SAME forceScrollRef contract as the messages
  // effect (set by every send path) so the scroll behaviour is uniform
  // regardless of whether the user sent text, GIF, or an upload.
  const prevPendingCountRef = useRef(0);
  useEffect(() => {
    const count = pendingUploads.length;
    const prev = prevPendingCountRef.current;
    prevPendingCountRef.current = count;
    if (count <= prev) return;
    if (scrollReadyConvRef.current !== conversationId) return;
    if (!forceScrollRef.current) return;
    forceScrollRef.current = false;
    // Initial pin — bubble is now in the DOM with its aspect-ratio
    // height reservation in place.
    scrollBottom(0);
    // Re-pin a few frames later in case the image decoded slightly
    // taller than the reservation, OR in case dims weren't probed
    // in time and the bubble grew once the natural image kicked in.
    // 100 ms covers fast local files, 350 ms covers slower decodes
    // and the case where setPendingUploads + first paint were a few
    // frames apart due to React batching with other state updates.
    setTimeout(() => scrollBottom(0), 100);
    setTimeout(() => scrollBottom(0), 350);
  }, [pendingUploads.length, conversationId, scrollBottom]);

  useEffect(() => {
    const count = messages?.length ?? 0;
    const currentLastId = messages && messages.length > 0 ? messages[messages.length - 1].id : null;

    // Only auto-scroll on new messages (after initial load is done)
    if (scrollReadyConvRef.current === conversationId && count !== prevMsgCount) {
      const delta = count - prevMsgCount;
      setPrevMsgCount(count);

      // Did the last message ID change? → truly new messages received
      // Same last message ID → old messages loaded by pagination (prepended at start)
      const isReallyNew = currentLastId !== lastMsgIdRef.current && delta > 0;
      lastMsgIdRef.current = currentLastId;

      const el = scrollRef.current;
      if (forceScrollRef.current) {
        // User just sent something — always scroll to bottom (Telegram behaviour)
        forceScrollRef.current = false;
        scrollBottom(30);
      } else if (isReallyNew && el && el.scrollHeight - el.scrollTop - el.clientHeight < 350) {
        // Someone else sent and user was near the bottom — keep them there.
        // Threshold élargi (350) : sur APK edge-to-edge le composer + safe-
        // area-inset-bottom + marge du dernier bubble cumulent facilement
        // 200+ px, ce qui faisait que la condition échouait alors que
        // visuellement l'utilisateur était collé en bas → la nouvelle
        // bulle apparaissait sans pousser l'écran (pas comme le PWA).
        scrollBottom(30);
      } else if (isReallyNew) {
        // User is scrolled up reading history — show unread badge on the scroll button
        setUnreadCount(c => c + delta);
      }
      // else: old messages loaded by pagination — no scroll, no badge
    } else if (count !== prevMsgCount) {
      lastMsgIdRef.current = currentLastId;
      setPrevMsgCount(count);
    }
  }, [messages, prevMsgCount, conversationId, scrollBottom]);

  // Reset ghost-touch guard whenever we open a different conversation
  useEffect(() => { conversationOpenedAt.current = Date.now(); }, [conversationId]);

  // Track active conversation + zero badge immediately when entering any conversation.
  // This is a safety net; the primary zero-out happens in handleSelectConv (home.tsx).
  useEffect(() => {
    activeConversationIdRef.current = conversationId ?? null;
    if (conversationId) {
      queryClient.setQueryData(getListConversationsQueryKey(), (old: any[]) => {
        if (!Array.isArray(old)) return old;
        return old.map(conv =>
          conv.id === conversationId ? { ...conv, unreadCount: 0 } : conv
        );
      });
    }
    return () => { activeConversationIdRef.current = null; };
  }, [conversationId]);

  // Call the API to update lastReadAt on the server whenever we enter a conv or new messages arrive.
  useEffect(() => {
    if (!conversationId || !messages || messages.length === 0) return;
    markRead.mutate({ conversationId });
  }, [conversationId, messages?.length]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  }, [queryClient, conversationId]);

  // ── Send text ─────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    // Source-of-truth fix for emoji-only / IME-inserted text:
    // Samsung Keyboard (and several other Android IMEs) insert emojis and
    // some accented characters via the IME `setComposingText` / `commitText`
    // bridge. In a Capacitor WebView these calls update the underlying
    // <textarea> DOM value but do NOT always fire React's synthetic
    // `onChange`, so `content` state can stay stale (often empty) even
    // though the user clearly sees their text + emojis in the field.
    // Reading directly from the ref guarantees we send what the user sees.
    const liveValue = textareaRef.current?.value ?? content;
    if (editState) {
      const trimmed = liveValue.trim();
      if (!trimmed) return;
      setContent('');
      const id = editState.id;
      setEditState(null);
      try { await editMsg.mutateAsync({ messageId: id, data: { content: trimmed } }); invalidate(); }
      catch (e) { console.error(e); }
      return;
    }
    const trimmed = liveValue.trim();
    if (!trimmed || sending) return;
    const replyId = replyTo?.id;
    // Detect URL in the outgoing message and decide whether the backend
    // should attach a preview. If the user dismissed the preview for this
    // URL, tell the server to skip it.
    const mdMatch = trimmed.match(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
    const plainMatch = trimmed.match(/https?:\/\/[^\s]+/);
    let outUrl: string | null = null;
    if (mdMatch) outUrl = mdMatch[1];
    else if (plainMatch) outUrl = plainMatch[0];
    if (outUrl) outUrl = outUrl.replace(/[)\].,!?;:'"]+$/, '');
    const disableLinkPreview = !!(outUrl && dismissedUrlsRef.current.has(outUrl));
    setContent('');
    setReplyTo(null);
    setLinkPreview(null);
    setLinkPreviewLoading(false);
    setSending(true);
    // Stop typing indicator immediately on send
    if (typingStopTimeout.current) clearTimeout(typingStopTimeout.current);
    emitTyping(conversationId, false);
    try {
      forceScrollRef.current = true;
      await sendMsg.mutateAsync({
        conversationId,
        data: { content: trimmed, replyToId: replyId, ...(disableLinkPreview ? { disableLinkPreview: true } : {}) } as any,
      });
      invalidate();
    } catch { setContent(trimmed); forceScrollRef.current = false; }
    finally { setSending(false); }
  }, [content, sending, editState, replyTo, conversationId, sendMsg, editMsg, invalidate, scrollBottom, emitTyping]);

  // ── GIF send ──────────────────────────────────────────────
  // We download the GIF once in the sender's browser to derive (a) the
  // intrinsic width/height so every recipient's bubble lands at the
  // correct aspect on the first paint, and (b) a tiny blurred LQIP
  // (Telegram's `stripped_thumb` equivalent) so receivers see a
  // recognisable preview from the very first frame instead of an
  // empty/violet rectangle while the multi-MB GIF streams from Tenor /
  // Giphy. Both are sent inline with the message JSON so they reach
  // the server in a single round-trip — no background backfill, no
  // second request, no race. If the fetch fails (CORS, offline, …) we
  // silently fall back to the legacy "just imageUrl" path so a flaky
  // GIF provider can never break sending.
  const handleGifSelect = useCallback(async (gif: GifResult) => {
    if (sending) return;
    const replyId = replyTo?.id;
    setReplyTo(null);
    setSending(true);

    let mediaWidth: number | undefined;
    let mediaHeight: number | undefined;
    let mediaPreview: string | undefined;
    // Hard 1.5 s budget for the entire probe (fetch + decode + LQIP).
    // The probe is purely a UX optimization for receivers; if the
    // provider is slow or the GIF is huge, we'd rather send the
    // message immediately with no preview than make the SENDER wait
    // — they tapped Send, they expect Send to be near-instant.
    const ctrl = new AbortController();
    const probeTimeout = window.setTimeout(() => ctrl.abort(), 1500);
    try {
      const resp = await fetch(gif.url, { mode: 'cors', signal: ctrl.signal });
      if (resp.ok) {
        const blob = await resp.blob();
        // Probe dims via a transient <img> — much lighter than image-size.
        const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
          const objUrl = URL.createObjectURL(blob);
          const probe = new Image();
          const done = (out: { w: number; h: number } | null) => {
            try { URL.revokeObjectURL(objUrl); } catch { /**/ }
            resolve(out);
          };
          probe.onload = () => done({ w: probe.naturalWidth, h: probe.naturalHeight });
          probe.onerror = () => done(null);
          probe.src = objUrl;
        });
        if (dims && dims.w > 0 && dims.h > 0) {
          mediaWidth = dims.w;
          mediaHeight = dims.h;
        }
        const lqip = await generateLqip(blob).catch(() => null);
        if (lqip) mediaPreview = lqip;
      }
    } catch {
      // Provider blocked CORS, fetch aborted on timeout, or any other
      // failure — fall through and send the message without a
      // preview/dims. Receivers get the legacy behaviour, which is no
      // worse than before this change.
    } finally {
      window.clearTimeout(probeTimeout);
    }

    try {
      forceScrollRef.current = true;
      await sendMsg.mutateAsync({
        conversationId,
        data: {
          imageUrl: gif.url,
          replyToId: replyId,
          mediaWidth,
          mediaHeight,
          mediaPreview,
        } as any,
      });
      invalidate();
    } catch (e) { console.error(e); forceScrollRef.current = false; }
    finally { setSending(false); }
  }, [sending, replyTo, conversationId, sendMsg, invalidate, scrollBottom]);

  // ── @mention helpers ──────────────────────────────────────
  const participants: Array<{ id: number; displayName: string; username?: string; avatar?: string | null }> =
    (conversation as any)?.participants ?? [];

  const mentionSuggestions = mentionQuery !== null
    ? participants.filter(p =>
        p.id !== user?.id &&
        (
          p.displayName.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          (p.username || '').toLowerCase().includes(mentionQuery.toLowerCase())
        )
      ).slice(0, 6)
    : [];

  // Auto-grow the composer textarea up to 4 lines (Telegram-style).
  // Runs whenever `content` changes (including programmatic updates).
  // We schedule the measure inside requestAnimationFrame so the height
  // change happens AFTER the browser has painted the new character — on
  // Android, synchronously toggling style.height = 'auto' then back inside
  // the same input-event tick triggers a layout pass that resets the IME
  // composition span, which manifests as cursor-jumps to end of text.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (autoGrowRaf.current != null) cancelAnimationFrame(autoGrowRaf.current);
    autoGrowRaf.current = requestAnimationFrame(() => {
      autoGrowRaf.current = null;
      // Only collapse-then-grow if the rendered height truly differs from
      // what we want — skipping the redundant 'auto' assignment lets the
      // IME keep its internal selection state stable on Android.
      const desired = (() => {
        const prev = ta.style.height;
        ta.style.height = 'auto';
        // 100px ≈ 4 lines of text-sm (line-height ~20px) + py-2.5 padding.
        const h = Math.min(ta.scrollHeight, 100);
        ta.style.height = prev;
        return h;
      })();
      if (ta.style.height !== `${desired}px`) {
        ta.style.height = `${desired}px`;
      }
    });
    return () => {
      if (autoGrowRaf.current != null) {
        cancelAnimationFrame(autoGrowRaf.current);
        autoGrowRaf.current = null;
      }
    };
  }, [content]);

  // ─────────────────────────────────────────────────────────────────
  // NATIVE EDITTEXT BRIDGE (Android APK only — web is a no-op)
  //
  // The Chromium WebView intercepts IME input below our outer
  // SuggestionsWebView subclass, so the HTML <textarea> never gets
  // Samsung Keyboard's prediction strip, autocorrect or auto-capitalize
  // — and the layout-batching quirk that breaks textarea autogrow on
  // paste / emoji insert is also a WebView bug we cannot fix in JS.
  //
  // Solution: overlay a real native EditText (NativeComposerPlugin)
  // exactly on top of the HTML textarea. The HTML one is kept in the
  // DOM (visibility: hidden) so all layout / measurement / send-button
  // wiring still works against `content` state — we just stop rendering
  // its visual surface and let the EditText render text + caret on top.
  //
  // Three effects:
  //   1. Mount/unmount: register the valueChanged listener, call show()
  //      with the current content + placeholder, push the initial bounds.
  //   2. Bounds sync: ResizeObserver on the textarea + window resize +
  //      visualViewport resize (covers keyboard slide). Every change
  //      pushes the new rect to the native side.
  //   3. Content sync (JS → native): whenever `content` changes from a
  //      JS-side action (emoji panel insert, paste handler, send-clear,
  //      edit selection), push it via setValue. Echo-suppressed by
  //      lastNativeValueRef so native-typed values don't bounce back.
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!useNativeComposer) return;
    let cancelled = false;
    let listener: PluginListenerHandle | null = null;
    let selectionListener: PluginListenerHandle | null = null;
    (async () => {
      // Resolve the listener FIRST so we can attach it before show().
      // If the component already unmounted while the registration was
      // in flight, drop the listener immediately and bail — otherwise
      // we'd leak it and subsequent keystrokes would still call into
      // a dead React tree.
      const l = await NativeComposer.addListener('valueChanged', ({ value }) => {
        if (cancelled) return;
        lastNativeValueRef.current = value;
        setContent(value);
      });
      if (cancelled) { l.remove(); return; }
      listener = l;
      // Forward native selection changes to React state so the custom
      // FormattingToolbar (Copier / Coller / Gras / Italique / …) shows
      // on long-press instead of Android's system "Traduire / Couper /
      // Copier / Coller" bar (which we suppress on the native side).
      const sl = await NativeComposer.addListener('selectionChanged', ({ start, end }) => {
        if (cancelled) return;
        // Mirror the selection onto the (invisible) HTML textarea so
        // existing format handlers — which read textareaRef.current's
        // selectionStart/End — keep working unchanged.
        const ta = textareaRef.current;
        if (ta) {
          try { ta.setSelectionRange(start, end); } catch { /* ignore */ }
        }
        setSelectionRange(start !== end ? { start, end } : null);
      });
      if (cancelled) { sl.remove(); return; }
      selectionListener = sl;
      lastNativeValueRef.current = content;
      await NativeComposer.show({
        value: content,
        placeholder: editState ? uiT.chat.editPlaceholder : uiT.chat.placeholder,
      });
      if (cancelled) return;
      bridgeReadyRef.current = true;
    })();
    return () => {
      cancelled = true;
      bridgeReadyRef.current = false;
      if (listener) listener.remove();
      if (selectionListener) selectionListener.remove();
      NativeComposer.hide();
    };
    // Mount/unmount only. `content` and `editState` are intentionally
    // captured at mount-time — the dedicated content-sync effect below
    // pushes any later JS-side change to the native EditText, and the
    // placeholder edit-mode toggle is rare enough that we accept it
    // not updating live until a chat re-mount (avoiding a second show()
    // call here is what closed the mount-race the architect flagged).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useNativeComposer]);

  // Hide the native EditText overlay while a fullscreen React modal
  // (message action sheet, attachment sheet, media picker, etc) is
  // open. The native EditText is parented to the activity root and
  // always paints above the WebView, so without this the placeholder
  // / typed text bleeds through the modal backdrop on top of menu
  // items (user-reported: composer text visible over "Supprimer" in
  // the message action menu).
  useEffect(() => {
    if (!useNativeComposer) return;
    const anyModalOpen = !!ctxMenu || attachmentSheetOpen;
    void NativeComposer.setOverlayVisible({ visible: !anyModalOpen });
  }, [useNativeComposer, ctxMenu, attachmentSheetOpen]);

  // Bounds sync: keep the native EditText overlay glued to the HTML
  // textarea's on-screen rect. ResizeObserver covers content-driven
  // resizes (line wrap), `resize` covers orientation changes, and
  // visualViewport's `resize` covers the soft keyboard sliding the
  // viewport up/down.
  useEffect(() => {
    if (!useNativeComposer) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const push = () => {
      const r = ta.getBoundingClientRect();
      void NativeComposer.setBounds({
        x: r.left, y: r.top, width: r.width, height: r.height,
      });
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(ta);
    window.addEventListener('resize', push);
    window.visualViewport?.addEventListener('resize', push);
    window.visualViewport?.addEventListener('scroll', push);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', push);
      window.visualViewport?.removeEventListener('resize', push);
      window.visualViewport?.removeEventListener('scroll', push);
    };
  }, [useNativeComposer]);

  // Content sync (JS → native). Skipped when:
  //   - bridge is not yet ready (mount path still awaiting addListener
  //     + show); writing now would race the user's first keystrokes
  //     and lose them.
  //   - the value matches the last one we exchanged with native
  //     (echo): the EditText already shows it, re-pushing would just
  //     reset the cursor.
  useEffect(() => {
    if (!useNativeComposer) return;
    if (!bridgeReadyRef.current) return;
    if (lastNativeValueRef.current === content) return;
    lastNativeValueRef.current = content;
    void NativeComposer.setValue({ value: content });
  }, [content, useNativeComposer]);

  // Centralised "value has changed" handler. Reads the live DOM value
  // (NOT e.target.value) so it stays correct whether triggered by:
  //   • React's synthetic onChange (web, most cases),
  //   • the raw 'input' DOM event (Samsung IME emoji commits),
  //   • or onCompositionEnd flushing the final composed text.
  // Skips state updates while an IME composition is in progress — the
  // text shows up live in the DOM and we sync it on compositionend.
  const syncContentFromDom = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (isComposingRef.current) return;
    const value = ta.value;
    if (value !== content) setContent(value);
    if (value.trim()) setGifOpen(false);
    const cursor = ta.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursor);
    const match = textBeforeCursor.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionStartIdx(cursor - match[0].length);
    } else {
      setMentionQuery(null);
      setMentionStartIdx(-1);
    }
    // Typing indicator — emit start, debounce stop
    emitTyping(conversationId, true);
    if (typingStopTimeout.current) clearTimeout(typingStopTimeout.current);
    typingStopTimeout.current = setTimeout(() => { emitTyping(conversationId, false); }, 2500);
  }, [content, conversationId, emitTyping]);

  const handleContentChange = (_e: React.ChangeEvent<HTMLTextAreaElement>) => {
    syncContentFromDom();
  };

  // Belt-and-braces 'input' event listener: some Android IMEs (notably
  // Samsung Keyboard) commit emojis and glide-typed words via the IME
  // bridge in a way that updates the DOM but skips React's synthetic
  // onChange inside a Capacitor WebView. Mirroring the raw input event
  // keeps `content` in sync with what the user actually sees.
  const handleContentInput = (_e: React.FormEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current) return;
    syncContentFromDom();
  };

  // Re-assert keyboard hint attributes directly on the DOM node after
  // mount. React reflects `autoCapitalize` / `autoCorrect` / `spellCheck`
  // to the corresponding HTML attributes, but Samsung Keyboard (one of
  // the most common Android IMEs in our user base) only reads them on
  // its first inspection of the element. When the element is recreated
  // by React's reconciliation (e.g. switching conversation, toggling
  // edit-mode), Samsung Keyboard sometimes caches "no autocap" from a
  // previous lifecycle. Setting the attributes imperatively after every
  // mount guarantees the IME picks them up afresh, restoring the
  // expected "first letter of the message + first letter after a
  // period are auto-capitalised" behaviour.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.setAttribute('autocapitalize', 'sentences');
    ta.setAttribute('autocorrect', 'on');
    ta.setAttribute('spellcheck', 'true');
    // 'off' on Samsung = "this isn't a form-fill field" → keyboard
    // shows its word-prediction strip instead of the form toolbar.
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('enterkeyhint', 'send');
  }, [conversationId, editState]);

  const handleCompositionStart = () => {
    isComposingRef.current = true;
  };

  const handleCompositionEnd = () => {
    // Defer one tick so the textarea's `value` reflects the final
    // committed composition before we read it (some IMEs fire 'end'
    // BEFORE the underlying value has settled).
    isComposingRef.current = false;
    requestAnimationFrame(() => {
      // Guard against a new composition starting in the same frame.
      if (isComposingRef.current) return;
      syncContentFromDom();
    });
  };

  const handleMentionSelect = (p: { id: number; displayName: string; username?: string }) => {
    const name = p.username || p.displayName;
    const before = content.slice(0, mentionStartIdx);
    const after = content.slice(mentionStartIdx + 1 + (mentionQuery?.length ?? 0));
    const newContent = `${before}@${name} ${after}`;
    setContent(newContent);
    setMentionQuery(null);
    setMentionStartIdx(-1);
    setTimeout(() => {
      if (textareaRef.current) {
        const pos = before.length + name.length + 2; // @name + space
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  // ── Composer link preview: detect URL in `content`, debounce-fetch OG ──
  useEffect(() => {
    // Mirror backend extractFirstUrl logic
    const mdMatch = content.match(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
    const plainMatch = content.match(/https?:\/\/[^\s]+/);
    let url: string | null = null;
    if (mdMatch) url = mdMatch[1];
    else if (plainMatch) url = plainMatch[0];
    if (url) url = url.replace(/[)\].,!?;:'"]+$/, '');

    // No URL → clear
    if (!url) {
      currentPreviewUrlRef.current = null;
      setLinkPreview(null);
      setLinkPreviewLoading(false);
      return;
    }
    // Track latest detected URL even before fetch starts (for dismiss-during-loading)
    currentPreviewUrlRef.current = url;
    // Dismissed by user → don't show
    if (dismissedUrlsRef.current.has(url)) {
      setLinkPreview(null);
      setLinkPreviewLoading(false);
      return;
    }
    // Already loaded for this URL → keep
    if (linkPreview?.url === url) return;

    setLinkPreviewLoading(true);
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch('/api/link-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() } as Record<string, string>,
          body: JSON.stringify({ url }),
        });
        const json = await res.json();
        if (cancelled) return;
        // Stale-write guard: only apply if this URL is still the one detected.
        if (currentPreviewUrlRef.current !== url) return;
        if (dismissedUrlsRef.current.has(url)) {
          setLinkPreview(null);
        } else if (json?.preview) {
          setLinkPreview(json.preview);
        } else {
          setLinkPreview(null);
        }
      } catch {
        if (!cancelled && currentPreviewUrlRef.current === url) setLinkPreview(null);
      } finally {
        if (!cancelled && currentPreviewUrlRef.current === url) setLinkPreviewLoading(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // Render message text with @mentions highlighted
  const handleTextSelect = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    setSelectionRange(start !== end ? { start, end } : null);
  };

  // Also listen to native selectionchange for reliable mobile selection detection
  useEffect(() => {
    const onSelChange = () => {
      const ta = textareaRef.current;
      if (!ta || document.activeElement !== ta) return;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      setSelectionRange(start !== end ? { start, end } : null);
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, []);

  const handleFormat = (fmt: FormatType) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = selectionRange?.start ?? ta.selectionStart ?? 0;
    const end = selectionRange?.end ?? ta.selectionEnd ?? 0;
    if (start === end) return;
    const { newText, newEnd } = applyFormat(content, start, end, fmt);
    setContent(newText);
    setSelectionRange(null);
    setTimeout(() => {
      ta.setSelectionRange(newEnd, newEnd);
      // On Android the visible caret lives in the native EditText, not
      // the hidden textarea — push the post-format cursor across the
      // bridge and re-focus the native field so the keyboard stays up
      // and the user types at the right place.
      if (isNativeComposerAvailable()) {
        void NativeComposer.setSelection({ start: newEnd, end: newEnd });
        void NativeComposer.focus();
      } else {
        ta.focus();
      }
    }, 0);
  };

  const handleLinkRequest = () => {
    setLinkMode(true);
    setLinkUrl('');
  };

  const handleLinkConfirm = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = selectionRange?.start ?? ta.selectionStart ?? 0;
    const end = selectionRange?.end ?? ta.selectionEnd ?? 0;
    const url = linkUrl.trim()
      ? (linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`)
      : '';
    if (start !== end && url) {
      const { newText, newEnd } = applyFormat(content, start, end, 'link', url);
      setContent(newText);
      setTimeout(() => {
        ta.setSelectionRange(newEnd, newEnd);
        if (isNativeComposerAvailable()) {
          void NativeComposer.setSelection({ start: newEnd, end: newEnd });
          void NativeComposer.focus();
        } else {
          ta.focus();
        }
      }, 0);
    }
    setLinkMode(false);
    setLinkUrl('');
    setSelectionRange(null);
  };

  const handleLinkCancel = () => {
    setLinkMode(false);
    setLinkUrl('');
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleCopy = useCallback(async () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = selectionRange?.start ?? ta.selectionStart ?? 0;
    const end = selectionRange?.end ?? ta.selectionEnd ?? 0;
    if (start === end) return;
    const selected = content.slice(start, end);
    try { await navigator.clipboard.writeText(selected); } catch { /* ignore */ }
  }, [content, selectionRange]);

  const handlePaste = useCallback(async () => {
    const ta = textareaRef.current;
    if (!ta) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const start = ta.selectionStart ?? content.length;
      const end = ta.selectionEnd ?? content.length;
      const newText = content.slice(0, start) + text + content.slice(end);
      setContent(newText);
      const newCursor = start + text.length;
      setTimeout(() => {
        ta.setSelectionRange(newCursor, newCursor);
        if (isNativeComposerAvailable()) {
          void NativeComposer.setSelection({ start: newCursor, end: newCursor });
          void NativeComposer.focus();
        } else {
          ta.focus();
        }
      }, 0);
    } catch { /* permission denied or no clipboard */ }
  }, [content]);

  // Intercept long-press on the input to block native Android selection toolbar
  const handleInputTouchStart = useCallback((e: React.TouchEvent) => {
    if (longPressInputTimer.current) clearTimeout(longPressInputTimer.current);
    longPressInputTimer.current = setTimeout(() => {
      // Block the contextmenu event that follows a long-press on Android
      const block = (ce: Event) => { ce.preventDefault(); ce.stopPropagation(); };
      document.addEventListener('contextmenu', block, { once: true, capture: true });
    }, 280);
  }, []);

  const handleInputTouchEnd = useCallback(() => {
    if (longPressInputTimer.current) { clearTimeout(longPressInputTimer.current); longPressInputTimer.current = null; }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery !== null && mentionSuggestions.length > 0) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleMentionSelect(mentionSuggestions[0]);
        return;
      }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    if (e.key === 'Escape') { setEditState(null); setReplyTo(null); setContent(''); }
  };

  // ── Auth helper for manual fetch (must be before file/voice handlers) ─────
  const authFetch = useCallback((url: string, opts: RequestInit = {}) => {
    const token = localStorage.getItem('telechat_token') || '';
    return fetch(url, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        'Authorization': `Bearer ${token}`,
      },
    });
  }, []);

  // ── File handlers ──────────────────────────────────────────
  // Gallery: open the media picker modal for preview/caption/quality
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setMediaPicker(files);
    if (e.target) e.target.value = '';
  };

  // Camera: also open modal (single file)
  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setMediaPicker(files);
    if (e.target) e.target.value = '';
  };

  // Cancel an in-flight upload (clicking the X over the progress ring)
  const cancelPendingUpload = useCallback((id: string) => {
    const entry = pendingUploadsRef.current.find(p => p.id === id);
    if (entry) entry.abort.abort();
  }, []);

  // Abort all pending uploads + revoke blob URLs when the chat area unmounts.
  useEffect(() => {
    return () => {
      for (const p of pendingUploadsRef.current) {
        p.abort.abort();
        URL.revokeObjectURL(p.previewUrl);
        if (p.posterUrl) URL.revokeObjectURL(p.posterUrl);
      }
    };
  }, []);

  // Dedicated upload-conversation ref (do NOT reuse prevConvIdRef from the
  // pagination effect — that one runs first and would always make this
  // condition false). When the conversation changes, abort + revoke all
  // pending uploads from the previous conversation.
  const uploadConvIdRef = useRef(conversationId);
  useEffect(() => {
    if (uploadConvIdRef.current !== conversationId) {
      const stale = pendingUploadsRef.current;
      if (stale.length > 0) {
        stale.forEach(p => {
          p.abort.abort();
          URL.revokeObjectURL(p.previewUrl);
          if (p.posterUrl) URL.revokeObjectURL(p.posterUrl);
        });
        setPendingUploads([]);
      }
      uploadConvIdRef.current = conversationId;
    }
  }, [conversationId]);

  // Called by MediaPickerModal when user hits send.
  // Telegram-style flow: instant optimistic preview, real upload via XHR with
  // progress events, ability to cancel mid-upload, then the real message is
  // sent with the resulting URL(s) and the placeholder is removed.
  const handleMediaSend = useCallback(async (
    files: File[],
    caption: string,
    quality: MediaQuality,
  ) => {
    setMediaPicker(null);
    if (files.length === 0) return;

    const groupId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const targetConvId = conversationId;
    const replyId = replyTo?.id;
    setReplyTo(null);

    // 1. Compute intrinsic dimensions AND, for videos, capture the first
    //    frame in parallel BEFORE we paint the optimistic bubble. This
    //    way the placeholder lands at the correct aspect ratio AND with
    //    the real video poster on the very first paint — visually
    //    identical to the final loaded bubble, so the swap is invisible
    //    and there's no "uploading shows grey rectangle, loaded shows
    //    real thumbnail" jump the user reported.
    //
    //    Both helpers have hard timeouts so this never makes "Send" feel
    //    laggy: getMediaDimensions caps at 4 s, captureVideoFirstFrame
    //    at 6 s. In practice both finish in under 300 ms on real videos.
    const prepResults = await Promise.all(
      files.map(async (f) => {
        const isVideo = f.type.startsWith('video/');
        const [dims, posterBlob] = await Promise.all([
          getMediaDimensions(f).catch(() => null),
          isVideo ? captureVideoFirstFrame(f).catch(() => null) : Promise.resolve(null),
        ]);
        // LQIP: blurred preview for the recipient. For images we work
        // straight from the file; for videos we feed the just-captured
        // first-frame poster so the placeholder is also a recognisable
        // freeze frame instead of black bars. Best-effort — failures
        // resolve to null and the message goes out without an LQIP.
        const lqipSource: File | Blob | null = isVideo ? posterBlob : f;
        const lqip = lqipSource ? await generateLqip(lqipSource).catch(() => null) : null;
        return { dims, posterBlob, lqip };
      }),
    );

    // 2. Build optimistic entries (blob URLs → instant preview) carrying
    //    both the dimensions and the captured first-frame poster from
    //    the start.
    const startedAt = Date.now();
    const entries: PendingUpload[] = files.map((file, idx) => {
      const posterBlob = prepResults[idx].posterBlob ?? undefined;
      return {
        id: `${groupId}-${idx}`,
        groupId,
        conversationId: targetConvId,
        file,
        previewUrl: URL.createObjectURL(file),
        isVideo: file.type.startsWith('video/'),
        loaded: 0,
        total: file.size,
        abort: new AbortController(),
        caption: idx === 0 ? caption : undefined,
        replyToId: replyId,
        startedAt,
        status: 'uploading',
        width: prepResults[idx].dims?.width,
        height: prepResults[idx].dims?.height,
        posterBlob,
        posterUrl: posterBlob ? URL.createObjectURL(posterBlob) : undefined,
        lqip: prepResults[idx].lqip ?? undefined,
      };
    });

    setPendingUploads(prev => [...prev, ...entries]);
    forceScrollRef.current = true;
    // Defer scroll so the new bubbles are in the DOM before we measure
    requestAnimationFrame(() => scrollBottom(0));

    // 3. Upload all files in parallel with progress + cancellation.
    //    If any single upload fails or is cancelled, abort the WHOLE group
    //    so we don't leave orphan in-flight uploads in the background.
    const abortGroup = () => entries.forEach(e => {
      if (!e.abort.signal.aborted) e.abort.abort();
    });

    let aborted = false;
    let urls: string[] = [];
    // Thumbnail URLs for video entries, indexed by position in `entries`.
    // For non-video entries (or videos whose first-frame capture failed)
    // the slot stays `null` and the message goes out without a thumbnail.
    let thumbUrls: Array<string | null> = entries.map(() => null);
    try {
      const uploaded = await Promise.all(
        entries.map(async (entry, idx) => {
          try {
            // Run the main media upload AND the (video-only) first-frame
            // thumbnail capture+upload in parallel so the thumbnail
            // round-trip never delays the actual send. The thumbnail
            // upload is best-effort: a failure resolves to null so the
            // message still goes through, just without a server poster.
            // Lazy compression: compress AFTER the optimistic
            // bubble is already painted, so the user sees the
            // chat update instantly. Compression typically
            // adds <300 ms to the upload start; for videos
            // (or if compression fails/times out) we fall back
            // to the original file unchanged.
            //
            // Abort-aware: if the user cancels (entry.abort)
            // while compression is in flight, race it against
            // the abort signal so cancellation is immediate
            // instead of waiting up to 8 s for the compress
            // watchdog to fire.
            let fileToUpload: File;
            if (entry.isVideo) {
              fileToUpload = entry.file;
            } else if (entry.abort.signal.aborted) {
              throw new UploadAbortError();
            } else {
              fileToUpload = await new Promise<File>((resolve, reject) => {
                let settled = false;
                const onAbort = () => {
                  if (settled) return;
                  settled = true;
                  entry.abort.signal.removeEventListener('abort', onAbort);
                  reject(new UploadAbortError());
                };
                entry.abort.signal.addEventListener('abort', onAbort);
                compressImage(entry.file, quality)
                  .catch(() => entry.file)
                  .then((out) => {
                    if (settled) return;
                    settled = true;
                    entry.abort.signal.removeEventListener('abort', onAbort);
                    resolve(out);
                  });
              });
            }
            const [mainResult, thumbUrl] = await Promise.all([
              uploadFileWithProgress<{ url: string }>(
                '/api/uploads/image',
                fileToUpload,
                'file',
                {
                  signal: entry.abort.signal,
                  onProgress: ({ loaded, total }) => {
                    setPendingUploads(prev => prev.map(p =>
                      p.id === entry.id ? { ...p, loaded, total } : p
                    ));
                  },
                },
              ),
              entry.isVideo && entry.posterBlob
                ? (async () => {
                    // Reuse the Blob already captured in step 1 (used to
                    // paint the placeholder poster) — never recapture.
                    if (entry.abort.signal.aborted) return null;
                    try {
                      const thumbFile = new File(
                        [entry.posterBlob!],
                        `thumbnail-${entry.id}.jpg`,
                        { type: 'image/jpeg' },
                      );
                      const r = await uploadFileWithProgress<{ url: string }>(
                        '/api/uploads/image',
                        thumbFile,
                        'file',
                        { signal: entry.abort.signal },
                      );
                      return r.url;
                    } catch {
                      return null; // best-effort
                    }
                  })()
                : Promise.resolve(null as string | null),
            ]);
            return { url: mainResult.url, thumbUrl, idx };
          } catch (err) {
            abortGroup();
            throw err;
          }
        }),
      );
      urls = uploaded.map(u => u.url);
      thumbUrls = uploaded.map(u => u.thumbUrl);
    } catch (err) {
      if (err instanceof UploadAbortError) {
        aborted = true;
      } else {
        console.error('Upload error:', err);
      }
    }

    // 3a. If aborted or any upload failed, remove the placeholders now and
    //     stop — no message will be posted.
    if (aborted || urls.length !== entries.length) {
      entries.forEach(p => {
        URL.revokeObjectURL(p.previewUrl);
        if (p.posterUrl) URL.revokeObjectURL(p.posterUrl);
      });
      setPendingUploads(prev => prev.filter(p => !entries.some(e => e.id === p.id)));
      return;
    }

    // 3b. Stale-session guard: if user switched away from this conversation
    //     while uploads were running, drop the result instead of posting it
    //     to a different (now-active) conversation.
    if (uploadConvIdRef.current !== targetConvId) {
      entries.forEach(p => {
        URL.revokeObjectURL(p.previewUrl);
        if (p.posterUrl) URL.revokeObjectURL(p.posterUrl);
      });
      setPendingUploads(prev => prev.filter(p => !entries.some(e => e.id === p.id)));
      return;
    }

    // 4. Mark each entry as 'sent' with its server URL. We DO NOT remove
    //    the placeholders here — the cleanup effect below removes them
    //    only once the matching real messages appear in the list. This
    //    avoids the "vanish then reappear" flash the user reported.
    setPendingUploads(prev => prev.map(p => {
      const e = entries.find(x => x.id === p.id);
      if (!e) return p;
      const idx = entries.indexOf(e);
      return { ...p, status: 'sent', uploadedUrl: urls[idx], loaded: p.total };
    }));

    // 4b. Pre-populate the media caches keyed by the freshly uploaded
    //     server URLs, BEFORE the message POST goes out. By the time the
    //     server's WebSocket emit lands and the real message replaces
    //     the optimistic placeholder:
    //
    //       • Photos: <CachedImg src={url}/> hits the in-memory blob
    //         registered here and paints from RAM on the very first
    //         frame — no fetch, no decode flash, no "violet square"
    //         gap the user reported during the swap.
    //
    //       • Videos: VideoThumbnail finds the captured first-frame
    //         poster + aspect ratio already in cache and paints them
    //         instantly. Both poster + aspect are also persisted to
    //         localStorage so the same instant paint applies on every
    //         future page load for the sender.
    entries.forEach((e, idx) => {
      const url = urls[idx];
      if (!url) return;
      if (e.isVideo) {
        if (e.posterBlob) cacheVideoPosterBlob(url, e.posterBlob);
        if (e.width && e.height && e.height > 0) {
          cacheVideoAspect(url, e.width / e.height);
        }
      } else {
        // Photos: register the original File so the next CachedImg
        // render keyed by `url` paints from RAM. Independent of the
        // optimistic preview blob URL, which is still revoked on
        // cleanup — the cache mints its own object URL.
        registerBlob(url, e.file);
      }
    });

    // 5. Send the real message with the uploaded URL(s). Dimensions were
    //    resolved up-front (step 1) so the URL and width/height always
    //    land on the server together — no race possible.
    try {
      forceScrollRef.current = true;
      if (urls.length === 1) {
        // Single image/video: forward the intrinsic dimensions so the
        // server stores them and every client (including future page
        // loads) can render the bubble at the correct shape instantly.
        // For videos we also forward the captured first-frame thumbnail
        // URL so receivers see a real poster on the very first paint —
        // no per-device decoding needed, no momentary black box.
        const e0 = entries[0];
        await sendMsg.mutateAsync({
          conversationId: targetConvId,
          data: {
            imageUrl: urls[0],
            content: caption || undefined,
            replyToId: replyId,
            mediaWidth: e0.width,
            mediaHeight: e0.height,
            thumbnailUrl: thumbUrls[0] ?? undefined,
            mediaPreview: e0.lqip,
          } as any,
        });
      } else {
        await sendMsg.mutateAsync({
          conversationId: targetConvId,
          data: { mediaAlbum: urls, content: caption || undefined, replyToId: replyId } as any,
        });
      }
      invalidate();
    } catch (err) {
      console.error('Send message error:', err);
      // Send failed → remove the (now stuck) placeholders so the user isn't
      // left looking at frozen "sent" bubbles forever.
      entries.forEach(p => {
        URL.revokeObjectURL(p.previewUrl);
        if (p.posterUrl) URL.revokeObjectURL(p.posterUrl);
      });
      setPendingUploads(prev => prev.filter(p => !entries.some(e => e.id === p.id)));
    }
  }, [conversationId, replyTo, sendMsg, invalidate, scrollBottom]);

  // Once a real message arrives that has the same imageUrl (or contains
  // it in mediaAlbum) as one of our 'sent' placeholders, remove that
  // placeholder. The render below also filters those out at render time
  // so the bubble swap is seamless (no flash, no duplicate).
  useEffect(() => {
    if (pendingUploads.length === 0) return;
    const sentUrls = new Set<string>();
    for (const m of messages) {
      if (m.imageUrl) sentUrls.add(m.imageUrl);
      const album = m.mediaAlbum;
      if (Array.isArray(album)) for (const u of album) sentUrls.add(u);
    }
    const toRemove = pendingUploads.filter(p =>
      p.status === 'sent' && p.uploadedUrl && sentUrls.has(p.uploadedUrl)
    );
    if (toRemove.length === 0) return;
    toRemove.forEach(p => {
      URL.revokeObjectURL(p.previewUrl);
      // Also free the locally-captured first-frame poster, otherwise
      // each completed video upload would leak its blob: poster URL.
      if (p.posterUrl) URL.revokeObjectURL(p.posterUrl);
    });
    setPendingUploads(prev => prev.filter(p => !toRemove.some(t => t.id === p.id)));
  }, [messages, pendingUploads]);

  // Prune mediaSendAnchorRef: drop entries whose URL no longer appears in
  // either real messages or active pending uploads. Without this, every
  // uploaded video leaves a permanent entry in the map for as long as the
  // user stays in this conversation, even after the message scrolls out
  // of the active window or is deleted. This keeps the map bounded by
  // the size of the currently-loaded message window.
  useEffect(() => {
    const live = new Set<string>();
    for (const m of messages) {
      if (m.imageUrl) live.add(m.imageUrl);
      const album = m.mediaAlbum;
      if (Array.isArray(album)) for (const u of album) live.add(u);
    }
    for (const p of pendingUploads) {
      if (p.uploadedUrl) live.add(p.uploadedUrl);
    }
    const map = mediaSendAnchorRef.current;
    if (map.size === 0) return;
    let mutated = false;
    for (const url of Array.from(map.keys())) {
      if (!live.has(url)) {
        map.delete(url);
        mutated = true;
      }
    }
    // No state update — ref-only mutation, fine to leave silent.
    void mutated;
  }, [messages, pendingUploads]);

  // ── Unified message timeline ──────────────────────────────────────────
  // The chat-list rendering interleaves real server messages with
  // optimistic upload placeholders (Telegram-style). This useMemo
  // produces one ordered list, sorted by send-time, so:
  //
  //   • a pending video upload that started BEFORE a subsequent text
  //     message stays ABOVE that text (the user's "Test" line never
  //     jumps in front of the loading video again);
  //
  //   • once the upload completes and the real server message arrives,
  //     the swap happens in the SAME slot the placeholder occupied —
  //     no jump, no flash. The mediaSendAnchorRef anchors the new
  //     server message's effective ts to the upload's startedAt, so
  //     even after the placeholder is gone the message holds its
  //     original position;
  //
  //   • the same isSameAuthor / mt-3 vs mt-0.5 spacing rule applies to
  //     placeholders, so the gap between bubbles never collapses on
  //     the swap (fixes the "vertical jump" the user reported).
  type TimelineItem =
    | { kind: 'msg'; ts: number; senderId: number; key: string; msg: Msg }
    | {
        kind: 'pending';
        ts: number;
        senderId: number;
        key: string;
        items: PendingUpload[];
        caption?: string;
      };

  const timeline: TimelineItem[] = useMemo(() => {
    const items: TimelineItem[] = [];
    const sentUrlSet = new Set<string>();

    for (const m of messages) {
      let ts = new Date(m.createdAt).getTime();
      if (m.imageUrl) {
        sentUrlSet.add(m.imageUrl);
        const anchor = mediaSendAnchorRef.current.get(m.imageUrl);
        if (anchor != null) ts = anchor;
      }
      const album = m.mediaAlbum;
      if (Array.isArray(album)) {
        for (const u of album) {
          sentUrlSet.add(u);
          const anchor = mediaSendAnchorRef.current.get(u);
          if (anchor != null && anchor < ts) ts = anchor;
        }
      }
      items.push({
        kind: 'msg',
        ts,
        senderId: m.senderId,
        key: `m-${m.id}`,
        msg: m,
      });
    }

    // Active placeholders: scoped to this conversation, and not yet
    // replaced by a real server message.
    const visiblePending = pendingUploads.filter(p =>
      p.conversationId === conversationId &&
      !(p.uploadedUrl && sentUrlSet.has(p.uploadedUrl))
    );
    // Group by groupId, preserving first-seen order.
    const groupMap = new Map<string, PendingUpload[]>();
    for (const p of visiblePending) {
      const arr = groupMap.get(p.groupId);
      if (arr) arr.push(p);
      else groupMap.set(p.groupId, [p]);
    }
    for (const gItems of groupMap.values()) {
      items.push({
        kind: 'pending',
        ts: gItems[0].startedAt,
        senderId: user?.id ?? -1,
        key: `p-${gItems[0].groupId}`,
        items: gItems,
        caption: gItems[0].caption,
      });
    }

    // Stable sort by ts (Array.prototype.sort is stable in modern JS).
    items.sort((a, b) => a.ts - b.ts);
    return items;
  }, [messages, pendingUploads, conversationId, user?.id]);

  // Render a single optimistic upload bubble (one entry of the timeline
  // with kind 'pending'). Lives as an inner helper so it can close over
  // `cancelPendingUpload` without prop drilling. Uses the same spacing
  // rule as a real outgoing bubble so the swap to the server message is
  // visually identical.
  const renderPendingBubble = (
    item: Extract<TimelineItem, { kind: 'pending' }>,
    isSameAuthor: boolean,
  ) => {
    const items = item.items;
    const caption = item.caption;
    const isAlbum = items.length > 1;
    return (
      <div
        key={item.key}
        className={`flex items-end gap-2 w-full justify-end ${isSameAuthor ? 'mt-0.5' : 'mt-3'}`}
      >
        <div className="max-w-[80%] relative">
          <div className={`rounded-[14px] px-2.5 py-[6px] text-[14.5px] leading-[1.3] bubble-sent rounded-br-[4px] ${isSameAuthor ? 'rounded-tr-[4px]' : ''}`}>
            {!isAlbum ? (
              <div className="-mb-1 -mx-2 -mt-1 overflow-hidden rounded-[10px] bg-foreground/5 relative">
                {(() => {
                  const hasDims = !!(items[0].width && items[0].height);
                  const ar = hasDims
                    ? `${items[0].width} / ${items[0].height}`
                    : undefined;
                  if (items[0].isVideo) {
                    const ratioNum = hasDims
                      ? items[0].width! / items[0].height!
                      : 9 / 16;
                    return (
                      <div
                        className="relative overflow-hidden rounded-[10px]"
                        style={{
                          aspectRatio: hasDims ? ar : '9 / 16',
                          maxHeight: '70vh',
                          minWidth: '240px',
                          maxWidth: '360px',
                          background:
                            'linear-gradient(135deg, rgba(140,120,255,0.14), rgba(60,40,120,0.22))',
                        }}
                      >
                        {items[0].posterUrl ? (
                          <img
                            src={items[0].posterUrl}
                            alt=""
                            className="block w-full h-full object-contain"
                            draggable={false}
                            decoding="async"
                            onLoad={() => {
                              if (wasAtBottomRef.current && scrollRef.current) {
                                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                              }
                            }}
                          />
                        ) : (
                          <svg
                            width={240}
                            height={Math.max(1, Math.round(240 / ratioNum))}
                            className="block w-full h-full"
                            aria-hidden
                          />
                        )}
                      </div>
                    );
                  }
                  // Photo placeholder — uses the IDENTICAL sizing as the
                  // final CachedImg bubble below (min 240, max 360, max-h
                  // 70vh, aspect-ratio reserved when known) so the swap
                  // from "uploading" to "sent" is pixel-perfect: same
                  // width, same height, no jump, no resize. Previously
                  // the placeholder was clamped to max-h-64 (≈256px)
                  // with no min-width — so portrait photos appeared
                  // noticeably smaller during upload than after publish.
                  return (
                    <img
                      src={items[0].previewUrl}
                      alt=""
                      className="block w-full object-cover rounded-[10px]"
                      draggable={false}
                      style={{
                        minWidth: 240,
                        maxWidth: 360,
                        maxHeight: '70vh',
                        ...(hasDims ? { aspectRatio: ar } : {}),
                      }}
                      // Catch the case where the just-decoded natural
                      // image size differs from the aspectRatio
                      // reservation (or no reservation existed). If
                      // the user was sitting at the bottom — which is
                      // the case the user reported — re-snap so the
                      // optimistic bubble's bottom edge ends right
                      // above the composer instead of being clipped.
                      onLoad={() => {
                        if (wasAtBottomRef.current && scrollRef.current) {
                          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                        }
                      }}
                    />
                  );
                })()}
                <UploadProgressOverlay
                  loaded={items[0].loaded}
                  total={items[0].total}
                  onCancel={() => cancelPendingUpload(items[0].id)}
                />
                {!caption && (
                  <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-white text-[11px] flex items-center gap-1 pointer-events-none">
                    <Clock className="w-3 h-3" />
                    <span>{format(new Date(items[0].startedAt), 'HH:mm')}</span>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="-mb-1 -mx-2 -mt-1 overflow-hidden rounded-[10px] grid gap-[2px] relative"
                style={{
                  gridTemplateColumns: items.length === 2 ? '1fr 1fr' : '1fr 1fr',
                  gridAutoRows: items.length <= 2 ? '180px' : '120px',
                }}
              >
                {items.slice(0, 6).map(it => {
                  // Same re-pin-on-load logic as the single-photo
                  // branch above so albums also stay glued to the
                  // bottom while their thumbnails decode.
                  const onAlbumLoad = () => {
                    if (wasAtBottomRef.current && scrollRef.current) {
                      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                    }
                  };
                  return (
                  <div key={it.id} className="relative bg-foreground/5 overflow-hidden">
                    {it.isVideo ? (
                      it.posterUrl ? (
                        <img
                          src={it.posterUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          draggable={false}
                          onLoad={onAlbumLoad}
                        />
                      ) : (
                        <video
                          src={it.previewUrl}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                        />
                      )
                    ) : (
                      <img
                        src={it.previewUrl}
                        alt=""
                        className="w-full h-full object-cover"
                        onLoad={onAlbumLoad}
                      />
                    )}
                    <UploadProgressOverlay
                      loaded={it.loaded}
                      total={it.total}
                      onCancel={() => cancelPendingUpload(it.id)}
                    />
                  </div>
                  );
                })}
                {!caption && (
                  <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-white text-[11px] flex items-center gap-1 pointer-events-none z-10">
                    <Clock className="w-3 h-3" />
                    <span>{format(new Date(items[0].startedAt), 'HH:mm')}</span>
                  </div>
                )}
              </div>
            )}

            {caption && (
              <>
                <div className="whitespace-pre-wrap break-words leading-snug">
                  <RichText text={caption} isMine={true} />
                </div>
                <div className="flex items-end justify-end mt-0.5 -mb-0.5">
                  <div className="text-[11px] flex items-center gap-1 text-primary-foreground/60">
                    <Clock className="w-3 h-3" />
                    <span>{format(new Date(items[0].startedAt), 'HH:mm')}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const handleDocumentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // If the user picked an image/video through the Document picker, reroute
    // it to the gallery pipeline so they still get the preview + caption +
    // add-more screen and the optimistic upload bubble — instead of a silent
    // doc upload that ends with a duplicated "📎 filename" row under the
    // photo. Telegram does the same routing on Android/iOS.
    //
    // Some browsers (older iOS Safari for HEIC, Android pickers exposing
    // raw filesystem URIs) leave file.type empty, so we fall back to a
    // filename-extension sniff before deciding it's not a media file.
    const t = file.type || '';
    const isMediaMime = t.startsWith('image/') || t.startsWith('video/');
    const isMediaExt = !t && /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif|mp4|webm|mov|avi|mkv|m4v)$/i.test(file.name);
    if (isMediaMime || isMediaExt) {
      setMediaPicker([file]);
      if (e.target) e.target.value = '';
      return;
    }
    try {
      setUploadingImg(true);
      const formData = new FormData();
      formData.append('file', file);
      const res = await authFetch('/api/uploads/document', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const { url, name } = await res.json();
      forceScrollRef.current = true;
      await sendMsg.mutateAsync({ conversationId, data: { content: `📎 ${name || 'Document'}`, imageUrl: url, replyToId: replyTo?.id } });
      setReplyTo(null); invalidate();
    } catch (err) { console.error(err); }
    finally { setUploadingImg(false); if (e.target) e.target.value = ''; }
  };

  // ── Voice message ──────────────────────────────────────────
  const handleVoiceSend = useCallback(async (audioBlob: Blob, duration: number) => {
    try {
      const formData = new FormData();
      const ext = audioBlob.type.includes('webm') ? '.webm' : audioBlob.type.includes('mp4') ? '.mp4' : '.ogg';
      formData.append('file', audioBlob, `voice${ext}`);
      const res = await authFetch('/api/uploads/audio', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const { url } = await res.json();
      forceScrollRef.current = true;
      await sendMsg.mutateAsync({ conversationId, data: { audioUrl: url, audioDuration: Math.round(duration), replyToId: replyTo?.id } as any });
      setReplyTo(null);
      setVoiceActive(false);
      invalidate();
    } catch (err) { console.error('Voice send error:', err); throw err; }
  }, [authFetch, conversationId, sendMsg, replyTo, invalidate, scrollBottom]);

  // ── Poll creation ──────────────────────────────────────────
  const handlePollCreate = useCallback(async (poll: {
    question: string;
    options: string[];
    isAnonymous: boolean;
    isMultipleChoice: boolean;
    isQuiz: boolean;
  }) => {
    try {
      forceScrollRef.current = true;
      await sendMsg.mutateAsync({ conversationId, data: { poll } as any });
      invalidate();
    } catch (err) { console.error(err); forceScrollRef.current = false; }
  }, [conversationId, sendMsg, invalidate, scrollBottom]);

  // ── Poll vote ──────────────────────────────────────────────
  const handlePollVote = useCallback(async (pollId: number, optionIds: number[]) => {
    try {
      await authFetch(`/api/polls/${pollId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIds }),
      });
      invalidate();
    } catch (err) { console.error(err); throw err; }
  }, [authFetch, invalidate]);

  const handleViewVotes = useCallback(async (pollId: number) => {
    try {
      const res = await authFetch(`/api/polls/${pollId}/votes`);
      if (!res.ok) {
        if (res.status === 403) setPollVotes([]);
        return;
      }
      const data = await res.json();
      if (!Array.isArray(data)) return;

      // Translate option labels to the current app language (one call per option)
      if (data.length > 0 && appLanguage !== 'fr') {
        try {
          const translatedTexts = await Promise.all(
            data.map((o: any) => translateText(o.optionText, appLanguage))
          );
          setPollVotes(data.map((o: any, i: number) => ({
            ...o,
            optionText: translatedTexts[i] ?? o.optionText,
          })));
        } catch {
          setPollVotes(data);
        }
      } else {
        setPollVotes(data);
      }
    } catch (err) { console.error(err); }
  }, [authFetch, appLanguage]);

  // ── Transient overlays coordination ──────────────────────
  // The emoji panel, GIF panel and header 3-dot menu are mutually
  // exclusive: opening one closes the others, and tapping anywhere
  // else (e.g. on a message) just closes them — it must NOT also
  // trigger the underlying tap (e.g. open the message menu).
  const closeTransientOverlays = () => {
    setEmojiOpen(false);
    setGifOpen(false);
    setHeaderMenuOpen(false);
  };
  const anyTransientOpen = emojiOpen || gifOpen || headerMenuOpen;
  // Set whenever a transient overlay was just dismissed by an outside
  // tap. Our document-level `click` (capture) listener stamps this and
  // then closes the overlays via setState; React's bubble-phase onClick
  // on the message bubble runs immediately after with the closure of
  // the previous render (overlays still showing as open) — but to make
  // the guard work even when state has moved on, openCtxMenu also
  // checks this timestamp.
  const transientClosedAt = useRef(0);

  // ── Context menu ──────────────────────────────────────────
  const openCtxMenu = (e: React.MouseEvent | { clientX: number; clientY: number }, msg: Msg) => {
    if ('preventDefault' in e) (e as React.MouseEvent).preventDefault();
    // Ignore any context-menu/long-press events that arrive within 900ms of opening
    // the conversation — they are ghost events from the navigation tap.
    if (Date.now() - conversationOpenedAt.current < 900) return;
    // If a transient overlay (emoji/GIF/header menu) is open OR was
    // just dismissed by this same tap, swallow the event instead of
    // opening the message menu.
    if (anyTransientOpen || Date.now() - transientClosedAt.current < 700) {
      closeTransientOverlays();
      return;
    }
    setCtxMenu({ msgId: msg.id });
    setDeleteConfirm(null);
  };

  const closeCtx = () => { setCtxMenu(null); setDeleteConfirm(null); setCtxPanel(null); setCtxReaders([]); };

  // Fetch reads when context menu opens
  useEffect(() => {
    if (!ctxMenu) { setCtxReaders([]); setCtxPanel(null); return; }
    setCtxReadersLoading(true);
    const token = localStorage.getItem('telechat_token') || '';
    fetch(`/api/messages/${ctxMenu.msgId}/reads`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { readers: [] })
      .then(data => setCtxReaders(data.readers ?? []))
      .catch(() => setCtxReaders([]))
      .finally(() => setCtxReadersLoading(false));
  }, [ctxMenu?.msgId]);

  const handleReply = (msg: Msg) => { setReplyTo(msg); setEditState(null); setContent(''); closeCtx(); };
  const handleEdit = (msg: Msg) => {
    const m = msg as Msg & {
      mediaAlbum?: unknown[] | null;
      videoUrl?: string | null;
      mediaUrl?: string | null;
    };
    const mediaLabel = m.mediaAlbum?.length
      ? `📸 Album (${m.mediaAlbum.length} médias)`
      : m.videoUrl ? '🎬 Vidéo'
      : m.mediaUrl ? '📷 Photo'
      : undefined;
    setEditState({ id: msg.id, orig: msg.content || '', mediaLabel });
    setContent(msg.content || '');
    setReplyTo(null);
    closeCtx();
  };

  const handleDeleteConfirm = async (msgId: number) => {
    closeCtx();
    // Telegram-style dust dissolve. The flow is:
    //   1. Mark the bubble as "dusting" so the CSS wipe + particle overlay
    //      play in place over DUST_DURATION ms.
    //   2. At the END of the animation, mark the message as "dead" so its
    //      row is taken out of the render tree (returns null) — that way
    //      the bubble cannot pop back into view if there's any gap between
    //      the wipe finishing and the message disappearing from the list.
    //   3. Fire the API delete after the animation completes; the refetch
    //      then removes the message from `messages` and the GC effect
    //      clears both Sets.
    //   4. On error, restore the bubble (clear both Sets) so the user can
    //      retry.
    setDustingIds(prev => {
      const next = new Set(prev);
      next.add(msgId);
      return next;
    });
    setTimeout(async () => {
      // Hide the row IMMEDIATELY when the wipe ends — even before the API
      // call returns. This is the key fix for the "bubble reappears then
      // deletes again" glitch: without this, the bubble would briefly
      // become fully visible during the ~50–100ms window between the
      // animation ending and the refetch removing the message from the
      // list (because clearing dustingIds removes the wipe mask, exposing
      // the still-mounted bubble).
      setDeadIds(prev => {
        const next = new Set(prev);
        next.add(msgId);
        return next;
      });

      // ── Surgical cache eviction (fixes "deleted message reappears
      //    when leaving and coming back to the conversation") ────────
      // Before this, we relied on `invalidate()` to refetch the list
      // post-delete. That works while the chat-area stays mounted
      // (the dustingIds/deadIds Sets keep the bubble hidden), but if
      // the user navigates away to another page BEFORE the refetch
      // completes — or even after, since React Query keeps the old
      // payload in the cache and re-renders it on remount before the
      // background refetch returns — the previous-conversation cache
      // still contains the deleted row. The bubble then briefly
      // re-appears on revisit and disappears once the refetch lands.
      //
      // We now patch the cache directly: the key carrying the active
      // list AND the local olderMessages buffer. Both are reverted
      // inside the catch block if the API call fails so the user can
      // retry.
      const listKey = getListMessagesQueryKey(conversationId);
      const prevListData = queryClient.getQueryData<Msg[]>(listKey);
      // Snapshot the current olderMessages *synchronously* (we hold a
      // closure over the local state) so the rollback path can restore
      // the exact pre-delete contents. Using the functional setState
      // for capture would defer the read past the catch block.
      const prevOlder: Msg[] = olderMessages;
      const prevOlderHadMsg = prevOlder.some((m) => m.id === msgId);
      queryClient.setQueryData<Msg[] | undefined>(listKey, (old) =>
        Array.isArray(old) ? old.filter((m) => m.id !== msgId) : old,
      );
      if (prevOlderHadMsg) {
        setOlderMessages((prev) => prev.filter((m) => m.id !== msgId));
      }

      try {
        await deleteMsg.mutateAsync({ messageId: msgId });
        invalidate();
      } catch (e) {
        console.error(e);
        // Restore everything we touched optimistically so the user
        // sees the message again and can retry — UNLESS the socket
        // race already removed the message via a concurrent
        // `message_deleted` invalidation. Resurrecting a row the
        // server has confirmed gone would lock the chat into a
        // permanently-stale view until the next refetch. So we only
        // roll back if the message is still genuinely present-or-
        // expected somewhere; if the latest cache no longer has it,
        // the delete effectively succeeded server-side and we keep
        // the optimistic removal.
        if (prevListData !== undefined) {
          const latest = queryClient.getQueryData<Msg[]>(listKey);
          const latestIsArray = Array.isArray(latest);
          const latestHasMsg = latestIsArray && latest!.some((m) => m.id === msgId);
          const prevHadMsg = prevListData.some((m) => m.id === msgId);
          const stillExpected = latestIsArray && !latestHasMsg && prevHadMsg;
          if (stillExpected) {
            queryClient.setQueryData(listKey, prevListData);
          }
        }
        if (prevOlderHadMsg) {
          setOlderMessages(prevOlder);
        }
        setDustingIds(prev => {
          if (!prev.has(msgId)) return prev;
          const next = new Set(prev);
          next.delete(msgId);
          return next;
        });
        setDeadIds(prev => {
          if (!prev.has(msgId)) return prev;
          const next = new Set(prev);
          next.delete(msgId);
          return next;
        });
      }
    }, DUST_DURATION);
  };

  // Garbage-collect dustingIds / deadIds entries whose message is already
  // gone from the list (e.g. the API delete already happened, or the
  // message was removed by another client). Keeps both Sets bounded.
  useEffect(() => {
    if (dustingIds.size === 0 && deadIds.size === 0) return;
    const live = new Set<number>(messages.map(m => m.id));
    if (dustingIds.size > 0) {
      let stale = false;
      for (const id of dustingIds) if (!live.has(id)) { stale = true; break; }
      if (stale) {
        setDustingIds(prev => {
          const next = new Set<number>();
          for (const id of prev) if (live.has(id)) next.add(id);
          return next;
        });
      }
    }
    if (deadIds.size > 0) {
      let stale = false;
      for (const id of deadIds) if (!live.has(id)) { stale = true; break; }
      if (stale) {
        setDeadIds(prev => {
          const next = new Set<number>();
          for (const id of prev) if (live.has(id)) next.add(id);
          return next;
        });
      }
    }
  }, [messages, dustingIds, deadIds]);

  const handlePin = async (msg: Msg) => {
    closeCtx();
    try {
      await pinMsg.mutateAsync({ messageId: msg.id });
      queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
      invalidate();
    } catch (e) { console.error(e); }
  };

  const handleTranslate = async (msg: Msg) => {
    closeCtx();
    if (!msg.content) return;
    if (translations.find(t => t.msgId === msg.id)) {
      setTranslations(p => p.filter(t => t.msgId !== msg.id)); return;
    }
    setTranslatingId(msg.id);
    try { const text = await translateText(msg.content, translateLanguage); setTranslations(p => [...p, { msgId: msg.id, text }]); }
    catch { }
    finally { setTranslatingId(null); }
  };

  const handleReaction = async (msgId: number, emoji: string) => {
    closeCtx();
    const uid = user?.id;
    // Optimistic toggle: mirror the server logic immediately so the UI
    // updates without waiting for the network roundtrip.
    if (uid != null) {
      const key = getListMessagesQueryKey(conversationId);
      queryClient.setQueryData(key, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((m: any) => {
          if (m.id !== msgId) return m;
          const reactions: any[] = Array.isArray(m.reactions) ? m.reactions : [];
          const existing = reactions.find(r => r.userId === uid && r.emoji === emoji);
          if (existing) {
            return { ...m, reactions: reactions.filter(r => r !== existing) };
          }
          return {
            ...m,
            reactions: [
              ...reactions,
              { id: -Date.now(), messageId: msgId, userId: uid, emoji },
            ],
          };
        });
      });
    }
    try { await addReaction.mutateAsync({ messageId: msgId, data: { emoji } }); invalidate(); }
    catch (e) { console.error(e); invalidate(); }
  };

  // ── Swipe to reply ────────────────────────────────────────
  const onTouchStart = (e: React.TouchEvent, msg: Msg) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
    didTriggerMenu.current = false;
    didJustSwipe.current = false;
    // Guard against ghost-touch from the navigation tap that opened this conversation
    const msSinceOpen = Date.now() - conversationOpenedAt.current;
    if (msSinceOpen < 600) return;
    longPressTimer.current = setTimeout(() => {
      if (!isSwiping.current) {
        didTriggerMenu.current = true;
        openCtxMenu({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }, msg);
      }
    }, 500);
  };

  const onTouchMove = (e: React.TouchEvent, msgId: number) => {
    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = Math.abs(e.touches[0].clientY - swipeStartY.current);
    if (dy > 15 && dy > Math.abs(dx)) {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      return;
    }
    if (dx > 8) {
      isSwiping.current = true;
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      setSwipingId(msgId);
      setSwipeOffsets(p => ({ ...p, [msgId]: Math.min(dx, 80) }));
    }
  };

  const onTouchEnd = (e: React.TouchEvent, msg: Msg) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    if (dx > 60 && isSwiping.current) {
      setReplyTo(msg);
      setEditState(null);
      didJustSwipe.current = true;
    }
    isSwiping.current = false;
    setSwipingId(null);
    setSwipeOffsets(p => ({ ...p, [msg.id]: 0 }));
  };

  // ── Derived ───────────────────────────────────────────────
  const pinnedMessageIds: number[] = (conversation as any)?.pinnedMessageIds ?? [];
  const safePinnedIdx = pinnedMessageIds.length > 0 ? pinnedIdx % pinnedMessageIds.length : 0;
  const pinnedMsgId = pinnedMessageIds[safePinnedIdx];
  const pinnedMsg = pinnedMsgId != null ? (rawMessages?.find(m => m.id === pinnedMsgId) as Msg | undefined) : undefined;

  const scrollToPinnedMsg = (msgId: number) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Target the actual bubble (not the full-width row wrapper) so
    // the highlight glow hugs the message content instead of drawing
    // an ugly outline around the empty side of the row. Re-trigger
    // the animation by removing then re-adding the class on the next
    // frame in case the same pin is tapped twice in a row.
    const bubble =
      (el.querySelector('.bubble-sent, .bubble-received') as HTMLElement | null) ?? el;
    bubble.classList.remove('pinned-flash');
    // Force reflow so the animation restarts.
    void bubble.offsetWidth;
    bubble.classList.add('pinned-flash');
    setTimeout(() => bubble.classList.remove('pinned-flash'), 1700);
  };

  const handlePinnedBannerClick = () => {
    // Guard against the synthetic ghost-click that the mobile browser
    // dispatches after the user taps a conversation in the list: that
    // same touch can land on whatever ends up under the finger once
    // navigation completes — and the floating pinned banner sits very
    // close to where conversation-list items used to be. Without this
    // guard, opening a conversation that has a pinned message would
    // immediately ring/scroll-to that message as if the user had
    // tapped the banner. Same 900 ms window the context-menu uses.
    if (Date.now() - conversationOpenedAt.current < 900) return;
    if (!pinnedMessageIds.length) return;
    const currentMsgId = pinnedMessageIds[safePinnedIdx];
    scrollToPinnedMsg(currentMsgId);
    if (pinnedMessageIds.length > 1) {
      setPinnedIdx(prev => (prev + 1) % pinnedMessageIds.length);
    }
  };
  const rawTitle = conversation?.name || conversation?.participants?.find((p: any) => p.id !== user?.id)?.displayName || 'Chat';
  const title = conversation?.type === 'group' ? translateGroupName(rawTitle, appLanguage) : rawTitle;
  const avatarUrl = conversation?.type === 'direct' ? conversation?.participants?.find((p: any) => p.id !== user?.id)?.avatar : undefined;
  const otherUser = conversation?.participants?.find((p: any) => p.id !== user?.id) as any;
  // Use live presenceMap first; fall back to DB-stored isOnline if not yet in map
  const livePresence = otherUser ? presenceMap.get(otherUser.id) : undefined;
  const isOnline = livePresence ? livePresence.isOnline : (otherUser?.isOnline ?? false);
  const lastSeenDate = livePresence?.lastSeen
    ? new Date(livePresence.lastSeen)
    : (otherUser?.lastSeen ? new Date(otherUser.lastSeen) : null);
  const lastSeen = lastSeenDate
    ? uiT.chat.lastSeen.replace('{time}', format(lastSeenDate, 'HH:mm'))
    : uiT.chat.offline;

  const isGroup = conversation?.type === 'group';
  const memberCount = (conversation as any)?.participants?.length ?? 0;
  // "Online" in a group means *currently viewing this conversation* (per-room
  // presence), not just "connected to the app somewhere". This count includes
  // the current user since they're, by definition, viewing this room right now.
  const onlineMemberCount = conversationId
    ? (roomPresenceMap.get(conversationId)?.size ?? 0)
    : 0;

  const ctxMsg = messages?.find(m => m.id === ctxMenu?.msgId);
  const isMineCtx = ctxMsg?.senderId === user?.id;
  const canDeleteCtx = isMineCtx || !!user?.isAdmin;

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Hidden file inputs */}
      {/* Gallery: multiple files supported */}
      <input type="file" ref={galleryInputRef} className="hidden" accept="image/*,video/*" multiple onChange={handleFileChange} />
      {/* Add more files inside the media picker modal */}
      <input type="file" ref={addMoreMediaRef} className="hidden" accept="image/*,video/*" multiple onChange={(e) => {
        const files = Array.from(e.target.files || []);
        if (files.length) setMediaPicker(prev => [...(prev || []), ...files]);
        if (e.target) e.target.value = '';
      }} />
      <input type="file" ref={cameraInputRef} className="hidden" accept="image/*" capture="environment" onChange={handleCameraChange} />
      <input type="file" ref={documentInputRef} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.7z,application/*,text/plain" onChange={handleDocumentChange} />

      {/* Media picker modal — opens on gallery/camera selection */}
      <AnimatePresence>
        {mediaPicker && mediaPicker.length > 0 && (
          <MediaPickerModal
            initialFiles={mediaPicker}
            onClose={() => setMediaPicker(null)}
            onSend={handleMediaSend}
            addMoreInputRef={addMoreMediaRef}
          />
        )}
      </AnimatePresence>
    <div className="absolute inset-0 flex flex-col">

      {/* ── Ghost-click shield ──
          When the user taps a conversation row in the list, pointerUp fires
          and mounts ChatArea synchronously. ~30 ms later Android dispatches
          a synthesised `click` at the SAME screen coordinates — which now
          lands on whatever is under the finger in the chat (often a link
          inside the first visible message). This transparent overlay
          swallows that ghost click for 400 ms, then unmounts. */}
      <GhostClickShield />

      {/* ── Header ── */}
      <div
        className="flex-none glass border-b border-border/50 flex items-center px-3 z-10 gap-3"
        style={{
          // Aligné sur les sheets de détails (user-profile-sheet,
          // group-info-sheet) qui utilisent py-3 + safe-area top : 12 px
          // de padding vertical pour bien aérer l'avatar 40px et donner
          // au chat la même prestance que le panneau de détails.
          paddingTop: `calc(0.75rem + env(safe-area-inset-top, 0px))`,
          paddingBottom: 12,
          minHeight: 'calc(4rem + env(safe-area-inset-top, 0px))',
        }}
      >

        {searchOpen ? (
          /* ── Mode recherche : remplace le contenu du header (pas de layout shift) ── */
          <>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors p-1 flex-shrink-0"
              onClick={() => setSearchOpen(false)}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center flex-1 min-w-0 gap-2">
              <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher dans la conversation…"
                className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none min-w-0"
              />
            </div>
            {searchQuery.trim().length > 0 && (
              <span className="text-xs text-muted-foreground flex-shrink-0 min-w-[36px] text-right">
                {searchMatches.length > 0 ? `${searchMatchIdx + 1}/${searchMatches.length}` : '0'}
              </span>
            )}
            {searchMatches.length > 1 && (
              <>
                <button className="p-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  onClick={() => { const next = (searchMatchIdx - 1 + searchMatches.length) % searchMatches.length; setSearchMatchIdx(next); scrollToSearchMatch(next); }}>
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button className="p-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  onClick={() => { const next = (searchMatchIdx + 1) % searchMatches.length; setSearchMatchIdx(next); scrollToSearchMatch(next); }}>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </>
            )}
          </>
        ) : (
          /* ── Mode normal ── */
          <>
            {onBack && (
              <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors p-1 flex-shrink-0">
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}

            {/* Avatar + nom — cliquable pour ouvrir les infos */}
            <button
              className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-70 transition-opacity"
              onClick={() => setGroupInfoOpen(true)}
            >
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                {avatarUrl
                  ? <img src={avatarUrl} alt={title} className="w-full h-full rounded-xl object-cover" />
                  : <span className="text-sm font-bold text-primary">{title.substring(0, 1).toUpperCase()}</span>
                }
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="font-semibold text-sm leading-tight text-foreground truncate">{title}</span>
                <span className={`text-xs leading-tight ${(!isGroup && isOnline) || (isGroup && onlineMemberCount > 0) ? 'text-green-400' : 'text-muted-foreground'}`}>
                  {isGroup
                    ? (onlineMemberCount === 1 ? uiT.groupInfo.userOnline : uiT.groupInfo.usersOnline).replace('{count}', String(onlineMemberCount))
                    : (isOnline ? uiT.chat.online : lastSeen)}
                </span>
              </div>
            </button>

            {/* Phone / video call buttons (DM only) */}
            {!isGroup && otherUser && (
              <>
                <button
                  onClick={() => initiateCall({ peerId: otherUser.id, peerName: title, peerAvatar: avatarUrl ?? undefined, conversationId: conversationId!, isVideo: false })}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 flex-shrink-0"
                  title="Appel audio"
                >
                  <Phone className="w-5 h-5" />
                </button>
                <button
                  onClick={() => initiateCall({ peerId: otherUser.id, peerName: title, peerAvatar: avatarUrl ?? undefined, conversationId: conversationId!, isVideo: true })}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 flex-shrink-0"
                  title="Appel vidéo"
                >
                  <VideoIcon className="w-5 h-5" />
                </button>
              </>
            )}

            {/* ⋮ menu contextuel */}
            <div className="relative flex-shrink-0" ref={headerMenuRef} data-overlay-region="header-menu">
              <button
                onClick={() => setHeaderMenuOpen(v => {
                  const next = !v;
                  if (next) { setEmojiOpen(false); setGifOpen(false); }
                  return next;
                })}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
              >
                <MoreVertical className="w-5 h-5" />
              </button>

              {headerMenuOpen && (
                <div
                  className="popover-floating absolute right-0 top-9 w-56 rounded-xl overflow-hidden z-50 py-1"
                >
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-foreground/5 active:bg-foreground/10 transition-colors text-left"
                    onClick={toggleMute}
                  >
                    {isMuted
                      ? <Bell className="w-4 h-4 text-primary flex-shrink-0" />
                      : <BellOff className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    }
                    <span>{isMuted ? 'Activer les notifications' : 'Désactiver les notifications'}</span>
                  </button>

                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-foreground/5 active:bg-foreground/10 transition-colors text-left"
                    onClick={() => { setSearchOpen(true); setHeaderMenuOpen(false); }}
                  >
                    <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span>Rechercher</span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Mini call banner (visible only when a call is minimized) ── */}
      <CallBanner />

      {/* ── Pinned messages — Telegram-style floating card ────────
          Rounded card with glass blur, soft shadow, vertical accent
          bar on the left, optional thumbnail for media, and a
          stacked "Message épinglé" / preview pair. Sits above the
          messages area with margin so it visually floats. */}
      {pinnedMessageIds.length > 0 && pinnedMsg && !pinnedMsg.isDeleted && (() => {
        const m = pinnedMsg as Msg & {
          mediaAlbum?: unknown[]; videoUrl?: string; documentUrl?: string;
        };

        // ── Thumbnail resolution ──
        // Prefer the first album item, then the single image/video.
        // Detect videos via extension and pull the cached first-frame
        // poster (same helper the bubbles use); fall back to nothing
        // for audio/poll/call/text — which then render with just an
        // icon in the title row.
        const videoExtRe = /\.(mp4|webm|mov|avi|mkv)$/i;
        const albumFirst = Array.isArray(m.mediaAlbum) && m.mediaAlbum.length > 0
          ? (m.mediaAlbum[0] as string | { url?: string })
          : null;
        const albumFirstUrl = typeof albumFirst === 'string'
          ? albumFirst
          : albumFirst?.url ?? null;
        const mediaUrl: string | null = albumFirstUrl ?? m.imageUrl ?? null;
        const mediaIsVideo = mediaUrl ? videoExtRe.test(mediaUrl) : false;
        const thumbSrc: string | null = mediaUrl
          ? (mediaIsVideo ? (getVideoPoster(mediaUrl) ?? null) : mediaUrl)
          : null;

        // ── Label/preview text + leading icon ──
        let label = 'Message';
        let preview = '';
        let LeadIcon: typeof Pin | null = null;
        if (m.callType) {
          const isVideo = m.callType === 'video';
          const isMissed = m.callStatus === 'missed' || m.callStatus === 'declined';
          const base = isVideo ? 'Appel vidéo' : 'Appel vocal';
          label = isMissed ? `${base} manqué` : base;
          LeadIcon = isVideo ? VideoIcon : Phone;
        } else if (m.poll) {
          label = 'Sondage';
          preview = m.poll.question ?? '';
        } else if (m.audioUrl) {
          label = 'Message vocal';
        } else if (Array.isArray(m.mediaAlbum) && m.mediaAlbum.length > 0) {
          label = `Album · ${m.mediaAlbum.length} média${m.mediaAlbum.length > 1 ? 's' : ''}`;
          preview = m.content ?? '';
        } else if (mediaIsVideo) {
          label = 'Vidéo';
          preview = m.content ?? '';
        } else if (m.imageUrl) {
          label = 'Photo';
          preview = m.content ?? '';
        } else if (m.documentUrl) {
          label = 'Fichier';
          preview = m.content ?? '';
        } else {
          label = 'Message épinglé';
          preview = m.content ?? '';
        }

        return (
          <div className="flex-shrink-0 px-2 pt-2">
            <div
              onClick={handlePinnedBannerClick}
              /* `glass` matches the chat header's exact glass-morphism
                 recipe (background, blur, border, inset highlight) so
                 the floating banner reads as a continuation of the
                 header strip instead of a foreign card. */
              className="glass flex items-stretch gap-0 rounded-xl overflow-hidden cursor-pointer
                         shadow-[0_4px_16px_-6px_rgba(0,0,0,0.35)]
                         hover:brightness-110 transition-[filter]"
            >
              {/* Vertical accent bar — Telegram's signature pinned-quote stripe */}
              <div className="w-[3px] flex-shrink-0 bg-primary" />

              {/* Thumbnail — only for media. 36×36 square, rounded, with a
                  small play badge overlaid on videos. */}
              {thumbSrc && (
                <div className="flex-shrink-0 self-center ml-2 my-2 w-9 h-9 rounded-md overflow-hidden bg-foreground/10 relative">
                  <InstantImg src={thumbSrc} alt="" className="w-full h-full object-cover" />
                  {mediaIsVideo && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                      <VideoIcon className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                </div>
              )}

              {/* Label + preview */}
              <div className="flex-1 min-w-0 py-2 pl-3 pr-2 flex flex-col justify-center">
                <div className="flex items-center gap-1.5 min-w-0">
                  {LeadIcon && (
                    <LeadIcon className="w-3 h-3 text-primary flex-shrink-0" />
                  )}
                  <span className="text-[12.5px] font-semibold text-primary truncate">
                    Message épinglé
                    {pinnedMessageIds.length > 1 && (
                      <span className="font-normal text-primary/60 ml-1">
                        {safePinnedIdx + 1}/{pinnedMessageIds.length}
                      </span>
                    )}
                  </span>
                </div>
                <span className="text-[12.5px] text-muted-foreground truncate leading-tight">
                  {preview || label}
                </span>
              </div>

              {/* Unpin / dismiss */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Same ghost-click guard as handlePinnedBannerClick:
                  // unpinning is destructive (removes the pin for
                  // everyone), so a synthetic tap right after opening
                  // the conversation must NOT trigger it.
                  if (Date.now() - conversationOpenedAt.current < 900) return;
                  handlePin(pinnedMsg);
                }}
                className="flex-shrink-0 self-stretch px-3 text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors flex items-center"
                aria-label="Désépingler"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Messages ── */}
      <div className="flex-1 min-h-0 relative">
      {/* Scroll-to-bottom floating button — Telegram style */}
      <AnimatePresence>
        {!isAtBottom && (
          <motion.button
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            onClick={() => { scrollBottom(0); setUnreadCount(0); }}
            className="absolute right-3 z-40 w-10 h-10 rounded-full bg-card border border-border/60 shadow-lg flex items-center justify-center text-foreground hover:bg-primary/10 transition-colors"
            style={{
              backdropFilter: 'blur(12px)',
              // Sit just above the composer. On some Android WebViews the
              // wrapper's own padding-bottom: env(safe-area-inset-bottom)
              // resolves to 0 (Capacitor's edge-to-edge isn't fully wired
              // through), so composerHeight only measures the pill itself.
              // We add safe-area here to clear the system gesture bar.
              bottom: `calc(${composerHeight ?? 80}px + env(safe-area-inset-bottom, 0px) + 4px)`,
            }}
          >
            <ChevronDown className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-[10px] font-bold text-white flex items-center justify-center leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto scroll-container px-3 pt-1.5"
        style={{
          visibility: searchOpen || scrollReady || isLoading || messages.length === 0 ? 'visible' : 'hidden',
          // Reserve room for the floating composer + system gesture bar.
          // We add env(safe-area-inset-bottom) on top of composerHeight
          // because some Android WebViews resolve safe-area-inset-bottom
          // to 0 inside the composer wrapper's own padding (Capacitor's
          // edge-to-edge isn't fully wired through) — so composerHeight
          // ends up only measuring the pill itself and the last message
          // would otherwise be hidden behind the composer (the user's
          // bug report after the previous over-correction). Adding it
          // here is safe even when the WebView DOES include it inside
          // composerHeight (web/PWA), because then env(...) is also 0
          // there and the sum is unchanged. Fallback 80 keeps the very
          // first paint close to the settled value so there's no jump
          // when ResizeObserver delivers the real height a frame later.
          paddingBottom: `calc(${composerHeight ?? 80}px + env(safe-area-inset-bottom, 0px))`,
        }}
      >
        {/* Anchor kept for layout symmetry; no longer wired to an
            IntersectionObserver. Older messages are now fetched
            explicitly via the button below — no auto-load on scroll. */}
        <div ref={sentinelRef} className="h-1" />
        {/* Top marker slot — always present, height tightly sized
            to the tallest possible child (the h-6 button = 24 px).
            The slot reserves its 24 px from the very first paint so
            the gap between the header and the first message NEVER
            changes after entry. Inside, we render exactly one of
            three states (button / pill / nothing) and `hasMore` is
            derived synchronously from the messages payload, so even
            on the first frame the correct child is shown — no swap,
            no flicker, no shift. The slot stays in the layout even
            while the conversation is still loading or empty, which
            is what makes the entry rock-solid stable.
            `scroll-anchor-skip` opts this slot out of being picked
            as the browser's scroll anchor — that role belongs to the
            individual message bubbles below, so growth above the
            viewport (e.g. an iframe completing its handshake) shifts
            scrollTop the matching delta and keeps what you see
            pixel-locked. */}
        <div className="scroll-anchor-skip h-6 flex items-center justify-center">
          {!isLoading && messages.length > 0 && (
            hasMore ? (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-1.5 px-2.5 h-6 rounded-full gradient-primary-soft border border-primary/35 text-[10px] font-medium text-foreground/85 hover:text-foreground transition-colors disabled:opacity-60"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    <span>Chargement…</span>
                  </>
                ) : (
                  <span>Afficher les messages précédents</span>
                )}
              </button>
            ) : (
              <span className="text-[10px] text-muted-foreground/50 select-none">— début de la conversation —</span>
            )
          )}
        </div>
        {isLoading && <MessagesSkeleton />}
        {!isLoading && messages.length === 0 && (
          <EmptyConversation title={uiT.chat.emptyTitle} subtitle={uiT.chat.emptySubtitle} />
        )}
        <div ref={msgsWrapRef} className="flex flex-col gap-0.5 pb-2">
          {timeline.map((item, index) => {
            // Skip past messages whose dust-dissolve animation has finished
            // but whose entry hasn't been removed from `messages` yet
            // (deadIds). This makes the avatar / sender-name re-anchor onto
            // the new "first in group" the instant the deletion completes,
            // instead of waiting for the API refetch to physically remove
            // the row from the array.
            let prevIdx = index - 1;
            while (prevIdx >= 0) {
              const cand = timeline[prevIdx];
              if (cand.kind !== 'msg' || !deadIds.has(cand.msg.id)) break;
              prevIdx--;
            }
            const prevItem = prevIdx >= 0 ? timeline[prevIdx] : undefined;

            let nextIdx = index + 1;
            while (nextIdx < timeline.length) {
              const cand = timeline[nextIdx];
              if (cand.kind !== 'msg' || !deadIds.has(cand.msg.id)) break;
              nextIdx++;
            }
            const nextItem = nextIdx < timeline.length ? timeline[nextIdx] : undefined;

            const isSameAuthor = !!prevItem && prevItem.senderId === item.senderId;
            const isLastInGroup = !nextItem || nextItem.senderId !== item.senderId;

            // Optimistic upload bubble — interleaved by send time so it
            // never gets jumped over by a subsequent text message and
            // keeps the same vertical spacing as a real outgoing bubble.
            if (item.kind === 'pending') {
              return renderPendingBubble(item, isSameAuthor);
            }

            const msg = item.msg;
            const isMine = msg.senderId === user?.id;
            const reactionCounts = msg.reactions.reduce((a: Record<string, number>, r) => {
              a[r.emoji] = (a[r.emoji] || 0) + 1; return a;
            }, {});
            const hasReactions = Object.keys(reactionCounts).length > 0;
            const hasReacted = (emoji: string) => msg.reactions.some(r => r.emoji === emoji && r.userId === user?.id);
            const swipeOffset = swipeOffsets[msg.id] || 0;
            const translation = translations.find(t => t.msgId === msg.id)?.text ?? null;
            const isTranslating = translatingId === msg.id;
            const isPinned = pinnedMessageIds.includes(msg.id);
            const msgTime = format(new Date(msg.createdAt), 'HH:mm');
            const isPoll = !!msg.poll;
            const isAudio = !!msg.audioUrl;
            const isCall = !!msg.callType;

            // Show sender name for group conversations (non-mine messages)
            const showSenderName = conversation?.type === 'group' && !isMine && !isSameAuthor;

            // Search highlight
            const isSearchMatch = searchOpen && searchQuery.trim().length > 0 && !!msg.content?.toLowerCase().includes(searchQuery.toLowerCase());
            // searchMatches indexes into the `messages` array, not the
            // timeline (which interleaves pending uploads), so compare
            // by id instead of position.
            const isCurrentMatch =
              isSearchMatch && messages[searchMatches[searchMatchIdx]]?.id === msg.id;

            // ── Call events — WhatsApp-style card bubble ──
            // Aligned left/right like a regular message (NOT centered),
            // with a circular icon container on the left, the call type
            // and detail stacked in the middle, and the time tucked at
            // the bottom-right of the bubble. Tapping the bubble in a
            // 1-to-1 conversation re-initiates the same kind of call
            // (audio/video) — same affordance Telegram/WhatsApp expose.
            if (isCall) {
              const isVideo = msg.callType === 'video';
              const Icon = isVideo ? VideoIcon : Phone;
              const status = msg.callStatus;
              const dur = msg.callDuration ?? 0;
              const formatDur = (s: number) => {
                if (s < 60) return `${s} s`;
                const m = Math.floor(s / 60);
                const r = s % 60;
                return r === 0 ? `${m} min` : `${m} min ${r}`;
              };
              const isMissed = status === 'missed' || status === 'declined';
              let label = isVideo ? 'Appel vidéo' : 'Appel vocal';
              let detail = '';
              if (status === 'answered') detail = formatDur(dur);
              else if (status === 'declined') detail = 'Refusé';
              else { label = isVideo ? 'Appel vidéo manqué' : 'Appel vocal manqué'; detail = isMine ? 'Sans réponse' : 'Appuyez pour rappeler'; }

              return (
                <div
                  key={msg.id}
                  id={`msg-${msg.id}`}
                  className={`flex w-full ${isMine ? 'justify-end' : 'justify-start'} ${isSameAuthor ? 'mt-0.5' : 'mt-3'}`}
                  style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                  onContextMenu={(e) => openCtxMenu(e, msg)}
                  onTouchStart={(e) => onTouchStart(e, msg)}
                  onTouchMove={(e) => onTouchMove(e, msg.id)}
                  onTouchEnd={(e) => onTouchEnd(e, msg)}
                >
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      // Skip the call-initiation if a long-press just opened
                      // the context menu or a swipe-to-reply just fired —
                      // same guard the regular bubble uses.
                      if (didTriggerMenu.current || didJustSwipe.current) {
                        didTriggerMenu.current = false;
                        didJustSwipe.current = false;
                        return;
                      }
                      if (conversation?.type !== 'group') {
                        const other = (conversation as any)?.otherUser;
                        if (other && initiateCall) {
                          try {
                            await initiateCall({
                              peerId: other.id, peerName: other.displayName,
                              peerAvatar: other.avatar || undefined, conversationId, isVideo,
                            });
                          } catch {/* mic/cam denied */}
                        }
                      }
                    }}
                    // min-w-[240px] guarantees every call bubble for the
                    // same call-type renders at an identical width regardless
                    // of how wide the time string happens to be — fixes the
                    // "they're not the same length" jitter the user spotted
                    // when several missed calls stack vertically.
                    className={`min-w-[240px] max-w-[80%] rounded-[14px] pl-3 pr-3.5 py-2 flex flex-col items-stretch gap-1.5 text-left transition-colors active:scale-[0.99]
                      ${isMine
                        ? `bubble-sent rounded-br-[4px] ${isSameAuthor ? 'rounded-tr-[4px]' : ''}`
                        : `bubble-received rounded-tl-[4px] ${!isLastInGroup ? 'rounded-bl-[4px]' : ''}`
                      }`}
                  >
                    {/* Top row: icon + text + time. Wrapped so the reactions
                        row below can sit on its own line inside the bubble. */}
                    <div className="flex items-center gap-3 w-full">
                      {/* LEFT — circular icon. Tinted red when missed/declined,
                          otherwise the bubble's own foreground tone. */}
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0
                          ${isMine ? 'bg-primary-foreground/15' : 'bg-foreground/10'}`}
                      >
                        <Icon
                          className={`w-[18px] h-[18px] ${
                            isMissed
                              ? 'text-rose-400'
                              : isMine
                                ? 'text-primary-foreground'
                                : 'text-foreground/85'
                          }`}
                        />
                      </div>
                      {/* MIDDLE — title + subtitle stacked. min-w-0 + truncate
                          so long detail strings (e.g. "Appuyez pour rappeler")
                          don't blow the bubble past 80% width. */}
                      <div className="flex flex-col items-start min-w-0 flex-1">
                        <span
                          className={`text-[14.5px] font-medium leading-tight truncate w-full
                            ${isMine ? 'text-primary-foreground' : 'text-foreground'}`}
                        >
                          {label}
                        </span>
                        {detail && (
                          <span
                            className={`text-[12px] leading-tight mt-0.5 truncate w-full
                              ${isMine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}
                          >
                            {detail}
                          </span>
                        )}
                      </div>
                      {/* RIGHT — time + optional pin, anchored to bottom so it
                          sits under the subtitle level rather than dead-centre.
                          tabular-nums forces uniform digit widths so a "21:00"
                          bubble doesn't render wider than a "19:47" bubble. */}
                      <div
                        className={`text-[11px] tabular-nums flex items-center gap-1 flex-shrink-0 self-end ml-1
                          ${isMine ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}
                      >
                        {isPinned && <Pin className="w-2.5 h-2.5" aria-label="Épinglé" />}
                        <span>{msgTime}</span>
                      </div>
                    </div>

                    {/* Reactions row — same pill design as regular bubbles.
                        e.stopPropagation on each pill so tapping a reaction
                        toggles it without ALSO triggering the call-tap on
                        the surrounding button. */}
                    {hasReactions && (
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(reactionCounts).map(([emoji, count]) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleReaction(msg.id, emoji); }}
                            className={`rounded-full px-1.5 py-0.5 text-xs flex items-center gap-0.5 border transition-colors
                              ${hasReacted(emoji)
                                ? 'bg-white/25 border-white/40 text-white'
                                : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'}`}
                          >
                            <span>{emoji}</span>
                            <motion.span
                              key={`${emoji}-${count}`}
                              initial={{ y: -6, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                              className="font-bold text-[10px]"
                            >
                              {count as number}
                            </motion.span>
                          </button>
                        ))}
                      </div>
                    )}
                  </button>
                </div>
              );
            }

            const isDusting = dustingIds.has(msg.id);
            // Once the dust animation has completed, the row is removed
            // from the render tree until the message is actually gone from
            // `messages` (the GC effect handles that). This prevents the
            // bubble from popping back into view between the wipe ending
            // and the API delete + refetch finishing.
            if (deadIds.has(msg.id)) return null;
            return (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                className={`flex items-end gap-2 w-full ${isMine ? 'justify-end' : 'justify-start'} ${isSameAuthor ? 'mt-0.5' : 'mt-3'} ${isSearchMatch ? 'relative' : ''}`}
                style={{ userSelect: 'none', WebkitUserSelect: 'none', contain: 'layout style', ...(isCurrentMatch ? { outline: '2px solid hsl(263,90%,65%)', outlineOffset: 4, borderRadius: 12 } : {}) } as React.CSSProperties}
                onContextMenu={(e) => openCtxMenu(e, msg)}
                onClick={(e) => {
                  if (didTriggerMenu.current || didJustSwipe.current) {
                    didTriggerMenu.current = false;
                    didJustSwipe.current = false;
                    return;
                  }
                  openCtxMenu(e, msg);
                }}
                onTouchStart={(e) => onTouchStart(e, msg)}
                onTouchMove={(e) => onTouchMove(e, msg.id)}
                onTouchEnd={(e) => onTouchEnd(e, msg)}
              >
                {/* Avatar column — pinned at the TOP of the message group
                    (next to the sender name when shown). The swipe-reply
                    arrow sits above the avatar and only takes space while
                    the user is actively swiping.
                    Hidden in 1-to-1 (direct) chats — the avatar is already
                    visible in the header, so showing it next to every
                    received message is redundant. */}
                {!isMine && conversation?.type !== 'direct' && (
                  <div className="flex-shrink-0 self-start flex flex-col items-center mt-1" style={{ width: 32 }}>
                    {/* Swipe reply arrow — above avatar */}
                    <div
                      style={{
                        opacity: Math.max(0, Math.min((swipeOffset - 20) / 40, 1)),
                        height: swipeOffset > 0 ? 18 : 0,
                        transition: swipingId === msg.id ? 'none' : 'all 0.2s ease-out',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Reply className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    </div>
                    {/* Avatar */}
                    {!isSameAuthor ? (
                      <button
                        className="focus:outline-none"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (conversation?.type === 'group' && msg.sender) {
                            const participant = (conversation as any)?.participants?.find((p: any) => p.id === msg.sender?.id);
                            setProfileUser({ ...msg.sender, isOnline: participant?.isOnline ?? false });
                          }
                        }}
                      >
                        <Avatar className="w-8 h-8">
                          <AvatarImage src={msg.sender?.avatar || ''} />
                          <AvatarFallback className="bg-primary/20 text-primary text-[11px]">
                            {(msg.sender?.displayName || '?').substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    ) : <div className="w-8 h-8" />}
                  </div>
                )}

                {/* Swipe reply arrow for OWN messages (appears left of bubble) */}
                {isMine && (
                  <div
                    className="flex items-center self-center"
                    style={{
                      opacity: Math.max(0, Math.min((swipeOffset - 20) / 40, 1)),
                      width: swipeOffset > 0 ? 22 : 0,
                      transition: swipingId === msg.id ? 'none' : 'all 0.2s ease-out',
                      overflow: 'hidden',
                    }}
                  >
                    <Reply className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  </div>
                )}

                {/* Bubble wrapper — only handles the slide animation */}
                <div
                  className={`max-w-[80%] relative ${isDusting ? 'dust-fading' : ''}`}
                  style={{
                    transform: `translateX(${swipeOffset}px)`,
                    transition: swipingId === msg.id ? 'none' : 'transform 0.2s ease-out',
                    willChange: swipeOffset !== 0 ? 'transform' : undefined,
                  }}
                >
                  {isDusting && <DustEffect variant={isMine ? 'sent' : 'received'} />}
                  {/* Inner wrapper holds pin label + sender name + bubble in
                      ONE shared mask coordinate space, so the dust wipe
                      crosses all of them as a single contiguous edge (matches
                      Telegram's native dissolve where the entire message
                      block dissolves as one unit). */}
                  <div className={isDusting ? 'dust-bubble-mask' : ''}>
                  {/* The "épinglé" indicator now lives INSIDE the bubble,
                      to the left of the time (see msgTime sites below).
                      It's a single Pin glyph — no text — so it never
                      pushes the bubble wider than the message itself
                      and reads as a quiet status badge rather than a
                      label hovering above the message. */}

                  {/* Sender name (group) — clickable to view profile */}
                  {showSenderName && (
                    <button
                      className="text-[11px] text-primary font-semibold mb-0.5 ml-1 text-left hover:underline focus:outline-none"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (msg.sender) {
                          const participant = (conversation as any)?.participants?.find((p: any) => p.id === msg.sender?.id);
                          setProfileUser({ ...msg.sender, isOnline: participant?.isOnline ?? false });
                        }
                      }}
                    >
                      {msg.sender?.displayName}
                    </button>
                  )}

                  {/* ── Bubble ── */}
                  {/* Bubble corner logic (works for any chain length):
                      - Sent: BR always sharp (tail). TR sharp when prev msg
                        is from same author (visually connects to msg above).
                      - Received: TL always sharp (anchor near avatar at top).
                        BL sharp when next msg is from same author (visually
                        connects to msg below). */}
                  <div className={`rounded-[14px] px-2.5 py-[6px] text-[14.5px] leading-[1.3]
                    ${isMine
                      ? `bubble-sent rounded-br-[4px] ${isSameAuthor ? 'rounded-tr-[4px]' : ''}`
                      : `bubble-received rounded-tl-[4px] ${!isLastInGroup ? 'rounded-bl-[4px]' : ''}`
                    }`}
                  >
                    {/* Reply preview inside bubble — WhatsApp style */}
                    {msg.replyTo && !msg.replyTo.isDeleted && (
                      <div
                        className={`mb-1 -mx-1.5 -mt-0.5 rounded-[10px] overflow-hidden flex cursor-pointer
                          ${isMine ? 'bg-black/20' : 'bg-black/8'}`}
                        style={{ background: isMine ? 'rgba(0,0,0,0.20)' : 'rgba(0,0,0,0.07)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const el = document.getElementById(`msg-${msg.replyTo!.id}`);
                          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }}
                      >
                        {/* Accent bar — thick, full height */}
                        <div className={`w-[3.5px] flex-shrink-0 ${isMine ? 'bg-white' : 'bg-primary'}`} />
                        {/* Content */}
                        <div className="flex-1 min-w-0 px-3 py-2">
                          <p className={`text-[11px] font-semibold leading-tight mb-[3px] truncate
                            ${isMine ? 'text-white' : 'text-primary'}`}>
                            {msg.replyTo.senderId === user?.id ? 'Vous' : msg.replyTo.sender?.displayName}
                          </p>
                          <p className={`text-[12px] leading-snug line-clamp-2
                            ${isMine ? 'text-white/75' : 'text-foreground/70'}`}>
                            {msg.replyTo.audioUrl
                              ? 'Message vocal'
                              : isDocumentMessage(msg.replyTo)
                              ? (stripDocPrefix(msg.replyTo.content) || 'Document')
                              : msg.replyTo.imageUrl
                              ? (msg.replyTo.imageUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i) ? 'Vidéo' : 'Photo')
                              : msg.replyTo.content || ''}
                          </p>
                        </div>
                        {/* Thumbnail if image/video */}
                        {msg.replyTo.imageUrl
                          && !msg.replyTo.imageUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i)
                          && !isDocumentMessage(msg.replyTo) && (
                          <CachedImg
                            src={msg.replyTo.imageUrl}
                            alt="reply"
                            className="w-14 h-14 object-cover flex-shrink-0"
                          />
                        )}
                        {msg.replyTo.imageUrl && msg.replyTo.imageUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i) && (
                          <div className="relative w-14 h-14 flex-shrink-0 overflow-hidden bg-black/30">
                            {(() => {
                              // Prefer the server thumbnailUrl, then the
                              // local poster cache (populated when the
                              // user first viewed the original video
                              // bubble). Falls back to a parked <video>
                              // metadata frame only as a last resort —
                              // anything but a black box.
                              const thumb = msg.replyTo.thumbnailUrl;
                              const poster = thumb || getVideoPoster(msg.replyTo!.imageUrl!);
                              return poster ? (
                                thumb ? (
                                  <CachedImg
                                    src={thumb}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover"
                                  />
                                ) : (
                                  <InstantImg
                                    src={poster}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover"
                                  />
                                )
                              ) : (
                                <video
                                  src={msg.replyTo!.imageUrl!}
                                  preload="metadata"
                                  muted
                                  playsInline
                                  className="absolute inset-0 w-full h-full object-cover"
                                />
                              );
                            })()}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
                              <VideoIcon className="w-4 h-4 text-white" />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Media Album (multiple images/videos — Telegram grid style) */}
                    {msg.mediaAlbum && Array.isArray(msg.mediaAlbum) && msg.mediaAlbum.length > 0 && !isPoll && (
                      <div className="relative">
                        <AlbumGrid
                          urls={msg.mediaAlbum}
                          // Same condition that decides whether to overlay
                          // the time on the album below — keeps the four
                          // visible margins around the album grid identical
                          // (4px on every side) when no caption/reactions
                          // are present.
                          tightBottom={!msg.content && !hasReactions}
                          onItemClick={(i) => {
                            if (Date.now() - conversationOpenedAt.current < 900) return;
                            setMediaViewer({ urls: msg.mediaAlbum!, index: i });
                          }}
                        />
                        {/* Time overlay on the album — only when no caption AND no reactions.
                            As soon as a reaction is added (or a caption appears via edit),
                            the time moves out to the bottom row like a regular message. */}
                        {!msg.content && !hasReactions && (
                          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-white text-[11px] flex items-center gap-1 pointer-events-none">
                            {isPinned && <Pin className="w-2.5 h-2.5" aria-label="Épinglé" />}
                            {msg.editedAt && <span className="italic opacity-80">modifié</span>}
                            <span>{msgTime}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Single Image / Video / Document */}
                    {msg.imageUrl && !msg.mediaAlbum && !isPoll && (() => {
                      const isVideoMsg = !!msg.imageUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i);
                      // Prefer the message-level detector over the URL-only one
                      // so an image-typed file uploaded through the Document
                      // picker (e.g. a JPG with our 📎 content prefix) still
                      // renders as a file card, not as an image bubble with
                      // a duplicated filename row.
                      const isDocMsg = !isVideoMsg && isDocumentMessage(msg);
                      // Documents render as a flat file card (no aspect-ratio
                      // wrapper, no time overlay — the time follows the regular
                      // bottom-row layout because there's nothing to overlay
                      // on top of the card).
                      if (isDocMsg) {
                        return (
                          <FileCard
                            url={msg.imageUrl}
                            name={stripDocPrefix(msg.content) || (msg.imageUrl.split('/').pop() ?? 'Document')}
                            isMine={isMine}
                          />
                        );
                      }
                      // Symmetric 2px visible border on every side of the
                      // photo/video bubble when there's no caption / no
                      // reactions (time-overlay variant). Bubble pads
                      // 6px T/B + 10px L/R; the wrapper pulls -4px /
                      // -8px → 2px gap on every edge. When a caption or
                      // reactions row sits below the media, fall back
                      // to mb-1 so that next row keeps its breathing
                      // room. Same condition is used below to decide
                      // whether to overlay the time on the media.
                      const tightBottom = !msg.content && !hasReactions;
                      return (
                        <div
                          className={`${tightBottom ? '-mb-1' : 'mb-1'} -mx-2 -mt-1 overflow-hidden rounded-[10px] bg-foreground/5 relative`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isVideoMsg ? (
                            // Static thumbnail tile (first frame + centered
                            // play button). Tapping it opens the full-screen
                            // MediaViewer where the actual playback happens
                            // with native controls — same UX as Telegram.
                            <VideoThumbnail
                              src={msg.imageUrl}
                              thumbnailUrl={msg.thumbnailUrl ?? null}
                              mediaPreview={msg.mediaPreview}
                              className="w-full rounded-[10px]"
                              intrinsicWidth={msg.mediaWidth ?? undefined}
                              intrinsicHeight={msg.mediaHeight ?? undefined}
                              onClick={() => {
                                if (Date.now() - conversationOpenedAt.current < 900) return;
                                setMediaViewer({ urls: [msg.imageUrl!], index: 0 });
                              }}
                            />
                          ) : (
                            // Photo bubble — Telegram-style sizing:
                            //   • portrait/square: width clamped to ~min 240
                            //     and ~max 360 (one bubble worth), height
                            //     follows aspect ratio up to 70vh.
                            //   • landscape: same width clamps, height
                            //     follows aspect ratio.
                            // The aspectRatio style reserves the right shape
                            // on the very first paint (no portrait→landscape
                            // flash, no height-jump on decode).
                            <CachedImg
                              src={msg.imageUrl}
                              alt="attached"
                              placeholder={msg.mediaPreview}
                              className="block w-full object-cover rounded-[10px] cursor-pointer active:opacity-80 transition-opacity"
                              style={{
                                minWidth: 240,
                                maxWidth: 360,
                                maxHeight: '70vh',
                                // Reserve a sensible 4:3 box BEFORE the
                                // image decodes when the server hasn't
                                // stored intrinsic dimensions (legacy
                                // messages). Without this fallback the
                                // <img> reports 0×0 until decode and
                                // then suddenly grows — pushing the
                                // entire conversation downward when the
                                // user scrolls back up. Browser
                                // overrides this aspectRatio as soon as
                                // the natural dimensions are known via
                                // the img's own intrinsic ratio.
                                aspectRatio: (() => {
                                  // 1) Server-stored intrinsic dims — perfect.
                                  if (msg.mediaWidth && msg.mediaHeight) {
                                    return `${msg.mediaWidth} / ${msg.mediaHeight}`;
                                  }
                                  // 2) Legacy messages: try the client-side
                                  //    aspect cache (populated by probeImageAspect
                                  //    on a previous render of the same URL).
                                  //    On a return visit this is what eliminates
                                  //    the "bubble jumps from 4:3 to portrait"
                                  //    flash the user sees on entering a chat.
                                  const cached = getCachedImageAspect(msg.imageUrl!);
                                  if (cached) return String(cached);
                                  // 3) Truly unknown — keep 4:3 as the safest
                                  //    middle-ground fallback (browser overrides
                                  //    once natural dims arrive).
                                  return '4 / 3';
                                })(),
                              }}
                              onClick={() => {
                                if (Date.now() - conversationOpenedAt.current < 900) return;
                                setMediaViewer({ urls: [msg.imageUrl!], index: 0 });
                              }}
                            />
                          )}
                          {/* Time overlay on the media — only when no caption AND no reactions.
                              As soon as a reaction is added (or a caption appears via edit),
                              the time moves out to the bottom row like a regular message. */}
                          {!msg.content && !hasReactions && (
                            <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-white text-[11px] flex items-center gap-1 pointer-events-none">
                              {isPinned && <Pin className="w-2.5 h-2.5" aria-label="Épinglé" />}
                              {msg.editedAt && <span className="italic opacity-80">modifié</span>}
                              <span>{msgTime}</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Audio message */}
                    {isAudio && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <AudioPlayer
                          url={msg.audioUrl!}
                          duration={msg.audioDuration}
                          isMine={isMine}
                          senderAvatar={!isMine ? msg.sender?.avatar : undefined}
                          senderInitials={!isMine ? (msg.sender?.displayName || '?').substring(0, 2).toUpperCase() : undefined}
                        />
                      </div>
                    )}

                    {/* Poll */}
                    {isPoll && msg.poll && (
                      <div onClick={(e) => e.stopPropagation()}>
                      <PollMessage
                        poll={msg.poll}
                        isMine={isMine}
                        onVote={handlePollVote}
                        onViewVotes={handleViewVotes}
                      />
                      </div>
                    )}

                    {/* Call log (WhatsApp-style: icon + label + duration/status) */}
                    {isCall && (() => {
                      const isVideo = msg.callType === 'video';
                      const Icon = isVideo ? VideoIcon : Phone;
                      const status = msg.callStatus;
                      const dur = msg.callDuration ?? 0;
                      const formatDur = (s: number) => {
                        if (s < 60) return `${s} s`;
                        const m = Math.floor(s / 60);
                        const r = s % 60;
                        return r === 0 ? `${m} min` : `${m} min ${r}`;
                      };
                      let label = isVideo ? 'Appel vidéo' : 'Appel vocal';
                      let subtitle = '';
                      let iconColor = isMine ? 'text-white' : 'text-primary';
                      if (status === 'answered') {
                        subtitle = formatDur(dur);
                      } else if (status === 'declined') {
                        subtitle = isMine ? 'Refusé par le destinataire' : 'Refusé';
                        iconColor = 'text-rose-400';
                      } else {
                        // missed
                        label = isVideo ? 'Appel vidéo manqué' : 'Appel vocal manqué';
                        subtitle = isMine ? 'Sans réponse' : 'Appuyez pour rappeler';
                        iconColor = 'text-rose-400';
                      }
                      return (
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            // Tap call bubble → ring back the peer
                            if (conversation?.type !== 'group') {
                              const other = (conversation as any)?.otherUser;
                              if (other && initiateCall) {
                                try {
                                  await initiateCall({
                                    peerId: other.id,
                                    peerName: other.displayName,
                                    peerAvatar: other.avatar || undefined,
                                    conversationId,
                                    isVideo,
                                  });
                                } catch {/* mic/cam denied */}
                              }
                            }
                          }}
                          className="flex items-center gap-3 py-1 pr-2 -my-0.5 text-left w-full focus:outline-none"
                        >
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0
                            ${isMine ? 'bg-white/15' : 'bg-primary/10'} ${iconColor}`}>
                            <Icon className="w-[18px] h-[18px]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold leading-tight">{label}</p>
                            <p className={`text-[11px] mt-0.5 leading-tight ${isMine ? 'text-white/70' : 'text-foreground/55'}`}>
                              {subtitle}
                            </p>
                          </div>
                        </button>
                      );
                    })()}

                    {/* Text — hidden ONLY when this is the synthetic
                        "📎 <filename>" payload our doc-upload path emits
                        (isDocumentMessage already enforces single-line +
                        leading 📎 + non-empty name). Real captions that
                        happen to start with 📎 or that are multi-line are
                        still rendered, so user-typed content never gets
                        eaten by the doc-card collapse. */}
                    {msg.content && !isPoll && !isDocumentMessage(msg) && (
                      <div className="whitespace-pre-wrap break-words leading-snug">
                        <RichText text={msg.content} isMine={isMine} />
                      </div>
                    )}

                    {/* Translation */}
                    {(isTranslating || translation) && (
                      <div className={`mt-2 pt-2 border-t text-xs ${isMine ? 'border-primary-foreground/20 text-primary-foreground/75' : 'border-border text-muted-foreground'}`}>
                        <div className="flex items-center gap-1 mb-1 font-medium">
                          <Languages className="w-3 h-3" /> Traduction
                        </div>
                        {isTranslating ? <Loader2 className="w-3 h-3 animate-spin" /> : <p>{translation}</p>}
                      </div>
                    )}

                    {/* Link preview */}
                    {msg.linkPreview && (
                      <LinkPreviewCard preview={msg.linkPreview} isMine={isMine} />
                    )}

                    {/* Bottom row: reactions (left) + time (right) — inside bubble like Base44.
                        When the message is media-only (image/video/album, no caption),
                        the time is shown OVER the media (Telegram-style) instead, so
                        we hide it here. The row is still rendered when reactions
                        exist so they have a place to live. */}
                    {(() => {
                      // The time is only shown OVER the media when the message has
                      // no caption AND no reactions. Otherwise it must show in the
                      // normal bottom row like any other message.
                      const isMediaOnly = !msg.content && !isPoll && !isCall && !isAudio && !hasReactions &&
                        (!!msg.imageUrl || (Array.isArray(msg.mediaAlbum) && msg.mediaAlbum.length > 0));
                      if (isMediaOnly) return null;
                      return (
                    <div className={`flex items-end justify-between gap-2 ${isPoll ? 'mt-2' : 'mt-0.5 -mb-0.5'}`}>
                      {/* Reactions inside bubble — animated with Framer Motion */}
                      {hasReactions ? (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(reactionCounts).map(([emoji, count]) => (
                            <button
                              key={emoji}
                              onClick={(e) => { e.stopPropagation(); handleReaction(msg.id, emoji); }}
                              className={`rounded-full px-1.5 py-0.5 text-xs flex items-center gap-0.5 border transition-colors
                                ${hasReacted(emoji)
                                  ? 'bg-white/25 border-white/40 text-white'
                                  : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'}`}
                            >
                              <span>{emoji}</span>
                              <motion.span
                                key={`${emoji}-${count}`}
                                initial={{ y: -6, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                                className="font-bold text-[10px]"
                              >
                                {count as number}
                              </motion.span>
                            </button>
                          ))}
                        </div>
                      ) : <div />}

                      {/* Time + edited — read-receipt indicators removed:
                          users can still see "vu par" via the message
                          context menu (long-press) for any sent message.
                          Hidden for media-only messages (overlaid on media). */}
                      {!isMediaOnly && (
                      <div className={`text-[11px] flex items-center gap-1 flex-shrink-0 ${isMine ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                        {isPinned && <Pin className="w-2.5 h-2.5" aria-label="Épinglé" />}
                        {msg.editedAt && <span className="italic opacity-80">modifié</span>}
                        <span>{msgTime}</span>
                      </div>
                      )}
                    </div>
                      );
                    })()}
                  </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Optimistic upload placeholders are now rendered INLINE inside
              the timeline.map above (sorted by send time alongside real
              messages) so a placeholder never gets jumped over by a
              subsequent text bubble. See `renderPendingBubble` and the
              `timeline` useMemo. */}
        </div>
      </div>
      </div>{/* end flex-1 relative messages wrapper */}

      {/* ── Typing indicator ── */}
      <AnimatePresence>
        {typingUsers.filter(u => u.conversationId === conversationId).length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
            className="flex-shrink-0 px-5 py-1 flex items-center gap-2"
          >
            {/* Animated dots */}
            <div className="flex items-center gap-0.5">
              {[0, 1, 2].map(i => (
                <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-primary"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15, ease: 'easeInOut' }}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground italic">
              {(() => {
                const typers = typingUsers.filter(u => u.conversationId === conversationId);
                if (typers.length === 1)
                  return uiT.chat.typingOne.replace('{name}', typers[0].displayName);
                if (typers.length === 2)
                  return uiT.chat.typingTwo.replace('{a}', typers[0].displayName).replace('{b}', typers[1].displayName);
                return uiT.chat.typingMany.replace('{n}', String(typers.length));
              })()}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Input bar — truly floating: absolute over messages, transparent wrapper ── */}
      <div
        ref={composerRef}
        className="absolute left-0 right-0 bottom-0 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Soft blur veil — auto-fits the composer's exact height so it starts pile au bord du haut de la barre */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 pointer-events-none"
          style={{
            backdropFilter: 'blur(14px) saturate(140%)',
            WebkitBackdropFilter: 'blur(14px) saturate(140%)',
            background: 'linear-gradient(to top, hsl(var(--background) / 0.4), hsl(var(--background) / 0.25))',
          }}
        />

        {/* @mention suggestions — floats above the input bar, same pattern as emoji/GIF */}
        <AnimatePresence>
          {mentionQuery !== null && mentionSuggestions.length > 0 && (
            <motion.div
              key="mention-popup"
              className="absolute bottom-full left-0 right-0 mb-1 z-50 px-3"
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              <div className="popover-floating rounded-2xl overflow-hidden">
                {/* Header — outside the scroll area so it stays fixed */}
                <div className="flex items-center px-4 pt-3 pb-2 border-b border-foreground/5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-primary/70">Mentions</span>
                </div>
                {/* Scrollable list — touch-action pan-y allows native vertical scroll */}
                <div className="max-h-52 overflow-y-auto rounded-b-2xl" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}>
                  {mentionSuggestions.map((p, idx) => (
                    <button
                      key={p.id}
                      onMouseDown={(e) => { e.preventDefault(); handleMentionSelect(p); }}
                      onClick={() => handleMentionSelect(p)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-primary/10 active:bg-primary/20 transition-colors text-left ${idx > 0 ? 'border-t border-foreground/5' : ''}`}
                    >
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarImage src={p.avatar || ''} />
                        <AvatarFallback className="bg-primary/20 text-primary text-xs">
                          {(p.displayName || '?').substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{p.displayName}</div>
                        {p.username && <div className="text-xs text-primary/60 truncate">@{p.username}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* GIF picker — floats above the input bar */}
        <GifPicker
          open={gifOpen}
          onClose={() => setGifOpen(false)}
          onSelect={handleGifSelect}
        />

        {/* Emoji picker — same pattern as GIF picker */}
        <AnimatePresence>
          {emojiOpen && (
            <motion.div
              key="emoji-panel"
              data-overlay-region="emoji"
              className="absolute bottom-full left-0 right-0 mb-1 z-50"
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              <div className="popover-floating rounded-2xl overflow-hidden mx-3">
                <div className="flex items-center justify-between px-3 pt-3 pb-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Emojis</span>
                  <button
                    onClick={() => setEmojiOpen(false)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-8 gap-0.5 px-2 pb-3 max-h-[240px] overflow-y-auto no-scrollbar">
                  {PICKER_EMOJIS.map(e => (
                    <button key={e} onClick={() => { setContent(p => p + e); setEmojiOpen(false); }}
                      className="text-xl hover:bg-foreground/10 rounded p-1 transition-colors leading-none">{e}</button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex items-end gap-2 px-3 pb-3">
          {/* Voice recorder — replaces entire row when active */}
          {voiceActive ? (
            <VoiceRecorder
              onSend={handleVoiceSend}
              onCancel={() => setVoiceActive(false)}
            />
          ) : (
            <>
              {/* ── Text input field — floating glass capsule ─────────── */}
              <div className="flex-1 composer-pill flex flex-col overflow-hidden">

                {/* ── Reply preview INSIDE the pill (Telegram-style, animated) ── */}
                <AnimatePresence initial={false}>
                {replyTo && !editState && (() => {
                  const isVideo = !!replyTo.imageUrl && /\.(mp4|webm|mov|avi|mkv)$/i.test(replyTo.imageUrl);
                  const isImage = !!replyTo.imageUrl && !isVideo;
                  const previewLabel = replyTo.audioUrl
                    ? 'Message vocal'
                    : isVideo
                    ? 'Vidéo'
                    : isImage
                    ? 'Photo'
                    : (replyTo.content || '');
                  const replyName = replyTo.senderId === user?.id ? 'Vous' : (replyTo.sender?.displayName || '');
                  return (
                    <motion.div
                      key="reply-preview"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                    <div className="flex items-center gap-2.5 pl-3 pr-2 pt-2 pb-1.5">
                      <Reply className="w-4 h-4 text-primary flex-shrink-0" />
                      {isImage && (
                        <CachedImg
                          src={replyTo.imageUrl!}
                          alt="reply"
                          className="w-8 h-8 rounded-[5px] object-cover flex-shrink-0"
                        />
                      )}
                      {isVideo && (
                        <div className="relative w-8 h-8 rounded-[5px] overflow-hidden bg-black/40 flex-shrink-0">
                          {(() => {
                            // Same instant-paint strategy as the in-bubble
                            // reply preview: server thumbnail → local
                            // poster cache → parked <video> as last resort.
                            const thumb = replyTo.thumbnailUrl;
                            const poster = thumb || getVideoPoster(replyTo.imageUrl!);
                            return poster ? (
                              thumb ? (
                                <CachedImg
                                  src={thumb}
                                  alt=""
                                  className="absolute inset-0 w-full h-full object-cover"
                                />
                              ) : (
                                <InstantImg
                                  src={poster}
                                  alt=""
                                  className="absolute inset-0 w-full h-full object-cover"
                                />
                              )
                            ) : (
                              <video
                                src={replyTo.imageUrl!}
                                preload="metadata"
                                muted
                                playsInline
                                className="absolute inset-0 w-full h-full object-cover"
                              />
                            );
                          })()}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
                            <VideoIcon className="w-3 h-3 text-white" />
                          </div>
                        </div>
                      )}
                      {replyTo.audioUrl && !replyTo.imageUrl && (
                        <div className="w-8 h-8 rounded-[5px] bg-primary/15 flex items-center justify-center flex-shrink-0">
                          <Mic className="w-3.5 h-3.5 text-primary" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0 border-l-2 border-primary pl-2">
                        <p className="text-[12px] text-primary font-semibold truncate leading-tight">
                          Répondre à {replyName}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                          {previewLabel}
                        </p>
                      </div>
                      <button
                        onClick={() => setReplyTo(null)}
                        className="text-muted-foreground hover:text-foreground p-1 flex-shrink-0 rounded-full hover:bg-foreground/5 transition-colors"
                        aria-label="Annuler la réponse"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    </motion.div>
                  );
                })()}
                </AnimatePresence>

                {/* ── Edit preview INSIDE the pill (animated) ── */}
                <AnimatePresence initial={false}>
                {editState && (
                  <motion.div
                    key="edit-preview"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                  <div className="flex items-center gap-2.5 pl-3 pr-2 pt-2 pb-1.5">
                    <Pencil className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0 border-l-2 border-primary pl-2">
                      <p className="text-[12px] text-primary font-semibold truncate leading-tight">
                        {uiT.chat.edit}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                        {editState.mediaLabel
                          ? editState.orig
                            ? `${editState.mediaLabel} — ${editState.orig}`
                            : editState.mediaLabel
                          : editState.orig}
                      </p>
                    </div>
                    <button
                      onClick={() => { setEditState(null); setContent(''); }}
                      className="text-muted-foreground hover:text-foreground p-1 flex-shrink-0 rounded-full hover:bg-foreground/5 transition-colors"
                      aria-label="Annuler l'édition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  </motion.div>
                )}
                </AnimatePresence>

                {/* ── Link preview INSIDE the pill (animated) ── */}
                <AnimatePresence initial={false}>
                {(linkPreview || linkPreviewLoading) && !editState && (
                  <motion.div
                    key="link-preview"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="flex items-center gap-2.5 pl-3 pr-2 pt-2 pb-1.5">
                      {linkPreview?.image ? (
                        <CachedImg
                          src={linkPreview.image}
                          alt=""
                          className="w-9 h-9 rounded-md object-cover flex-shrink-0 border border-foreground/10"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-md flex-shrink-0 flex items-center justify-center gradient-primary-soft border border-primary/30">
                          {linkPreviewLoading
                            ? <Loader2 className="w-4 h-4 text-primary animate-spin" />
                            : <Link2 className="w-4 h-4 text-primary" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0 border-l-2 border-primary pl-2">
                        <p className="text-[12px] text-primary font-semibold truncate leading-tight">
                          {linkPreviewLoading && !linkPreview
                            ? 'Chargement de l\u2019aper\u00e7u\u2026'
                            : (linkPreview?.title || linkPreview?.siteName || 'Aper\u00e7u du lien')}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                          {linkPreview?.description || linkPreview?.url || ''}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          // Always remember the currently-detected URL as dismissed,
                          // even if metadata hasn't arrived yet (loading state).
                          const u = linkPreview?.url ?? currentPreviewUrlRef.current;
                          if (u) dismissedUrlsRef.current.add(u);
                          setLinkPreview(null);
                          setLinkPreviewLoading(false);
                        }}
                        className="text-muted-foreground hover:text-foreground p-1 flex-shrink-0 rounded-full hover:bg-foreground/5 transition-colors"
                        aria-label="Masquer l'aper\u00e7u"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}
                </AnimatePresence>

                {/* ── Formatting toolbar INSIDE the pill (matches reply/edit/link previews) ── */}
                <FormattingToolbar
                  visible={!voiceActive}
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

                {/* Input row (GIF/Emoji + Textarea + attachment + Mic/Send) */}
                <div className="flex items-end">

                {/* Left icon: GIF (idle) ↔ Emoji (typing) */}
                <AnimatePresence mode="wait" initial={false}>
                  {!(content.trim() || editState) ? (
                    /* GIF button */
                    <motion.button
                      key="gif"
                      data-overlay-region="gif"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.13 }}
                      onClick={() => setGifOpen(v => {
                        const next = !v;
                        if (next) { setEmojiOpen(false); setHeaderMenuOpen(false); }
                        return next;
                      })}
                      className={`flex-shrink-0 ml-3 mr-3 self-end mb-2 h-6 w-[38px] flex items-center justify-center rounded-full text-xs font-bold border transition-all
                        ${gifOpen
                          ? 'gradient-primary-soft border-primary text-primary glow-primary-sm'
                          : 'border-foreground/40 text-foreground/60 hover:border-primary hover:text-primary'
                        }`}
                    >
                      GIF
                    </motion.button>
                  ) : (
                    /* Emoji button */
                    <motion.button
                      key="emoji"
                      data-overlay-region="emoji"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.13 }}
                      onClick={() => setEmojiOpen(v => {
                        const next = !v;
                        if (next) { setGifOpen(false); setHeaderMenuOpen(false); }
                        return next;
                      })}
                      className={`flex-shrink-0 ml-3 mr-3 self-end mb-2 h-6 w-[38px] flex items-center justify-center rounded-full border transition-all
                        ${emojiOpen
                          ? 'gradient-primary-soft border-primary text-primary glow-primary-sm'
                          : 'border-foreground/40 text-foreground/60 hover:border-primary hover:text-primary'
                        }`}
                    >
                      <Smile className="w-4 h-4" />
                    </motion.button>
                  )}
                </AnimatePresence>

                {/* Textarea
                    Keyboard hints: explicit attributes so Android's
                    GBoard / Samsung Keyboard show suggestions, autocorrect
                    and capitalize the first letter of each sentence.
                    Without these, the WebView defaults strip those
                    features (the keyboard reverts to "no suggestions"
                    mode) and the user has to type every capital and
                    every word by hand. */}
                <Textarea
                  ref={textareaRef}
                  value={content}
                  onChange={handleContentChange}
                  // Mirrors the raw DOM 'input' event for IMEs that don't
                  // fire React's synthetic onChange (Samsung emoji panel,
                  // GBoard glide-typing). Composition-aware — see
                  // syncContentFromDom + handleCompositionStart/End.
                  onInput={handleContentInput}
                  // Composition handlers are CRITICAL for Android IMEs.
                  // Without them, every onChange while the keyboard is
                  // mid-word forces React to re-set textarea.value, which
                  // resets the IME composition span and the cursor jumps
                  // to the end — making it impossible to edit mid-text,
                  // insert emojis between characters, or backspace an
                  // emoji from the keyboard panel.
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={handleKeyDown}
                  // Explicit paste handler. On Android, when the user
                  // taps the keyboard's clipboard icon and then a
                  // clipped item, the WebView dispatches a `paste`
                  // event but the resulting `input` event sometimes
                  // arrives with the OLD value (race between Samsung's
                  // clipboard panel and the WebView's text-insertion
                  // pipeline). We grab the clipboard text from the
                  // event itself, splice it into the controlled value
                  // at the current cursor position and restore the
                  // cursor — this matches what every native messaging
                  // app does and works whether the paste came from the
                  // keyboard's clipboard, a long-press menu, or
                  // Ctrl+V on a hardware keyboard.
                  onPaste={(e) => {
                    const ta = textareaRef.current;
                    if (!ta) return;
                    const pasted = e.clipboardData?.getData('text/plain') ?? '';
                    if (!pasted) return; // let the browser handle non-text payloads (images, etc.)
                    e.preventDefault();
                    const start = ta.selectionStart ?? content.length;
                    const end = ta.selectionEnd ?? content.length;
                    const next = content.slice(0, start) + pasted + content.slice(end);
                    setContent(next);
                    const newCursor = start + pasted.length;
                    requestAnimationFrame(() => {
                      const t = textareaRef.current;
                      if (!t) return;
                      t.focus();
                      try { t.setSelectionRange(newCursor, newCursor); } catch { /* ignore */ }
                    });
                  }}
                  onSelect={handleTextSelect}
                  onBlur={() => { if (!linkMode) setTimeout(() => setSelectionRange(null), 150); }}
                  // Suppress the native Android floating action mode
                  // ("Couper / Copier / Coller") that pops up on text
                  // selection. We render our own FormattingToolbar
                  // (Copier / Coller / Gras / Italique / Souligner /
                  // Barrer / Spoiler / Lien) right above the composer
                  // and want it to be the ONLY menu the user sees on
                  // selection. Note: this only blocks the contextmenu
                  // event — keyboard suggestions, autocorrect and
                  // auto-capitalize are independent of contextmenu and
                  // remain fully functional.
                  onContextMenu={(e) => e.preventDefault()}
                  // On Android (native EditText overlay), the native side
                  // owns the placeholder — we must clear the HTML one or
                  // both render simultaneously and the user sees doubled
                  // overlapping text.
                  placeholder={useNativeComposer ? '' : (editState ? uiT.chat.editPlaceholder : uiT.chat.placeholder)}
                  autoCapitalize="sentences"
                  autoCorrect="on"
                  spellCheck={true}
                  // autoComplete="off" (counter-intuitively) is what makes
                  // Samsung Keyboard show its word-prediction strip
                  // ("texte / textes / tente") instead of the form-fill
                  // toolbar (clipboard / translate / settings icons).
                  // Samsung treats autoComplete="on" as "this field
                  // wants saved usernames / addresses", which suppresses
                  // dictionary suggestions. We want the opposite here.
                  autoComplete="off"
                  enterKeyHint="send"
                  // Tag the input with the active UI language so the
                  // OS picks the right dictionary / autocorrect locale.
                  lang={appLanguage === 'en' ? 'en-US' : 'fr-FR'}
                  // overflowWrap + wordBreak + whiteSpace: long runs of
                  // emojis are treated by Android WebView as a single
                  // un-breakable grapheme cluster and overflow the
                  // composer horizontally instead of wrapping. Forcing
                  // `anywhere` lets the browser break between any two
                  // code-points, restoring the same wrap behaviour as
                  // plain text. Without these, after ~10–15 emojis on
                  // a single line the textarea silently stops accepting
                  // new input because the line cannot grow further.
                  // On the Android APK, a real native EditText is overlaid
                  // on top of this <textarea> by NativeComposerPlugin (see
                  // the bridge effects above). We keep the HTML element in
                  // the DOM so layout measurement, send-button wiring and
                  // bounds sync still work — but we hide its text + caret
                  // so the user doesn't see two overlapping carets / two
                  // suggestion strips.
                  style={{
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                    ...(useNativeComposer
                      ? { color: 'transparent', caretColor: 'transparent' }
                      : null),
                  }}
                  className="flex-1 min-h-[40px] max-h-[120px] border-0 focus-visible:ring-0 resize-none py-2.5 px-0 bg-transparent shadow-none text-sm rounded-none"
                  rows={1}
                  wrap="soft"
                />

                {/* Right icons inside field: + attachment, then Mic/Send (Telegram-like) */}
                {!editState && (
                  <button
                    onClick={() => { closeTransientOverlays(); setAttachmentSheetOpen(true); }}
                    disabled={uploadingImg}
                    className="flex-shrink-0 w-10 h-10 mb-0 self-end flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {uploadingImg
                      ? <Loader2 className="w-5 h-5 animate-spin" />
                      : <Plus className="w-5 h-5" />}
                  </button>
                )}

                {/* ── Mic / Send — now INSIDE the pill, on the far right ──
                    Both buttons share identical 36x36 dimensions so the
                    swap (mic↔send) doesn't reflow the row and shift the
                    `+` button horizontally. */}
                <AnimatePresence mode="wait" initial={false}>
                  {content.trim() || editState ? (
                    <motion.button
                      key="send"
                      onClick={handleSend}
                      disabled={sending}
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex-shrink-0 w-9 h-9 mr-1 mb-0.5 rounded-full send-circle transition-all flex items-center justify-center self-end"
                    >
                      {sending
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : editState ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                    </motion.button>
                  ) : (
                    <motion.button
                      key="mic"
                      onClick={() => setVoiceActive(true)}
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex-shrink-0 w-9 h-9 mr-1 mb-0.5 self-end flex items-center justify-center text-primary/80 hover:text-primary transition-colors"
                    >
                      <Mic className="w-5 h-5" />
                    </motion.button>
                  )}
                </AnimatePresence>
                </div>{/* end input row */}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Context Menu — bottom sheet ── */}
      <AnimatePresence>
        {ctxMenu && ctxMsg && (
          <motion.div
            key="ctx-overlay"
            className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center px-4"
            style={{
              // Pousse "Supprimer" au-dessus de la barre de navigation
              // Android (gestes ou 3 boutons) sur le bord inférieur.
              paddingBottom: `calc(1rem + env(safe-area-inset-bottom, 0px))`,
              paddingTop: `calc(1rem + env(safe-area-inset-top, 0px))`,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={closeCtx}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              className="relative w-full max-w-sm"
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              {ctxPanel ? (
                /* ── Sub-panel: Reactions or Views ── */
                <div className="glass-strong rounded-2xl overflow-hidden">
                  {/* Back header */}
                  <button
                    onClick={() => setCtxPanel(null)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-foreground/5 border-b border-foreground/5 text-foreground"
                  >
                    <ArrowLeft size={18} className="text-muted-foreground" />
                    <span className="text-sm font-medium">{uiT.chat.back}</span>
                  </button>

                  {/* List */}
                  <div className="max-h-64 overflow-y-auto">
                    {ctxPanel === 'reactions' && (
                      ctxMsg.reactions.length === 0 ? (
                        <p className="text-center text-muted-foreground text-sm py-6">—</p>
                      ) : (
                        /* Group by unique user, show all emoji they reacted with */
                        Object.values(
                          ctxMsg.reactions.reduce<Record<number, { userId: number; emojis: string[] }>>((acc, r) => {
                            if (!acc[r.userId]) acc[r.userId] = { userId: r.userId, emojis: [] };
                            acc[r.userId].emojis.push(r.emoji);
                            return acc;
                          }, {})
                        ).map(({ userId, emojis }) => {
                          const reactorUser = (conversation as any)?.participants?.find((p: any) => p.id === userId);
                          const name = reactorUser?.displayName ?? `User ${userId}`;
                          const avatar = reactorUser?.avatar ?? null;
                          const initials = name.substring(0, 2).toUpperCase();
                          return (
                            <div key={userId} className="flex items-center gap-3 px-4 py-3 border-t border-foreground/5 first:border-0">
                              <Avatar className="w-9 h-9 flex-shrink-0">
                                <AvatarImage src={avatar || ''} />
                                <AvatarFallback className="bg-primary/20 text-primary text-xs">{initials}</AvatarFallback>
                              </Avatar>
                              <span className="flex-1 text-sm font-medium text-foreground truncate">{name}</span>
                              <span className="text-base">{emojis.join('')}</span>
                            </div>
                          );
                        })
                      )
                    )}

                    {ctxPanel === 'views' && (
                      ctxReadersLoading ? (
                        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                      ) : ctxReaders.length === 0 ? (
                        <p className="text-center text-muted-foreground text-sm py-6">—</p>
                      ) : (
                        ctxReaders.map(reader => {
                          const initials = reader.displayName.substring(0, 2).toUpperCase();
                          return (
                            <div key={reader.id} className="flex items-center gap-3 px-4 py-3 border-t border-foreground/5 first:border-0">
                              <Avatar className="w-9 h-9 flex-shrink-0">
                                <AvatarImage src={reader.avatar || ''} />
                                <AvatarFallback className="bg-primary/20 text-primary text-xs">{initials}</AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{reader.displayName}</p>
                                {reader.readAt && (
                                  <p className="text-[11px] text-muted-foreground">{format(new Date(reader.readAt), 'HH:mm')}</p>
                                )}
                              </div>
                              <CheckCheck size={16} className="text-primary flex-shrink-0" />
                            </div>
                          );
                        })
                      )
                    )}
                  </div>
                </div>
              ) : (
                /* ── Main menu ── */
                <>
                  {/* Emoji reaction picker */}
                  <div className="glass-strong rounded-2xl mb-2 flex justify-around items-center p-3">
                    {REACTION_EMOJIS.map(emoji => (
                      <button key={emoji} onClick={() => handleReaction(ctxMenu.msgId, emoji)}
                        className="text-2xl hover:scale-125 active:scale-110 transition-transform">{emoji}</button>
                    ))}
                  </div>

                  {/* Reactions + Views summary row */}
                  <div className="glass-strong rounded-2xl mb-2 flex divide-x divide-foreground/10 overflow-hidden">
                    <button
                      onClick={() => setCtxPanel('reactions')}
                      className="flex-1 flex items-center gap-2 px-4 py-3 hover:bg-foreground/5 transition-colors"
                    >
                      <Heart size={15} className="text-red-400 flex-shrink-0" />
                      <span className="text-sm font-medium text-foreground">{ctxMsg.reactions.length}</span>
                      <span className="text-xs text-muted-foreground truncate">{uiT.chat.reactions}</span>
                      {ctxMsg.reactions.slice(0, 3).map((r, i) => {
                        const p = (conversation as any)?.participants?.find((pp: any) => pp.id === r.userId);
                        const ini = (p?.displayName ?? '?').substring(0, 2).toUpperCase();
                        return (
                          <Avatar key={i} className="w-5 h-5 flex-shrink-0 -ml-1">
                            <AvatarImage src={p?.avatar || ''} />
                            <AvatarFallback className="bg-primary/20 text-primary text-[8px]">{ini}</AvatarFallback>
                          </Avatar>
                        );
                      })}
                    </button>
                    <button
                      onClick={() => setCtxPanel('views')}
                      className="flex-1 flex items-center gap-2 px-4 py-3 hover:bg-foreground/5 transition-colors"
                    >
                      <CheckCheck size={15} className="text-primary flex-shrink-0" />
                      <span className="text-sm font-medium text-foreground">{ctxReadersLoading ? '…' : ctxReaders.length}</span>
                      <span className="text-xs text-muted-foreground truncate">{uiT.chat.views}</span>
                      {ctxReaders.slice(0, 3).map((r, i) => {
                        const ini = r.displayName.substring(0, 2).toUpperCase();
                        return (
                          <Avatar key={i} className="w-5 h-5 flex-shrink-0 -ml-1">
                            <AvatarImage src={r.avatar || ''} />
                            <AvatarFallback className="bg-primary/20 text-primary text-[8px]">{ini}</AvatarFallback>
                          </Avatar>
                        );
                      })}
                    </button>
                  </div>

                  {/* Actions */}
                  <div className="glass-strong rounded-2xl overflow-hidden">
                    <SheetItem icon={<Reply size={18} />} label={uiT.chat.reply} onClick={() => ctxMsg && handleReply(ctxMsg)} />

                    {ctxMsg.content && (
                      <SheetItem
                        icon={<Copy size={18} />}
                        label={uiT.chat.copy}
                        onClick={() => {
                          if (ctxMsg?.content) {
                            navigator.clipboard.writeText(ctxMsg.content).catch(() => {});
                          }
                          closeCtx();
                        }}
                        divider
                      />
                    )}

                    {ctxMsg.content && (
                      <SheetItem
                        icon={translatingId === ctxMenu.msgId ? <Loader2 size={18} className="animate-spin" /> : <Languages size={18} />}
                        label={translations.find(t => t.msgId === ctxMenu.msgId) ? uiT.chat.hideTranslation : uiT.chat.translate}
                        onClick={() => ctxMsg && handleTranslate(ctxMsg)}
                        divider
                      />
                    )}

                    <SheetItem
                      icon={pinnedMessageIds.includes(ctxMenu.msgId) ? <PinOff size={18} /> : <Pin size={18} />}
                      label={pinnedMessageIds.includes(ctxMenu.msgId) ? uiT.chat.unpin : uiT.chat.pin}
                      onClick={() => ctxMsg && handlePin(ctxMsg)}
                      divider
                    />

                    {/* "Modifier" is hidden for polls, audio messages, and
                        call events — none of them have editable text. */}
                    {isMineCtx && !ctxMsg.poll && !ctxMsg.audioUrl && !ctxMsg.callType && (
                      <SheetItem icon={<Pencil size={18} />} label={uiT.chat.edit} onClick={() => ctxMsg && handleEdit(ctxMsg)} divider />
                    )}

                    {canDeleteCtx && (
                      deleteConfirm === ctxMenu.msgId ? (
                        <div className="flex items-center gap-3 px-4 py-3.5 border-t border-foreground/5" onClick={(e) => e.stopPropagation()}>
                          <span className="text-sm text-red-400 flex-1">{uiT.chat.confirmDelete}</span>
                          <button onClick={() => handleDeleteConfirm(ctxMenu.msgId)} className="text-xs text-red-400 font-semibold hover:text-red-300 px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20">
                            {uiT.chat.delete}
                          </button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">
                            {uiT.chat.cancelDelete}
                          </button>
                        </div>
                      ) : (
                        <SheetItem
                          icon={<Trash2 size={18} />}
                          label={uiT.chat.delete}
                          onClick={() => setDeleteConfirm(ctxMenu.msgId)}
                          divider
                          danger
                        />
                      )
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Poll votes viewer ── */}
      <AnimatePresence>
        {pollVotes && (
          <motion.div
            key="poll-votes-page"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            className="fixed inset-0 z-[450] bg-background flex flex-col"
          >
            {/* Header */}
            <div
              className="flex items-center gap-3 px-3 py-3 border-b border-white/10 flex-shrink-0"
              style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
            >
              <button
                onClick={() => setPollVotes(null)}
                className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                data-testid="button-back-poll-votes"
                aria-label={uiT.chat.back}
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h3 className="font-bold text-foreground flex-1">{uiT.poll.votesTitle}</h3>
            </div>

            {/* Scrollable body */}
            <div
              className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 space-y-4"
              style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
            >
              {pollVotes.map((opt, i) => (
                <div key={i}>
                  <p className="text-sm font-semibold text-foreground mb-2">{opt.optionText}</p>
                  {opt.voters.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{uiT.poll.noVotes}</p>
                  ) : (
                    <div className="space-y-1">
                      {opt.voters.map((v: any) => (
                        <div key={v.id} className="flex items-center gap-2 glass rounded-xl px-3 py-2">
                          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-primary">{v.displayName[0].toUpperCase()}</span>
                          </div>
                          <span className="text-sm text-foreground">{v.displayName}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Attachment sheet ── */}
      <AttachmentSheet
        open={attachmentSheetOpen}
        onClose={() => setAttachmentSheetOpen(false)}
        onCamera={() => cameraInputRef.current?.click()}
        onGallery={() => galleryInputRef.current?.click()}
        onDocument={() => documentInputRef.current?.click()}
        onPoll={() => setPollCreatorOpen(true)}
      />

      {/* ── Poll creator ── */}
      <PollCreator
        open={pollCreatorOpen}
        onClose={() => setPollCreatorOpen(false)}
        onSubmit={handlePollCreate}
      />

      {/* ── Group info sheet ── */}
      {conversation && (
        <GroupInfoSheet
          open={groupInfoOpen}
          onClose={() => setGroupInfoOpen(false)}
          conversation={conversation as any}
          messages={(messages || []) as any}
          onOpenConversation={onOpenConversation}
        />
      )}

      {/* ── User profile sheet (click on avatar/name in group) ── */}
      {profileUser && user && (
        <UserProfileSheet
          user={profileUser}
          currentUserId={user.id}
          onClose={() => setProfileUser(null)}
          onOpenConversation={(convId) => {
            setProfileUser(null);
            onOpenConversation?.(convId);
          }}
        />
      )}

      {/* ── Media viewer (full-screen lightbox) ── */}
      {mediaViewer && (
        <MediaViewer
          urls={mediaViewer.urls}
          startIndex={mediaViewer.index}
          onClose={() => setMediaViewer(null)}
        />
      )}
    </div>
    </div>
  );
}
