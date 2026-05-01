import { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, MessageSquare, Image as ImageIcon, Mic, Video, FileText, Link2, ChevronLeft, ChevronRight, Eye, Languages, Loader2, X, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { usePreferences } from '@/lib/preferences-context';
import { AudioPlayer } from '@/components/chat/audio-player';
import { LinkPreviewCard, type LinkPreviewData } from '@/components/chat/link-preview';

async function translateText(text: string, targetLang: string): Promise<string> {
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`);
  const d = await r.json();
  const translated = d.responseData?.translatedText;
  if (!translated || translated === text || d.responseStatus !== 200) {
    throw new Error('Traduction indisponible');
  }
  return translated;
}

const API_BASE = '/api';
function getToken() { return localStorage.getItem('telechat_token'); }
function authHeaders() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }; }

type SurveillanceMessage = {
  id: number;
  conversationId: number;
  content: string | null;
  imageUrl: string | null;
  audioUrl: string | null;
  audioDuration: number | null;
  linkPreview: LinkPreviewData | null;
  sender: { id: number; username: string; displayName: string } | null;
  participants: { id: number; username: string; displayName: string }[];
  createdAt: string;
};

const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv)(\?|$)/i;

function isVideo(url: string | null): boolean {
  return !!url && VIDEO_EXT.test(url);
}

function isDocument(msg: SurveillanceMessage): boolean {
  return !!msg.imageUrl && !!msg.content && msg.content.startsWith('📎');
}

function getDocumentName(content: string | null): string {
  if (!content) return 'Document';
  return content.replace(/^📎\s*/, '').trim() || 'Document';
}

type Response = {
  messages: SurveillanceMessage[];
  total: number;
  page: number;
  perPage: number;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

type Props = {
  onViewConversation?: (conversationId: number) => void;
};

export function MessageSurveillance({ onViewConversation }: Props) {
  const { toast } = useToast();
  const { translateLanguage } = usePreferences();
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [selectedMsg, setSelectedMsg] = useState<SurveillanceMessage | null>(null);
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [translatingId, setTranslatingId] = useState<number | null>(null);

  async function handleTranslate(msg: SurveillanceMessage) {
    if (!msg.content) return;
    setTranslatingId(msg.id);
    try {
      const text = await translateText(msg.content, translateLanguage);
      setTranslations(p => ({ ...p, [msg.id]: text }));
    } catch {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Traduction indisponible' });
    } finally {
      setTranslatingId(null);
    }
  }

  function closeTranslation(msgId: number) {
    setTranslations(p => {
      const next = { ...p };
      delete next[msgId];
      return next;
    });
  }

  const fetchMessages = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (q) params.set('search', q);
      const res = await fetch(`${API_BASE}/admin/surveillance?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Erreur');
      setData(await res.json());
    } catch {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de charger les messages' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchMessages(page, search); }, [page, search, fetchMessages]);

  function doSearch() {
    setPage(1);
    setSearch(searchInput);
  }

  const totalPages = data ? Math.ceil(data.total / data.perPage) : 0;

  function getPreview(msg: SurveillanceMessage): React.ReactNode {
    if (msg.imageUrl) {
      if (isDocument(msg)) {
        return (
          <span className="inline-flex items-center gap-1.5 align-middle">
            <FileText className="w-3 h-3 text-primary/80" />
            <span className="text-foreground/90 truncate max-w-[180px]">{getDocumentName(msg.content)}</span>
          </span>
        );
      }
      const video = isVideo(msg.imageUrl);
      return (
        <span className="inline-flex items-center gap-1.5 align-middle">
          <span className="relative w-8 h-8 rounded-md overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
            {video ? (
              <>
                <video src={msg.imageUrl} className="w-full h-full object-cover" muted preload="metadata" />
                <Video className="absolute w-3 h-3 text-white drop-shadow" />
              </>
            ) : (
              <img src={msg.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
            )}
          </span>
          <span className="text-muted-foreground text-[11px]">{video ? 'Vidéo' : 'Photo'}</span>
        </span>
      );
    }
    if (msg.audioUrl) {
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Mic className="w-3 h-3" /> Audio{msg.audioDuration ? ` · ${msg.audioDuration}s` : ''}
        </span>
      );
    }
    if (msg.linkPreview) {
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Link2 className="w-3 h-3" /> Lien{msg.linkPreview.title ? ` · ${msg.linkPreview.title.slice(0, 50)}` : ''}
        </span>
      );
    }
    if (msg.content) {
      const text = msg.content.length > 80 ? msg.content.slice(0, 80) + '…' : msg.content;
      return <span className="text-foreground/90">{text}</span>;
    }
    return <span className="text-muted-foreground italic">Message vide</span>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" />
          <span className="font-bold text-base">Surveillance des MP</span>
        </div>
        <button
          onClick={() => fetchMessages(page, search)}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stats */}
      {data && (
        <div className="glass rounded-xl px-4 py-2.5 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <span className="text-sm">
            <span className="font-bold text-primary">{data.total}</span>
            <span className="text-muted-foreground"> message{data.total > 1 ? 's' : ''} privé{data.total > 1 ? 's' : ''} trouvé{data.total > 1 ? 's' : ''}</span>
          </span>
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Rechercher dans les messages..."
            className="pl-9 bg-white/5 border-white/10 text-sm"
          />
        </div>
        <button
          onClick={doSearch}
          className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          OK
        </button>
      </div>

      {/* Table */}
      <div className="glass rounded-2xl overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-4 py-2.5 border-b border-white/10">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Message</span>
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Utilisateurs</span>
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Date</span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-muted-foreground text-sm">Chargement...</div>
        ) : !data || data.messages.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            {search ? 'Aucun résultat pour cette recherche' : 'Aucun message privé'}
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {data.messages.map(msg => (
              <div
                key={msg.id}
                className="px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer"
                onClick={() => setSelectedMsg(selectedMsg?.id === msg.id ? null : msg)}
              >
                <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-start">
                  {/* Message content */}
                  <div className="min-w-0">
                    {msg.sender && (
                      <span className="text-xs font-semibold text-primary mr-1.5">
                        {msg.sender.displayName}
                      </span>
                    )}
                    <span className="text-xs text-foreground/80 break-words">
                      {getPreview(msg)}
                    </span>
                  </div>

                  {/* Participants */}
                  <div className="flex flex-col items-center gap-0.5 min-w-[90px]">
                    {msg.participants.slice(0, 2).map(p => (
                      <span key={p.id} className="text-[10px] text-primary/80 leading-tight text-center whitespace-nowrap">
                        {p.displayName}
                      </span>
                    ))}
                  </div>

                  {/* Date */}
                  <div className="text-[10px] text-muted-foreground whitespace-nowrap text-right">
                    {timeAgo(msg.createdAt)}
                  </div>
                </div>

                {/* Expanded detail */}
                {selectedMsg?.id === msg.id && (
                  <div className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                    {/* Full message text (skip when content is just the document caption) */}
                    {msg.content && !isDocument(msg) && (
                      <div className="text-xs bg-white/5 rounded-xl px-3 py-2.5 break-words">
                        {msg.content}
                      </div>
                    )}

                    {/* Image / Video */}
                    {msg.imageUrl && !isDocument(msg) && (
                      <div className="rounded-xl overflow-hidden bg-black/40 border border-white/10">
                        {isVideo(msg.imageUrl) ? (
                          <video
                            src={msg.imageUrl}
                            controls
                            playsInline
                            className="w-full max-h-[300px] object-contain bg-black"
                          />
                        ) : (
                          <a
                            href={msg.imageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block"
                          >
                            <img
                              src={msg.imageUrl}
                              alt="Pièce jointe"
                              className="w-full max-h-[300px] object-contain"
                              loading="lazy"
                            />
                          </a>
                        )}
                      </div>
                    )}

                    {/* Document */}
                    {isDocument(msg) && msg.imageUrl && (
                      <a
                        href={msg.imageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-3 py-2.5 transition-colors"
                      >
                        <span className="w-9 h-9 rounded-lg gradient-primary-soft border border-primary/30 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-4 h-4 text-primary" />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-medium text-foreground truncate">
                            {getDocumentName(msg.content)}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">Ouvrir le document</span>
                        </span>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      </a>
                    )}

                    {/* Audio */}
                    {msg.audioUrl && (
                      <div className="bg-white/5 border border-white/10 rounded-xl p-2">
                        <AudioPlayer
                          url={msg.audioUrl}
                          duration={msg.audioDuration}
                          isMine={false}
                          senderInitials={msg.sender?.displayName?.slice(0, 2).toUpperCase() ?? '??'}
                        />
                      </div>
                    )}

                    {/* Link preview */}
                    {msg.linkPreview && (
                      <LinkPreviewCard preview={msg.linkPreview} isMine={false} />
                    )}

                    {/* Translation */}
                    {translations[msg.id] && (
                      <div className="relative text-xs bg-primary/10 border border-primary/25 rounded-xl px-3 py-2.5 pr-9 break-words">
                        <div className="flex items-center gap-1 text-[10px] text-primary/80 mb-1">
                          <Languages className="w-3 h-3" />
                          <span className="font-semibold uppercase tracking-wider">Traduction</span>
                        </div>
                        <div className="text-foreground/90">{translations[msg.id]}</div>
                        <button
                          onClick={() => closeTranslation(msg.id)}
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
                          aria-label="Fermer la traduction"
                        >
                          <X className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">
                        Conv #{msg.conversationId} · {new Date(msg.createdAt).toLocaleString('fr-FR')}
                      </span>
                      <div className="flex items-center gap-3 ml-auto">
                        {msg.content && !translations[msg.id] && (
                          <button
                            onClick={() => handleTranslate(msg)}
                            disabled={translatingId === msg.id}
                            className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors disabled:opacity-60"
                          >
                            {translatingId === msg.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Languages className="w-3 h-3" />
                            )}
                            Traduire
                          </button>
                        )}
                        {onViewConversation && (
                          <button
                            onClick={() => onViewConversation(msg.conversationId)}
                            className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                          >
                            <Eye className="w-3 h-3" />
                            Voir la conversation
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white/10 text-sm disabled:opacity-40 hover:bg-white/15 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Précédent
          </button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white/10 text-sm disabled:opacity-40 hover:bg-white/15 transition-colors"
          >
            Suivant
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
