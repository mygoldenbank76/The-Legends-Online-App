import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/use-debounce';
import { getAuthHeaders } from '@/lib/auth-fetch';

export interface GifResult {
  id: string;
  title: string;
  url: string;
  preview: string;
  dims: [number, number];
}

function useGifs(query: string, enabled: boolean) {
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    const endpoint = query.trim()
      ? `/api/gifs/search?q=${encodeURIComponent(query)}`
      : `/api/gifs/trending`;

    fetch(endpoint, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => {
        if (!cancelled) {
          setResults(d.results ?? []);
          setLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [query, enabled]);

  return { results, loading };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (gif: GifResult) => void;
}

export function GifPicker({ open, onClose, onSelect }: Props) {
  const [rawQuery, setRawQuery] = useState('');
  const query = useDebounce(rawQuery, 380);
  const { results, loading } = useGifs(query, open);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track the visual viewport so the picker shrinks when the on-screen keyboard appears
  const [viewportH, setViewportH] = useState<number>(
    typeof window !== 'undefined' ? window.innerHeight : 800
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const update = () => setViewportH(vv ? vv.height : window.innerHeight);
    update();
    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
      return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      };
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Reserve space for the chat header at the top (~64px) and the input bar below (~64px)
  // so the picker never collides with either, and the search bar always stays visible.
  const maxPickerHeight = Math.max(180, viewportH - 140);

  useEffect(() => {
    if (open) {
      setRawQuery('');
      // Don't auto-focus — user taps the search bar when they want to type
    }
  }, [open]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute bottom-full left-0 right-0 mb-1 z-50"
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
        >
          <div
            className="popover-floating rounded-2xl overflow-hidden mx-3 flex flex-col"
            style={{ maxHeight: maxPickerHeight }}
          >
            {/* Search bar */}
            <div className="flex-shrink-0 flex items-center gap-2 px-3 pt-3 pb-2 gradient-hairline-bottom">
              <div className="flex-1 relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  ref={inputRef}
                  value={rawQuery}
                  onChange={e => setRawQuery(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Rechercher des GIF…"
                  className="h-8 pl-7 text-xs bg-background/40 border-border/40 rounded-xl focus-visible:ring-1 focus-visible:ring-primary/60 focus-visible:border-primary/40"
                />
              </div>
              <button
                onClick={onClose}
                className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Section label */}
            <p className="flex-shrink-0 px-3 pt-2 pb-1 text-[10px] font-semibold tracking-widest uppercase text-gradient-primary">
              {rawQuery.trim() ? 'Résultats' : 'Tendances'}
            </p>

            {/* GIF grid */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center h-28">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              ) : results.length === 0 ? (
                <div className="flex items-center justify-center h-28 text-sm text-muted-foreground">
                  Aucun résultat
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1 px-2 pb-2">
                  {results.map(gif => (
                    <button
                      key={gif.id}
                      onClick={() => { onSelect(gif); onClose(); }}
                      className="relative rounded-xl overflow-hidden bg-foreground/5 hover:ring-2 hover:ring-primary hover:glow-primary-sm active:scale-95 transition-all aspect-video"
                    >
                      <img
                        src={gif.preview}
                        alt={gif.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Tenor attribution */}
            <p className="flex-shrink-0 text-center text-[9px] text-muted-foreground/40 pb-2">
              Powered by Tenor
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
