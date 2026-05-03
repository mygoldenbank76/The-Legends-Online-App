import { useEffect, useState } from 'react';
import { Download, Apple, Globe, Smartphone, ShieldCheck, Zap, Clock, Share, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnimatedBackground } from '@/components/animated-background';

// All APK metadata + bytes are now fetched through our own /api/download/apk
// proxy so users never see a github.com URL in their browser bar or in the
// system download notification — the install looks 100% first-party.
const NATIVE_APK_PROXY_INFO = '/api/download/apk/info';
const NATIVE_APK_PROXY_DOWNLOAD = '/api/download/apk';
const NATIVE_APK_ASSET_NAME = 'The Legends Online.apk';
const WEB_URL = 'https://thelegendsonline.social/';

type ApkSource = {
  url: string;
  sizeMb: number | null;
  kind: 'native';
};

async function resolveNativeApk(): Promise<ApkSource | null> {
  try {
    const r = await fetch(NATIVE_APK_PROXY_INFO, { cache: 'no-store' });
    if (!r.ok) return null;
    const data: { available: boolean; sizeMb: number | null; url: string } = await r.json();
    if (!data.available) return null;
    return { url: data.url || NATIVE_APK_PROXY_DOWNLOAD, sizeMb: data.sizeMb, kind: 'native' };
  } catch {
    return null;
  }
}

export default function InstallApk() {
  const [apk, setApk] = useState<ApkSource | null | 'loading'>('loading');

  useEffect(() => {
    (async () => {
      setApk(await resolveNativeApk());
    })();
  }, []);

  const apkSize = apk && apk !== 'loading' && apk.sizeMb ? `${apk.sizeMb.toFixed(1)} Mo` : null;
  const apkAvailable = apk === 'loading' ? null : apk !== null;
  const isNative = apk && apk !== 'loading' && apk.kind === 'native';

  return (
    <div className="min-h-[100dvh] relative text-foreground overflow-y-auto">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <AnimatedBackground />
      </div>

      <div className="relative z-10 flex flex-col items-center px-5 py-10 max-w-md mx-auto w-full">
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="relative mb-5">
            <span aria-hidden className="absolute inset-0 rounded-3xl bg-primary/40 blur-2xl animate-logo-pulse" />
            <span aria-hidden className="absolute -inset-2 rounded-[2rem] border border-primary/30 animate-logo-ring" />
            <span aria-hidden className="absolute -inset-4 rounded-[2.5rem] border border-primary/20 animate-logo-ring-slow" />
            <div className="relative w-24 h-24 rounded-3xl gradient-primary-soft border border-primary/40 flex items-center justify-center shadow-lg shadow-primary/30 animate-logo-float">
              <img src="/icon-192.png" alt="Logo" className="w-16 h-16 rounded-2xl" />
            </div>
          </div>
          <h1 className="text-2xl font-bold mb-2">The Legends Online</h1>
          <p className="text-sm text-muted-foreground max-w-xs">
            Choisis comment tu veux accéder à l'application.
          </p>
        </div>

        {/* === 1. Android APK === */}
        <section className="w-full rounded-2xl border border-primary/30 bg-background/60 backdrop-blur-sm p-5 mb-4 shadow-lg shadow-primary/5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <Smartphone className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold">Application Android</h2>
              <p className="text-[11px] text-muted-foreground">
                Application native officielle · Android 7.0+{apkSize ? ` · ${apkSize}` : ''}
              </p>
            </div>
            {isNative && (
              <span className="text-[10px] font-semibold text-emerald-400 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" /> Native
              </span>
            )}
          </div>

          {apkAvailable === false ? (
            <div className="text-center py-4 px-3 rounded-xl bg-destructive/10 border border-destructive/30">
              <p className="text-xs font-semibold mb-1 text-destructive">APK indisponible</p>
              <p className="text-[11px] text-muted-foreground">Le build est en cours. Reviens dans quelques minutes.</p>
            </div>
          ) : (
            <Button asChild size="lg" className="w-full text-base font-semibold gap-2 h-14">
              <a href={apk && apk !== 'loading' ? apk.url : '#'} download={NATIVE_APK_ASSET_NAME}>
                <Download className="w-5 h-5" />
                Télécharger l'application
              </a>
            </Button>
          )}

          <details className="mt-3 group">
            <summary className="text-[11px] text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
              Comment installer ?
            </summary>
            <ol className="mt-3 space-y-2 text-[11px] text-muted-foreground">
              <li><span className="text-primary font-semibold">1.</span> Touche le bouton de téléchargement.</li>
              <li><span className="text-primary font-semibold">2.</span> Autorise l'installation depuis ton navigateur si Android le demande.</li>
              <li><span className="text-primary font-semibold">3.</span> Ouvre le fichier téléchargé puis touche "Installer".</li>
            </ol>
          </details>
        </section>

        {/* === 2. iOS App (coming soon) === */}
        <section className="w-full rounded-2xl border border-border bg-background/40 backdrop-blur-sm p-5 mb-4 opacity-70">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-muted/40 border border-border flex items-center justify-center flex-shrink-0">
              <Apple className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold">Application iOS</h2>
              <p className="text-[11px] text-muted-foreground">iPhone · iPad</p>
            </div>
            <span className="text-[10px] font-semibold text-amber-400 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" /> Bientôt
            </span>
          </div>
          <Button disabled size="lg" className="w-full text-base font-semibold gap-2 h-14 cursor-not-allowed">
            <Apple className="w-5 h-5" />
            Bientôt disponible
          </Button>
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
            La version iOS arrive prochainement. En attendant, utilise la version web ou la PWA ci-dessous.
          </p>
        </section>

        {/* === 3. Web access === */}
        <section className="w-full rounded-2xl border border-border bg-background/40 backdrop-blur-sm p-5 mb-4">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
              <Globe className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold">Accès Web</h2>
              <p className="text-[11px] text-muted-foreground">Tous appareils · Aucune installation</p>
            </div>
          </div>
          <Button asChild variant="outline" size="lg" className="w-full text-base font-semibold gap-2 h-14">
            <a href={WEB_URL} target="_blank" rel="noopener noreferrer">
              <Globe className="w-5 h-5" />
              Ouvrir dans le navigateur
            </a>
          </Button>
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
            Accède à l'application directement depuis n'importe quel navigateur, sans rien installer.
          </p>
        </section>

        {/* === 4. PWA install === */}
        <section className="w-full rounded-2xl border border-border bg-background/40 backdrop-blur-sm p-5 mb-4">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
              <Plus className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold">Installer la PWA</h2>
              <p className="text-[11px] text-muted-foreground">Raccourci écran d'accueil · Tous appareils</p>
            </div>
          </div>
          <div className="rounded-xl bg-muted/30 border border-border p-4 space-y-3 text-[11px] text-muted-foreground">
            <div>
              <p className="font-semibold text-foreground mb-1 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5" /> Android (Chrome)
              </p>
              <p>Menu ⋮ → "Installer l'application" ou "Ajouter à l'écran d'accueil".</p>
            </div>
            <div className="border-t border-border pt-3">
              <p className="font-semibold text-foreground mb-1 flex items-center gap-1.5">
                <Apple className="w-3.5 h-3.5" /> iOS (Safari)
              </p>
              <p>Bouton <Share className="w-3 h-3 inline mb-0.5" /> Partager → "Sur l'écran d'accueil".</p>
            </div>
            <div className="border-t border-border pt-3">
              <p className="font-semibold text-foreground mb-1 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" /> Ordinateur (Chrome / Edge)
              </p>
              <p>Icône d'installation dans la barre d'adresse, ou Menu → "Installer The Legends Online".</p>
            </div>
          </div>
        </section>

        {/* Trust footer */}
        <div className="w-full rounded-xl border border-border/50 bg-background/30 px-4 py-3 flex items-center gap-3">
          <ShieldCheck className="w-4 h-4 flex-shrink-0 text-emerald-400" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            APK signé et vérifié. Connexion HTTPS chiffrée. Même compte sur toutes les versions.
          </p>
        </div>
      </div>
    </div>
  );
}
