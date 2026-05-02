import { useEffect, useState } from 'react';
import { Download, Smartphone, ShieldCheck, Sparkles, ExternalLink, Globe, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnimatedBackground } from '@/components/animated-background';

// Set this once you've connected the project to GitHub and the first
// "Build Android APK" workflow has finished. Format: "owner/repository".
// Leaving it null falls back to the legacy TWA APK shipped in /downloads.
const GITHUB_REPO: string | null = 'mygoldenbank76/The-Legends-Online-App';

const TWA_APK_URL = '/downloads/legends.apk';
const NATIVE_APK_RELEASE_TAG = 'native-latest';
const NATIVE_APK_ASSET_NAME = 'The Legends Online.apk';

type ApkSource = {
  url: string;
  sizeMb: number | null;
  kind: 'native' | 'twa';
};

function detectPlatform(): 'android' | 'ios' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'desktop';
}

async function resolveNativeApk(): Promise<ApkSource | null> {
  if (!GITHUB_REPO) return null;
  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${NATIVE_APK_RELEASE_TAG}`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!r.ok) return null;
    const data: { assets?: Array<{ name: string; browser_download_url: string; size: number }> } = await r.json();
    const asset = data.assets?.find((a) => a.name === NATIVE_APK_ASSET_NAME);
    if (!asset) return null;
    return { url: asset.browser_download_url, sizeMb: asset.size / (1024 * 1024), kind: 'native' };
  } catch {
    return null;
  }
}

async function resolveTwaApk(): Promise<ApkSource | null> {
  try {
    const r = await fetch(TWA_APK_URL, { method: 'HEAD' });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.includes('android.package-archive')) return null;
    const len = r.headers.get('content-length');
    return { url: TWA_APK_URL, sizeMb: len ? Number(len) / (1024 * 1024) : null, kind: 'twa' };
  } catch {
    return null;
  }
}

export default function InstallApk() {
  const [platform, setPlatform] = useState<'android' | 'ios' | 'desktop'>('desktop');
  const [apk, setApk] = useState<ApkSource | null | 'loading'>('loading');

  useEffect(() => {
    setPlatform(detectPlatform());
    // Try the GitHub-built native APK first (if configured), fall back to
    // the in-repo TWA APK so the page always offers something installable.
    (async () => {
      const native = await resolveNativeApk();
      if (native) {
        setApk(native);
        return;
      }
      const twa = await resolveTwaApk();
      setApk(twa);
    })();
  }, []);

  const isAndroid = platform === 'android';
  const apkSize = apk && apk !== 'loading' && apk.sizeMb ? `${apk.sizeMb.toFixed(1)} Mo` : null;
  const apkAvailable = apk === 'loading' ? null : apk !== null;
  const isNative = apk && apk !== 'loading' && apk.kind === 'native';

  return (
    <div className="min-h-[100dvh] flex flex-col relative overflow-hidden text-foreground">
      <AnimatedBackground />

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-5 py-10 max-w-md mx-auto w-full">
        {/* Logo + title */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-24 h-24 rounded-3xl gradient-primary-soft border border-primary/40 flex items-center justify-center mb-5 shadow-lg shadow-primary/20">
            <img src="/icon-192.png" alt="Logo" className="w-16 h-16 rounded-2xl" />
          </div>
          <h1 className="text-2xl font-bold mb-2">The Legends Online</h1>
          <p className="text-sm text-muted-foreground max-w-xs">
            Installe l'application officielle sur ton Android pour une expérience native, fluide et hors-ligne.
          </p>
        </div>

        {/* Download card */}
        <div className="w-full rounded-2xl border border-border bg-background/60 backdrop-blur-sm p-5 mb-4">
          {apkAvailable === false ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center mx-auto mb-3">
                <Download className="w-5 h-5 text-destructive" />
              </div>
              <p className="text-sm font-semibold mb-1">APK indisponible</p>
              <p className="text-xs text-muted-foreground">
                Le fichier d'installation n'est pas encore en ligne. Reviens dans quelques minutes.
              </p>
            </div>
          ) : (
            <>
              {isNative && (
                <div className="flex items-center justify-center gap-1.5 mb-3 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 mx-auto w-fit">
                  <Zap className="w-3 h-3 text-emerald-400" />
                  <span className="text-[11px] font-semibold text-emerald-400">Version native</span>
                </div>
              )}
              <Button
                asChild
                size="lg"
                className="w-full text-base font-semibold gap-2 h-14"
              >
                <a href={apk && apk !== 'loading' ? apk.url : '#'} download={NATIVE_APK_ASSET_NAME}>
                  <Download className="w-5 h-5" />
                  Télécharger l'APK{apkSize ? ` (${apkSize})` : ''}
                </a>
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-3">
                Android 7.0 ou plus récent{apkSize ? ` · ${apkSize}` : ''}
                {isNative && ' · Storage isolé · Aucune barre URL'}
              </p>
            </>
          )}
        </div>

        {/* Platform-specific guidance */}
        {!isAndroid && platform !== 'desktop' && (
          <div className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 mb-4 flex gap-3">
            <Smartphone className="w-5 h-5 flex-shrink-0 text-amber-400 mt-0.5" />
            <div className="text-xs">
              <p className="font-semibold mb-1">Tu es sur iPhone</p>
              <p className="opacity-80">
                Cet APK est uniquement pour Android. Sur iOS, ajoute la PWA via Safari → Partager → "Sur l'écran d'accueil".
              </p>
            </div>
          </div>
        )}

        {!isAndroid && platform === 'desktop' && (
          <div className="w-full rounded-xl border border-primary/30 bg-primary/10 p-4 mb-4 flex gap-3">
            <Globe className="w-5 h-5 flex-shrink-0 text-primary mt-0.5" />
            <div className="text-xs">
              <p className="font-semibold mb-1">Tu es sur ordinateur</p>
              <p className="opacity-80">
                Cette page est faite pour les téléphones Android. Ouvre ce lien sur ton téléphone, ou scanne le QR code que tu peux générer depuis cette URL.
              </p>
            </div>
          </div>
        )}

        {/* Install steps — only show prominently on Android */}
        <div className="w-full rounded-2xl border border-border bg-background/40 backdrop-blur-sm p-5 mb-4">
          <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Comment installer
          </h2>
          <ol className="space-y-3 text-xs">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center font-bold text-[11px] text-primary">1</span>
              <div>
                <p className="font-semibold">Touche le bouton de téléchargement</p>
                <p className="opacity-70 mt-0.5">Le fichier <code className="px-1 py-0.5 rounded bg-muted text-[10px]">The Legends Online.apk</code> arrivera dans tes téléchargements.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center font-bold text-[11px] text-primary">2</span>
              <div>
                <p className="font-semibold">Autorise l'installation</p>
                <p className="opacity-70 mt-0.5">Android te demandera d'autoriser ton navigateur à installer une application — accepte.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center font-bold text-[11px] text-primary">3</span>
              <div>
                <p className="font-semibold">Ouvre le fichier téléchargé</p>
                <p className="opacity-70 mt-0.5">Touche "Installer". L'icône <strong>Legends</strong> apparaîtra sur ton écran d'accueil en quelques secondes.</p>
              </div>
            </li>
          </ol>
        </div>

        {/* Trust footer */}
        <div className="w-full rounded-xl border border-border/50 bg-background/30 px-4 py-3 flex items-center gap-3 mb-4">
          <ShieldCheck className="w-4 h-4 flex-shrink-0 text-emerald-400" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            APK signé et vérifié. La connexion est chiffrée HTTPS et l'application utilise le même compte que la version web.
          </p>
        </div>

        {/* Alternative link */}
        <a
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-2"
        >
          <ExternalLink className="w-3 h-3" />
          Continuer sur la version web
        </a>
      </div>
    </div>
  );
}
