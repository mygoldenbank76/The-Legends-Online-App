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
      disabled={disabled}
      className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-all duration-150 min-w-[36px]
        ${disabled
          ? 'text-foreground/25 cursor-default'
          : 'text-foreground hover:bg-primary/20 hover:text-primary active:bg-primary/30 active:scale-95 cursor-pointer'
        }`}
    >
      {icon}
      <span className="text-[8px] leading-none font-medium whitespace-nowrap">{label}</span>
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
    <AnimatePresence>
      {(hasSelection || linkMode) && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.15 }}
          className="overflow-hidden border-b border-border/30 bg-card/60 backdrop-blur-md"
        >
          <AnimatePresence mode="wait">
            {linkMode ? (
              <motion.div
                key="link"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="flex items-center gap-2 px-3 py-2.5"
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
                  onTouchEnd={e => { e.preventDefault(); onLinkConfirm(); }}
                  className="text-xs px-3 py-1 rounded-full bg-primary text-primary-foreground font-semibold hover:bg-primary/90 active:scale-95 transition-all flex-shrink-0"
                >
                  OK
                </button>
                <button
                  onMouseDown={e => { e.preventDefault(); onLinkCancel(); }}
                  onTouchEnd={e => { e.preventDefault(); onLinkCancel(); }}
                  className="text-xs px-2.5 py-1 rounded-full bg-white/8 text-muted-foreground hover:bg-white/15 transition-colors flex-shrink-0"
                >
                  ✕
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="tools"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="flex items-center px-1 py-0.5 overflow-x-auto scrollbar-none"
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
                <div className="w-px h-6 bg-border/50 mx-0.5 flex-shrink-0" />
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
