import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Shield, Trash2, Ban, CheckCircle, ChevronUp, Search, RefreshCw, Crown, UserX, Zap, KeyRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

const API_BASE = '/api';

type AdminUser = {
  id: number;
  username: string;
  displayName: string;
  avatar: string | null;
  isOnline: boolean;
  isBanned: boolean;
  isAdmin: boolean;
  hasReplit: boolean;
  lastSeen: string | null;
  createdAt: string;
};

function getToken() {
  return localStorage.getItem('telechat_token');
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'jamais';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  return `il y a ${Math.floor(h / 24)}j`;
}

export function AdminPanel() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/users`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Forbidden');
      setUsers(await res.json());
    } catch {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de charger les utilisateurs' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function doAction(userId: number, path: string) {
    setActionLoading(userId);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/${path}`, {
        method: 'PATCH',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur serveur' }));
        throw new Error(err.error || 'Erreur');
      }
      const updated = await res.json();
      setUsers(prev => prev.map(u => u.id === userId ? updated : u));
      toast({ title: 'Action effectuée avec succès' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erreur', description: e.message });
    } finally {
      setActionLoading(null);
    }
  }

  async function doDelete(userId: number) {
    setActionLoading(userId);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur serveur' }));
        throw new Error(err.error || 'Erreur');
      }
      setUsers(prev => prev.filter(u => u.id !== userId));
      toast({ title: 'Utilisateur supprimé' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erreur', description: e.message });
    } finally {
      setActionLoading(null);
      setConfirmDelete(null);
    }
  }

  const filtered = users.filter(u =>
    u.displayName.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: users.length,
    online: users.filter(u => u.isOnline && !u.isBanned).length,
    banned: users.filter(u => u.isBanned).length,
    replit: users.filter(u => u.hasReplit).length,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <span className="font-bold text-base">Administration</span>
        </div>
        <button onClick={fetchUsers} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Total', value: stats.total, color: 'text-foreground' },
          { label: 'En ligne', value: stats.online, color: 'text-green-400' },
          { label: 'Bannis', value: stats.banned, color: 'text-red-400' },
          { label: 'Rapide', value: stats.replit, color: 'text-primary' },
        ].map(s => (
          <div key={s.label} className="glass rounded-xl p-2.5 text-center">
            <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un utilisateur..."
          className="pl-9 bg-white/5 border-white/10 text-sm"
        />
      </div>

      {/* Users list */}
      <div className="glass rounded-2xl overflow-hidden divide-y divide-white/5">
        {loading ? (
          <div className="py-10 text-center text-muted-foreground text-sm">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground text-sm">Aucun utilisateur trouvé</div>
        ) : filtered.map(u => {
          const isMe = u.id === (me as any)?.id;
          const busy = actionLoading === u.id;
          const initials = u.displayName.substring(0, 2).toUpperCase();

          return (
            <div key={u.id} className={`px-4 py-3 ${u.isBanned ? 'bg-red-500/5' : ''}`}>
              <div className="flex items-center gap-3">
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${u.isBanned ? 'bg-red-500/20 text-red-400' : 'bg-primary/20 text-primary'}`}>
                    {initials}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${u.isOnline && !u.isBanned ? 'bg-green-400' : 'bg-gray-500'}`} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold truncate">{u.displayName}</span>
                    {u.isAdmin && <Crown className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />}
                    {u.isBanned && <UserX className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                    {isMe && <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">Vous</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">@{u.username}</span>
                    {u.hasReplit
                      ? <span className="flex items-center gap-0.5 text-[10px] text-primary/70"><Zap className="w-2.5 h-2.5" /> Connexion rapide</span>
                      : <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground"><KeyRound className="w-2.5 h-2.5" /> Mot de passe</span>
                    }
                    <span className="text-[10px] text-muted-foreground">· {u.isOnline && !u.isBanned ? 'En ligne' : timeAgo(u.lastSeen)}</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              {!isMe && (
                <div className="flex gap-2 mt-2.5 flex-wrap">
                  {/* Ban/Unban */}
                  {u.isBanned ? (
                    <button
                      onClick={() => doAction(u.id, 'unban')}
                      disabled={busy}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-50"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Débannir
                    </button>
                  ) : (
                    <button
                      onClick={() => doAction(u.id, 'ban')}
                      disabled={busy}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      Bannir
                    </button>
                  )}

                  {/* Promote/Demote */}
                  {u.isAdmin ? (
                    <button
                      onClick={() => doAction(u.id, 'demote')}
                      disabled={busy}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 transition-colors disabled:opacity-50"
                    >
                      <ChevronUp className="w-3.5 h-3.5 rotate-180" />
                      Retirer admin
                    </button>
                  ) : (
                    <button
                      onClick={() => doAction(u.id, 'promote')}
                      disabled={busy}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 transition-colors disabled:opacity-50"
                    >
                      <Crown className="w-3.5 h-3.5" />
                      Rendre admin
                    </button>
                  )}

                  {/* Delete */}
                  {confirmDelete === u.id ? (
                    <div className="flex gap-1 ml-auto">
                      <button
                        onClick={() => doDelete(u.id)}
                        disabled={busy}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-600/80 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                      >
                        {busy ? '...' : 'Confirmer'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-white/10 text-muted-foreground hover:bg-white/15 transition-colors"
                      >
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(u.id)}
                      disabled={busy}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-white/5 text-muted-foreground hover:bg-red-500/15 hover:text-red-400 transition-colors disabled:opacity-50 ml-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Supprimer
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
