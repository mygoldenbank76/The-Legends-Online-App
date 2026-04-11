import { useState, useEffect } from 'react';
import { X, KeyRound, Zap, Crown, ShieldOff, Send, Eye, EyeOff, Copy, Check, User, Clock, Calendar, Hash } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

const API_BASE = '/api';

function getToken() { return localStorage.getItem('telechat_token'); }
function authHeaders() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }; }

type UserDetail = {
  id: number;
  username: string;
  displayName: string;
  avatar: string | null;
  isOnline: boolean;
  isBanned: boolean;
  isAdmin: boolean;
  hasReplit: boolean;
  hasPassword: boolean;
  replitId: string | null;
  lastSeen: string | null;
  createdAt: string;
};

type Props = {
  userId: number;
  onClose: () => void;
  onNavigateToDM?: (conversationId: number) => void;
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'jamais';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  return `il y a ${Math.floor(h / 24)} jours`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function UserDetailsModal({ userId, onClose, onNavigateToDM }: Props) {
  const { toast } = useToast();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Password change
  const [newPassword, setNewPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);

  // DM
  const [dmContent, setDmContent] = useState('');
  const [dmLoading, setDmLoading] = useState(false);

  // Copy feedback
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/users/${userId}/details`, { headers: authHeaders() });
        if (!res.ok) throw new Error('Erreur');
        setUser(await res.json());
      } catch {
        toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de charger les détails' });
        onClose();
      } finally {
        setLoading(false);
      }
    })();
  }, [userId, toast, onClose]);

  async function changePassword() {
    if (!newPassword.trim()) return;
    setPwdLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/password`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ newPassword }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erreur');
      }
      toast({ title: 'Mot de passe modifié', description: `Nouveau mot de passe défini pour @${user?.username}` });
      setNewPassword('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erreur', description: e.message });
    } finally {
      setPwdLoading(false);
    }
  }

  async function sendDM() {
    if (!dmContent.trim()) return;
    setDmLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/dm`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ content: dmContent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erreur');
      }
      const data = await res.json();
      toast({ title: 'Message envoyé', description: `MP envoyé à @${user?.username}` });
      setDmContent('');
      if (onNavigateToDM) onNavigateToDM(data.conversationId);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erreur', description: e.message });
    } finally {
      setDmLoading(false);
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
        <div className="glass-strong w-full max-w-md rounded-t-3xl p-6">
          <div className="text-center text-muted-foreground">Chargement...</div>
        </div>
      </div>
    );
  }

  if (!user) return null;
  const initials = user.displayName.substring(0, 2).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-strong w-full max-w-md rounded-t-3xl flex flex-col gap-0 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="font-bold text-base">Détails utilisateur</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Avatar + name */}
        <div className="flex flex-col items-center gap-3 px-5 pb-4">
          <div className="relative">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold ${user.isBanned ? 'bg-red-500/20 text-red-400' : 'bg-primary/20 text-primary'}`}>
              {initials}
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background ${user.isOnline && !user.isBanned ? 'bg-green-400' : 'bg-gray-500'}`} />
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-2">
              <span className="font-bold text-lg">{user.displayName}</span>
              {user.isAdmin && <Crown className="w-4 h-4 text-yellow-400" />}
              {user.isBanned && <ShieldOff className="w-4 h-4 text-red-400" />}
            </div>
            <span className="text-sm text-muted-foreground">@{user.username}</span>
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            {user.hasPassword && (
              <span className="flex items-center gap-1 text-xs bg-white/10 px-2.5 py-1 rounded-full">
                <KeyRound className="w-3 h-3" /> Mot de passe
              </span>
            )}
            {user.hasReplit && (
              <span className="flex items-center gap-1 text-xs bg-primary/20 text-primary px-2.5 py-1 rounded-full">
                <Zap className="w-3 h-3" /> Connexion rapide
              </span>
            )}
            {user.isBanned && (
              <span className="text-xs bg-red-500/20 text-red-400 px-2.5 py-1 rounded-full">Suspendu</span>
            )}
            {user.isAdmin && (
              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2.5 py-1 rounded-full">Administrateur</span>
            )}
          </div>
        </div>

        {/* Info fields */}
        <div className="px-5 pb-4 flex flex-col gap-2">
          <InfoRow
            icon={<Hash className="w-3.5 h-3.5" />}
            label="ID utilisateur"
            value={String(user.id)}
            onCopy={() => copyToClipboard(String(user.id), 'id')}
            copied={copied === 'id'}
          />
          <InfoRow
            icon={<User className="w-3.5 h-3.5" />}
            label="Nom d'utilisateur"
            value={`@${user.username}`}
            onCopy={() => copyToClipboard(user.username, 'username')}
            copied={copied === 'username'}
          />
          {user.replitId && (
            <InfoRow
              icon={<Zap className="w-3.5 h-3.5" />}
              label="ID Replit"
              value={user.replitId}
              onCopy={() => copyToClipboard(user.replitId!, 'replitId')}
              copied={copied === 'replitId'}
            />
          )}
          <InfoRow
            icon={<Calendar className="w-3.5 h-3.5" />}
            label="Inscrit le"
            value={formatDate(user.createdAt)}
          />
          <InfoRow
            icon={<Clock className="w-3.5 h-3.5" />}
            label="Dernière activité"
            value={user.isOnline && !user.isBanned ? 'En ligne' : timeAgo(user.lastSeen)}
          />
        </div>

        {/* Divider */}
        <div className="h-px bg-white/10 mx-5" />

        {/* Change password */}
        <div className="px-5 py-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Changer le mot de passe</p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showPwd ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Nouveau mot de passe..."
                className="bg-white/5 border-white/10 text-sm pr-10"
                onKeyDown={e => e.key === 'Enter' && changePassword()}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={changePassword}
              disabled={!newPassword.trim() || pwdLoading}
              className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              {pwdLoading ? '...' : 'Définir'}
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/10 mx-5" />

        {/* Send DM */}
        <div className="px-5 py-4 pb-8">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Envoyer un message privé</p>
          <div className="flex gap-2">
            <Input
              value={dmContent}
              onChange={e => setDmContent(e.target.value)}
              placeholder={`Message à @${user.username}...`}
              className="bg-white/5 border-white/10 text-sm flex-1"
              onKeyDown={e => e.key === 'Enter' && sendDM()}
            />
            <button
              onClick={sendDM}
              disabled={!dmContent.trim() || dmLoading}
              className="p-2.5 rounded-xl bg-primary text-white disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon, label, value, onCopy, copied
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5">
      <span className="text-muted-foreground flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-muted-foreground leading-none mb-0.5">{label}</p>
        <p className="text-sm font-medium truncate">{value}</p>
      </div>
      {onCopy && (
        <button onClick={onCopy} className="p-1 rounded hover:bg-white/10 text-muted-foreground transition-colors flex-shrink-0">
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}
