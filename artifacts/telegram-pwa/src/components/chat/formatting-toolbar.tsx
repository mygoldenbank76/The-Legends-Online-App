import React, { useRef, useEffect } from 'react';
import { Bold, Italic, Underline, Strikethrough, Eye, Link, Copy, Clipboard } from 'lucide-react';
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
  onCopy: () => void;
  onPaste: () => void;
  visible: boolean;
}

const FORMAT_TOOLS: Array<{ fmt: FormatType; icon: React.ReactNode; label: string }> = [
  { fmt: 'bold',      icon: <Bold className="w-[15px] h-[15px]" />,          label: 'Gras' },
  { fmt: 'italic',    icon: <Italic className="w-[15px] h-[15px]" />,        label: 'Italique' },
  { fmt: 'underline', icon: <Underline className="w-[15px] h-[15px]" />,     label: 'Souligner' },
  { fmt: 'strike',    icon: <Strikethrough className="w-[15px] h-[15px]" />, label: 'Barrer' },
  { fmt: 'spoiler',   icon: <Eye className="w-[15px] h-[15px]" />,           label: 'Spoiler' },
  { fmt: 'link',      icon: <Link className="w-[15px] h-[15px]" />,          label: 'Lien' },
];

function ToolBtn({ onPress, icon, label, disabled }: {
  onPress: () => void; icon: React.ReactNode; label: string; disabled?: boolean;
}) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); if (!disabled) onPress(); }}
      onTouchEnd={e => { e.preventDefault(); if (!disabled) onPress(); }}
      title={label}
      aria-label={label}
      disabled={disabled}
      className={`flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150 flex-shrink-0
        ${disabled
          ? 'text-foreground/25 cursor-default'
          : 'text-foreground/80 hover:bg-primary/15 hover:text-primary active:bg-primary/25 active:scale-95 cursor-pointer'
        }`}
    >
      {icon}
    </button>
  );
}

export function FormattingToolbar({
  hasSelection, linkMode, linkUrl, onLinkUrlChange,
  onLinkConfirm, onLinkCancel, onFormat, onLinkRequest,
  onCopy, onPaste, visible,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (linkMode && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [linkMode]);

  if (!visible) return null;

  return (
    <AnimatePresence initial={false}>
      {(hasSelection || linkMode) && (
        <motion.div
          key="format-bar"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          style={{ overflow: 'hidden' }}
        >
          <AnimatePresence mode="wait">
            {linkMode ? (
              <motion.div
                key="link"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="flex items-center gap-2.5 pl-3 pr-2 pt-2 pb-1.5"
              >
                <Link className="w-4 h-4 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0 border-l-2 border-primary pl-2 flex items-center gap-2">
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
                    className="flex-1 bg-transparent text-[12px] text-primary font-semibold leading-tight outline-none placeholder:text-muted-foreground/50 min-w-0"
                  />
                  <button
                    onMouseDown={e => { e.preventDefault(); onLinkConfirm(); }}
                    onTouchEnd={e => { e.preventDefault(); onLinkConfirm(); }}
                    className="text-[11px] px-2.5 py-0.5 rounded-full gradient-primary glow-primary text-white font-semibold hover:opacity-95 active:scale-95 transition-all flex-shrink-0"
                  >
                    OK
                  </button>
                </div>
                <button
                  onMouseDown={e => { e.preventDefault(); onLinkCancel(); }}
                  onTouchEnd={e => { e.preventDefault(); onLinkCancel(); }}
                  className="text-muted-foreground hover:text-foreground p-1 flex-shrink-0 rounded-full hover:bg-foreground/5 transition-colors"
                  aria-label="Annuler le lien"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="tools"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="flex items-center gap-0.5 px-2 pt-1.5 pb-1 overflow-x-auto no-scrollbar"
              >
                {/* Clipboard actions first */}
                <ToolBtn
                  onPress={onCopy}
                  icon={<Copy className="w-[15px] h-[15px]" />}
                  label="Copier"
                  disabled={!hasSelection}
                />
                <ToolBtn
                  onPress={onPaste}
                  icon={<Clipboard className="w-[15px] h-[15px]" />}
                  label="Coller"
                />
                {/* Divider */}
                <div className="w-px h-5 bg-foreground/10 flex-shrink-0 mx-1" />
                {/* Format tools */}
                {FORMAT_TOOLS.map(({ fmt, icon, label }) => (
                  <ToolBtn
                    key={fmt}
                    onPress={() => fmt === 'link' ? onLinkRequest() : onFormat(fmt)}
                    icon={icon}
                    label={label}
                    disabled={!hasSelection}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
