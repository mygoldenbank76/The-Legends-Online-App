import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Link2, Image as ImageIcon, FileText, Mic } from 'lucide-react';

type Participant = {
  id: number;
  displayName: string;
  avatar?: string | null;
  isOnline?: boolean;
};

type Conversation = {
  id: number;
  name?: string | null;
  type: string;
  participants?: Participant[];
};

type Msg = {
  imageUrl?: string | null;
  audioUrl?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  conversation: Conversation;
  messages: Msg[];
};

type Tab = 'Médias' | 'Fichiers' | 'Voix';

export function GroupInfoSheet({ open, onClose, conversation, messages }: Props) {
  const [tab, setTab] = useState<Tab>('Médias');

  const title = conversation?.name || 'Conversation';
  const initial = title.substring(0, 1).toUpperCase();
  const memberCount = conversation?.participants?.length ?? 0;
  const groupLink = `legends://group/${conversation.id.toString().padStart(24, '0').replace(/(.{8})/g, '$1-').slice(0, -1)}`;

  const mediaMessages = messages.filter(m => m.imageUrl);
  const voiceMessages = messages.filter(m => m.audioUrl);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[450] flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            className="relative w-full max-w-lg"
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="glass-strong rounded-t-3xl max-h-[80vh] flex flex-col">
              {/* Close button */}
              <div className="flex justify-end p-3 pb-0">
                <button onClick={onClose} className="w-8 h-8 rounded-full glass flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Avatar + name */}
              <div className="flex flex-col items-center pb-4 px-4">
                <div className="w-20 h-20 rounded-2xl bg-primary/20 flex items-center justify-center mb-3">
                  <span className="text-3xl font-bold text-primary">{initial}</span>
                </div>
                <h2 className="text-lg font-bold text-foreground">{title}</h2>
                <p className="text-sm text-muted-foreground">{memberCount} membres</p>
              </div>

              {/* Group link */}
              <div className="mx-4 mb-4 glass rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Link2 className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground">Lien du groupe</p>
                  <p className="text-xs text-foreground truncate font-mono">{groupLink.substring(0, 35)}...</p>
                </div>
                <button
                  onClick={() => navigator.clipboard?.writeText(groupLink)}
                  className="text-muted-foreground hover:text-primary transition-colors p-1 flex-shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeWidth="2" />
                  </svg>
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-border/50 mx-4">
                {(['Médias', 'Fichiers', 'Voix'] as Tab[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                      tab === t
                        ? 'text-primary border-b-2 border-primary -mb-px'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto p-4 min-h-[120px]">
                {tab === 'Médias' && (
                  mediaMessages.length > 0 ? (
                    <div className="grid grid-cols-3 gap-1">
                      {mediaMessages.map((m, i) => (
                        <div key={i} className="aspect-square rounded-lg overflow-hidden">
                          <img src={m.imageUrl!} alt="" className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon={<ImageIcon className="w-8 h-8" />} label="Aucun média partagé" />
                  )
                )}
                {tab === 'Fichiers' && (
                  <EmptyState icon={<FileText className="w-8 h-8" />} label="Aucun fichier partagé" />
                )}
                {tab === 'Voix' && (
                  voiceMessages.length > 0 ? (
                    <div className="space-y-2">
                      {voiceMessages.map((m, i) => (
                        <div key={i} className="glass rounded-xl px-3 py-2 flex items-center gap-2">
                          <Mic className="w-4 h-4 text-primary flex-shrink-0" />
                          <span className="text-xs text-muted-foreground">Message vocal {i + 1}</span>
                          <audio controls src={m.audioUrl!} className="flex-1 h-6" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon={<Mic className="w-8 h-8" />} label="Aucun message vocal" />
                  )
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
      {icon}
      <p className="text-sm">{label}</p>
    </div>
  );
}
