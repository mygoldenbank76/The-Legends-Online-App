import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, User, AtSign, FileText, Save, Trash2, Loader2, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { usePreferences } from '@/lib/preferences-context';

const API_BASE = '/api';
function getToken() { return localStorage.getItem('telechat_token'); }
function authHeaders(isJson = true) {
  const h: Record<string, string> = { Authorization: `Bearer ${getToken()}` };
  if (isJson) h['Content-Type'] = 'application/json';
  return h;
}

type ProfileUser = {
  displayName: string;
  username: string;
  avatar?: string | null;
  bio?: string | null;
};

type Props = {
  user: ProfileUser;
  onClose: () => void;
  onSaved: (updated: ProfileUser) => void;
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
        // Crop to square from center
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

export function ProfileEditorSheet({ user, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const { t } = usePreferences();
  const p = t.profile;
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio || '');
  const [avatar, setAvatar] = useState<string | null | undefined>(user.avatar);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'Format invalide', description: 'Sélectionne une image (JPG, PNG, WebP...)' });
      return;
    }
    try {
      const compressed = await compressImage(file);
      setAvatar(compressed);
      setAvatarChanged(true);
    } catch {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de traiter l\'image' });
    }
    // Reset input so same file can be picked again
    e.target.value = '';
  }, [toast]);

  function removeAvatar() {
    setAvatar(null);
    setAvatarChanged(true);
  }

  async function save() {
    const trimmedName = displayName.trim();
    const trimmedUser = username.trim().toLowerCase();

    if (!trimmedName || trimmedName.length > 50) {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Nom affiché invalide (1–50 caractères)' });
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(trimmedUser)) {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Identifiant invalide (3–20 car., lettres, chiffres, _)' });
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, string | null> = {
        displayName: trimmedName,
        username: trimmedUser,
        bio: bio.trim() || '',
      };
      if (avatarChanged) body.avatar = avatar ?? null;

      const res = await fetch(`${API_BASE}/users/me/profile`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erreur serveur');
      }
      const updated = await res.json();
      setSaved(true);
      onSaved(updated);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 800);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erreur', description: e.message });
    } finally {
      setLoading(false);
    }
  }

  const initials = displayName.substring(0, 2).toUpperCase() || '??';
  const bioLen = bio.length;
  const hasChanges =
    displayName.trim() !== user.displayName ||
    username.trim().toLowerCase() !== user.username ||
    bio.trim() !== (user.bio || '') ||
    avatarChanged;

  return createPortal(
    <AnimatePresence>
      <>
        {/* Backdrop */}
        <motion.div
          key="profile-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Sheet — bottom sheet on mobile, centered dialog on desktop */}
        <motion.div
          key="profile-sheet"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="fixed inset-x-0 bottom-0 z-50 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-4"
          onClick={onClose}
        >
          <div className="glass-strong rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden w-full sm:max-w-md sm:mx-auto" style={{ height: 'calc(100dvh - 2rem)' }} onClick={e => e.stopPropagation()}>
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl gradient-primary glow-primary-sm flex items-center justify-center">
                  <User className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="font-bold text-sm">{p.editProfile}</p>
                  <p className="text-xs text-muted-foreground">{p.publicInfo}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/15 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              {/* Avatar section */}
              <div className="flex flex-col items-center gap-3 pt-6 pb-4 px-5">
                <div className="relative">
                  <div
                    className="w-24 h-24 rounded-3xl bg-primary/20 overflow-hidden cursor-pointer relative group"
                    onClick={() => fileRef.current?.click()}
                  >
                    {avatar ? (
                      <img src={avatar} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-3xl font-bold text-primary">{initials}</span>
                      </div>
                    )}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera className="w-6 h-6 text-white" />
                    </div>
                  </div>

                  {/* Camera button overlay */}
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="absolute -bottom-1 -right-1 w-8 h-8 rounded-xl gradient-primary glow-primary-sm flex items-center justify-center shadow-lg hover:opacity-90 active:scale-95 transition-all"
                  >
                    <Camera className="w-4 h-4 text-white" />
                  </button>
                </div>

                {/* Avatar actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="text-xs px-3 py-1.5 rounded-lg gradient-primary-soft border border-primary/30 text-primary hover:opacity-90 active:scale-95 transition-all"
                  >
                    {avatar ? p.changePhoto : p.addPhoto}
                  </button>
                  {avatar && (
                    <button
                      onClick={removeAvatar}
                      className="text-xs px-3 py-1.5 rounded-lg bg-white/10 text-muted-foreground hover:bg-red-500/15 hover:text-red-400 transition-colors flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      {p.removePhoto}
                    </button>
                  )}
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {/* Fields */}
              <div className="px-5 pb-2 flex flex-col gap-3">
                {/* Display name */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    <User className="w-3 h-3" /> {p.displayName}
                  </label>
                  <Input
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder={p.displayNamePlaceholder}
                    maxLength={50}
                    className="bg-white/5 border-white/10"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1 text-right">{displayName.length}/50</p>
                </div>

                {/* Username */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    <AtSign className="w-3 h-3" /> {p.username}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                    <Input
                      value={username}
                      onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                      placeholder="username"
                      maxLength={20}
                      className="bg-white/5 border-white/10 pl-7"
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">{p.usernameHint}</p>
                </div>

                {/* Bio */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    <FileText className="w-3 h-3" /> {p.bio}
                  </label>
                  <textarea
                    value={bio}
                    onChange={e => setBio(e.target.value.slice(0, 160))}
                    placeholder={p.bioPlaceholder}
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
                  />
                  <p className={`text-[10px] mt-1 text-right ${bioLen > 140 ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                    {bioLen}/160
                  </p>
                </div>
              </div>

              {/* Save button */}
              <div className="px-5 pb-8 pt-2">
                <button
                  onClick={save}
                  disabled={!hasChanges || loading}
                  className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm transition-all ${
                    saved
                      ? 'bg-green-500 text-white'
                      : hasChanges
                        ? 'gradient-primary glow-primary text-white hover:opacity-95 active:scale-[0.97]'
                        : 'bg-white/10 text-muted-foreground cursor-not-allowed'
                  }`}
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> {p.saving}</>
                  ) : saved ? (
                    <><Check className="w-4 h-4" /> {p.saved}</>
                  ) : (
                    <><Save className="w-4 h-4" /> {p.save}</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </>
    </AnimatePresence>,
    document.body
  );
}
