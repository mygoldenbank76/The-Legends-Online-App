import { useEffect } from 'react';
import { useParams } from 'wouter';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';

export default function JoinGroup() {
  const { id } = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    const base = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';
    if (!user) {
      sessionStorage.setItem('telechat_join_conv', id ?? '');
      window.location.href = `${base}/login`;
    } else {
      window.location.href = `${base}/?conv=${id}&type=group`;
    }
  }, [id, user, isLoading]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Ouverture du groupe…</p>
      </div>
    </div>
  );
}
