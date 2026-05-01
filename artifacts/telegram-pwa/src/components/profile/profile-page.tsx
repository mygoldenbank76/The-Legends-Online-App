import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Camera, Pencil, Settings, Copy, AtSign, FileText, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePreferences } from '@/lib/preferences-context';
import { ProfileEditorSheet } from './profile-editor-sheet';

const API_BASE = '/api';

function authJsonHeaders(): Record<string, string> {
  const token = localStorage.getItem('telechat_token');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

type ProfileUser = {
  displayName: string;
  username: string;
  avatar?: string | null;
  bio?: string | null;
};

type Props = {
  user: ProfileUser;
  onSaved: (updated: ProfileUser) => void;
  onNavigateTab?: (tab: 'settings') => void;
};

async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const SIZE = 256;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d')!;
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, SIZE, SIZE);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProfilePage({ user, onSaved, onNavigateTab }: Props) {
  const { toast } = useToast();
  const { t } = usePreferences();
  const p = t.profile;
  const fileRef = useRef<HTMLInputElement>(null);

  const [showEditor, setShowEditor] = useState(false);
  const [uploading, setUploading] = useState(false);

  const initials = user.displayName.substring(0, 2).toUpperCase() || '??';

  const copyUsername = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(user.username);
      toast({ title: p.usernameCopied, duration: 1600 });
    } catch {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Copie impossible' });
    }
  }, [p.usernameCopied, toast, user.username]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast({ variant: 'destructive', title: 'Format invalide', description: 'Sélectionne une image (JPG, PNG, WebP...)' });
        return;
      }
      setUploading(true);
      try {
        const compressed = await compressImage(file);
        const res = await fetch(`${API_BASE}/users/me/profile`, {
          method: 'PATCH',
          headers: authJsonHeaders(),
          body: JSON.stringify({ avatar: compressed }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Erreur serveur');
        }
        const updated = await res.json();
        onSaved(updated);
        toast({ title: p.saved, duration: 1400 });
      } catch (err: any) {
        toast({ variant: 'destructive', title: 'Erreur', description: err?.message || 'Impossible de mettre à jour la photo' });
      } finally {
        setUploading(false);
      }
    },
    [onSaved, p.saved, toast],
  );

  return (
    <div
      className="h-full overflow-y-auto overscroll-contain"
      style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="flex flex-col gap-5 px-4 pt-8">
        {/* Hero: avatar + name + status */}
        <div className="flex flex-col items-center gap-4">
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', damping: 22, stiffness: 240 }}
            className="relative mb-2"
          >
            <span aria-hidden className="absolute -inset-1 rounded-[1.75rem] profile-hero-ring pointer-events-none" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative w-28 h-28 rounded-3xl bg-primary/20 overflow-hidden glow-primary-sm group"
              aria-label={p.setPhoto}
              data-testid="button-hero-avatar"
            >
              {user.avatar ? (
                <img src={user.avatar} alt={user.displayName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-5xl font-bold text-primary">{initials}</span>
                </div>
              )}
              <div className="absolute inset-0 bg-black/55 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploading ? (
                  <Loader2 className="w-7 h-7 text-white animate-spin" />
                ) : (
                  <Camera className="w-7 h-7 text-white" />
                )}
              </div>
              {uploading && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Loader2 className="w-7 h-7 text-white animate-spin" />
                </div>
              )}
            </button>
          </motion.div>

          <div className="flex flex-col items-center text-center gap-1">
            <p className="text-2xl font-bold leading-tight" data-testid="text-display-name">{user.displayName}</p>
            <p className="text-sm text-primary">{t.chat.online}</p>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Three action buttons row */}
        <div className="grid grid-cols-3 gap-2.5">
          <ActionButton
            icon={<Camera className="w-5 h-5" />}
            label={p.setPhoto}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            testId="button-set-photo"
          />
          <ActionButton
            icon={<Pencil className="w-5 h-5" />}
            label={p.editInfo}
            onClick={() => setShowEditor(true)}
            testId="button-edit-info"
          />
          <ActionButton
            icon={<Settings className="w-5 h-5" />}
            label={t.tabs.settings}
            onClick={() => onNavigateTab?.('settings')}
            testId="button-open-settings"
          />
        </div>

        {/* Info card: identifier + bio */}
        <div className="glass rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={copyUsername}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/5 active:bg-white/10 transition-colors"
            data-testid="button-copy-username"
          >
            <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
              <AtSign className="w-4 h-4 text-primary" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium truncate">@{user.username}</span>
              <span className="text-xs text-muted-foreground">{p.username}</span>
            </div>
            <Copy className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          </button>

          <div className="h-px bg-white/8 mx-4" />

          <button
            type="button"
            onClick={() => setShowEditor(true)}
            className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-white/5 active:bg-white/10 transition-colors"
            data-testid="button-bio-edit"
          >
            <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              {user.bio && user.bio.trim().length > 0 ? (
                <span className="text-sm font-medium whitespace-pre-wrap break-words">{user.bio}</span>
              ) : (
                <span className="text-sm text-muted-foreground italic">{p.noBio}</span>
              )}
              <span className="text-xs text-muted-foreground mt-0.5">{p.bio}</span>
            </div>
          </button>
        </div>
      </div>

      {showEditor && (
        <ProfileEditorSheet
          user={user}
          onClose={() => setShowEditor(false)}
          onSaved={(u) => {
            onSaved(u);
            setShowEditor(false);
          }}
        />
      )}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="glass rounded-2xl px-3 py-3 flex flex-col items-center gap-1.5 hover:bg-white/10 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 transition-all"
    >
      <span className="text-primary">{icon}</span>
      <span className="text-xs font-medium leading-tight text-center whitespace-nowrap truncate max-w-full">{label}</span>
    </button>
  );
}
