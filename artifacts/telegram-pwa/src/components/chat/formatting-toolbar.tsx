import React, { useState } from 'react';
import { Bold, Italic, Underline, Strikethrough, Code2, Eye, Link } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { FormatType } from './rich-text';

interface Props {
  show: boolean;
  onFormat: (fmt: FormatType, url?: string) => void;
  isMine?: boolean;
}

const TOOLS: Array<{ fmt: FormatType; icon: React.ReactNode; label: string }> = [
  { fmt: 'bold',      icon: <Bold className="w-4 h-4" />,          label: 'Gras' },
  { fmt: 'italic',    icon: <Italic className="w-4 h-4" />,        label: 'Italique' },
  { fmt: 'underline', icon: <Underline className="w-4 h-4" />,     label: 'Souligner' },
  { fmt: 'strike',    icon: <Strikethrough className="w-4 h-4" />, label: 'Barrer' },
  { fmt: 'code',      icon: <Code2 className="w-4 h-4" />,         label: 'Fixe' },
  { fmt: 'spoiler',   icon: <Eye className="w-4 h-4" />,           label: 'Spoiler' },
  { fmt: 'link',      icon: <Link className="w-4 h-4" />,          label: 'Lien' },
];

export function FormattingToolbar({ show, onFormat }: Props) {
  const [linkMode, setLinkMode] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const handleLink = () => {
    if (!linkMode) { setLinkMode(true); setLinkUrl(''); return; }
    const url = linkUrl.trim() ? (linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`) : '';
    onFormat('link', url);
    setLinkMode(false);
    setLinkUrl('');
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.15 }}
          className="flex items-center gap-0.5 px-2 py-1 glass-strong border-t border-border/40"
        >
          {linkMode ? (
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-xs text-muted-foreground whitespace-nowrap">URL :</span>
              <input
                autoFocus
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleLink(); } if (e.key === 'Escape') { setLinkMode(false); } }}
                placeholder="https://..."
                className="flex-1 bg-transparent text-sm outline-none border-b border-primary/50 py-0.5 text-foreground placeholder:text-muted-foreground"
              />
              <button
                onClick={handleLink}
                className="text-xs px-2 py-0.5 rounded bg-primary/20 text-primary font-medium border border-primary/30 hover:bg-primary/30 transition-colors"
              >
                OK
              </button>
              <button
                onClick={() => setLinkMode(false)}
                className="text-xs px-2 py-0.5 rounded bg-white/5 text-muted-foreground border border-border/40 hover:bg-white/10 transition-colors"
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              {TOOLS.map(({ fmt, icon, label }) => (
                <button
                  key={fmt}
                  onMouseDown={e => { e.preventDefault(); if (fmt === 'link') { handleLink(); } else { onFormat(fmt); } }}
                  title={label}
                  className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg hover:bg-white/10 active:bg-white/20 transition-colors text-foreground/80 hover:text-foreground min-w-[36px]"
                >
                  {icon}
                  <span className="text-[9px] leading-none text-muted-foreground">{label}</span>
                </button>
              ))}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
