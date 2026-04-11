import React, { useRef, useEffect } from 'react';
import { Bold, Italic, Underline, Strikethrough, Eye, Link } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { FormatType } from './rich-text';

interface Props {
  show: boolean;
  linkMode: boolean;
  linkUrl: string;
  onLinkUrlChange: (url: string) => void;
  onLinkConfirm: () => void;
  onLinkCancel: () => void;
  onFormat: (fmt: FormatType) => void;
  onLinkRequest: () => void;
}

const TOOLS: Array<{ fmt: FormatType; icon: React.ReactNode; label: string }> = [
  { fmt: 'bold',      icon: <Bold className="w-4 h-4" />,          label: 'Gras' },
  { fmt: 'italic',    icon: <Italic className="w-4 h-4" />,        label: 'Italique' },
  { fmt: 'underline', icon: <Underline className="w-4 h-4" />,     label: 'Souligner' },
  { fmt: 'strike',    icon: <Strikethrough className="w-4 h-4" />, label: 'Barrer' },
  { fmt: 'spoiler',   icon: <Eye className="w-4 h-4" />,           label: 'Spoiler' },
  { fmt: 'link',      icon: <Link className="w-4 h-4" />,          label: 'Lien' },
];

export function FormattingToolbar({ show, linkMode, linkUrl, onLinkUrlChange, onLinkConfirm, onLinkCancel, onFormat, onLinkRequest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (linkMode && inputRef.current) {
      inputRef.current.focus();
    }
  }, [linkMode]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.15 }}
          className="overflow-hidden border-b border-border/40"
        >
          <div className="flex items-center gap-0.5 px-3 py-1.5 glass">
            {linkMode ? (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-muted-foreground whitespace-nowrap font-medium">URL :</span>
                <input
                  ref={inputRef}
                  value={linkUrl}
                  onChange={e => onLinkUrlChange(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); onLinkConfirm(); }
                    if (e.key === 'Escape') { onLinkCancel(); }
                  }}
                  placeholder="https://..."
                  type="url"
                  className="flex-1 bg-transparent text-sm outline-none border-b border-primary/60 py-0.5 px-1 text-foreground placeholder:text-muted-foreground/60 min-w-0"
                />
                <button
                  onMouseDown={e => { e.preventDefault(); onLinkConfirm(); }}
                  className="text-xs px-2.5 py-1 rounded-lg bg-primary/20 text-primary font-semibold border border-primary/30 hover:bg-primary/30 active:bg-primary/40 transition-colors flex-shrink-0"
                >
                  OK
                </button>
                <button
                  onMouseDown={e => { e.preventDefault(); onLinkCancel(); }}
                  className="text-xs px-2 py-1 rounded-lg bg-white/5 text-muted-foreground border border-border/40 hover:bg-white/10 transition-colors flex-shrink-0"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-0.5 w-full">
                {TOOLS.map(({ fmt, icon, label }) => (
                  <button
                    key={fmt}
                    onMouseDown={e => {
                      e.preventDefault();
                      if (fmt === 'link') { onLinkRequest(); }
                      else { onFormat(fmt); }
                    }}
                    title={label}
                    className="flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg hover:bg-white/10 active:bg-white/20 transition-colors text-foreground/80 hover:text-foreground"
                  >
                    {icon}
                    <span className="text-[9px] leading-none text-muted-foreground">{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
