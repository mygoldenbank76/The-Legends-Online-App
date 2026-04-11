import { AnimatePresence, motion } from 'framer-motion';
import { Camera, ImageIcon, FileText, BarChart2 } from 'lucide-react';
import { usePreferences } from '@/lib/preferences-context';

type Props = {
  open: boolean;
  onClose: () => void;
  onCamera: () => void;
  onGallery: () => void;
  onDocument: () => void;
  onPoll: () => void;
};

export function AttachmentSheet({ open, onClose, onCamera, onGallery, onDocument, onPoll }: Props) {
  const { t } = usePreferences();

  const items = [
    { key: 'camera',   label: t.attachments.camera,   icon: Camera,    bg: 'bg-pink-600'   },
    { key: 'gallery',  label: t.attachments.gallery,  icon: ImageIcon, bg: 'bg-blue-600'   },
    { key: 'document', label: t.attachments.document, icon: FileText,  bg: 'bg-purple-600' },
    { key: 'poll',     label: t.attachments.poll,     icon: BarChart2, bg: 'bg-amber-700'  },
  ];

  const handlers: Record<string, () => void> = {
    camera: onCamera,
    gallery: onGallery,
    document: onDocument,
    poll: onPoll,
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.div
            className="relative w-full max-w-lg mb-4"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="glass-strong mx-4 rounded-2xl p-4">
              <div className="grid grid-cols-4 gap-3">
                {items.map(item => (
                  <button
                    key={item.key}
                    onClick={() => {
                      onClose();
                      setTimeout(() => handlers[item.key](), 250);
                    }}
                    className="flex flex-col items-center gap-2 group"
                  >
                    <div className={`w-14 h-14 rounded-2xl ${item.bg} flex items-center justify-center shadow-lg group-active:scale-95 transition-transform`}>
                      <item.icon className="w-7 h-7 text-white" />
                    </div>
                    <span className="text-xs text-foreground font-medium">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
