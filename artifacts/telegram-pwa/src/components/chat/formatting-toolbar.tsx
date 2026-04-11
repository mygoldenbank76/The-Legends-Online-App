import React, { useRef, useEffect } from 'react';
import { Bold, Italic, Underline, Strikethrough, Eye, Link } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { FormatType } from './rich-text';

interface Props {
  hasSelection: boolean;
  linkMode: boolean;
  linkUrl: string;
  onLinkUrlChange: (url: string) => void;
  onLinkConfirm: () => void;
  onLinkCancel: () => void;
  onFormat: (fmt: FormatType) => void;
  onLinkRequest: () => void;
  visible: boolean;
}

const TOOLS: Array<{ fmt: FormatType; icon: React.ReactNode; label: string }> = [
  { fmt: 'bold',      icon: <Bold className="w-[15px] h-[15px]" />,          label: 'Gras' },
  { fmt: 'italic',    icon: <Italic className="w-[15px] h-[15px]" />,        label: 'Italique' },
  { fmt: 'underline', icon: <Underline className="w-[15px] h-[15px]" />,     label: 'Souligner' },
  { fmt: 'strike',    icon: <Strikethrough className="w-[15px] h-[15px]" />, label: 'Barrer' },
  { fmt: 'spoiler',   icon: <Eye className="w-[15px] h-[15px]" />,           label: 'Spoiler' },
  { fmt: 'link',      icon: <Link className="w-[15px] h-[15px]" />,          label: 'Lien' },
];

export function FormattingToolbar({
  hasSelection, linkMode, linkUrl, onLinkUrlChange,
  onLinkConfirm, onLinkCancel, onFormat, onLinkRequest, visible,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (linkMode && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [linkMode]);

  if (!visible) return null;

  return (
    <div className="border-b border-border/30 bg-card/40 backdrop-blur-sm">
      <AnimatePresence mode="wait">
        {linkMode ? (
          <motion.div
            key="link"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="flex items-center gap-2 px-3 py-2"
          >
            <Link className="w-3.5 h-3.5 text-primary flex-shrink-0" />
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
              inputMode="url"
              className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground/50 min-w-0"
            />
            <button
              onMouseDown={e => { e.preventDefault(); onLinkConfirm(); }}
              className="text-xs px-3 py-1 rounded-full bg-primary text-primary-foreground font-semibold hover:bg-primary/90 active:scale-95 transition-all flex-shrink-0"
            >
              OK
            </button>
            <button
              onMouseDown={e => { e.preventDefault(); onLinkCancel(); }}
              className="text-xs px-2 py-1 rounded-full bg-white/8 text-muted-foreground hover:bg-white/15 transition-colors flex-shrink-0"
            >
              ✕
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="tools"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="flex items-center px-2 py-1"
          >
            {TOOLS.map(({ fmt, icon, label }) => {
              const active = hasSelection;
              return (
                <button
                  key={fmt}
                  onMouseDown={e => {
                    e.preventDefault();
                    if (fmt === 'link') { onLinkRequest(); }
                    else { onFormat(fmt); }
                  }}
                  title={label}
                  className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg transition-all duration-150 min-w-[38px]
                    ${active
                      ? 'text-foreground hover:bg-primary/20 hover:text-primary active:bg-primary/30 active:scale-95'
                      : 'text-foreground/35 hover:text-foreground/60 hover:bg-white/5'
                    }`}
                >
                  {icon}
                  <span className="text-[8.5px] leading-none font-medium">{label}</span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
