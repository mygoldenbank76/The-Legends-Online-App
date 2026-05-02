import { useEffect, useState } from 'react';
import { Download, Smartphone, ShieldCheck, Sparkles, ExternalLink, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnimatedBackground } from '@/components/animated-background';

const APK_URL = '/downloads/legends.apk';

function detectPlatform(): 'android' | 'ios' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'desktop';
}

export default function InstallApk() {
  const [platform, setPlatform] = useState<'android' | 'ios' | 'desktop'>('desktop');
  const [apkSize, setApkSize] = useState<string | null>(null);
  const [apkAvailable, setApkAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
    // HEAD request to learn the file size and confirm the APK is uploaded
    fetch(APK_URL, { method: 'HEAD' })
      .then((r) => {
        if (!r.ok) {
          setApkAvailable(false);
          return;
        }
        setApkAvailable(true);
        const len = r.headers.get('content-length');
        if (len) {
          const mb = Number(len) / (1024 * 1024);
          setApkSize(`${mb.toFixed(1)} Mo`);
        }
      })
      .catch(() => setApkAvailable(false));
  }, []);

  const isAndroid = platform === 'android';

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
              <Button
                asChild
                size="lg"
                className="w-full text-base font-semibold gap-2 h-14"
              >
                <a href={APK_URL} download>
                  <Download className="w-5 h-5" />
                  Télécharger l'APK{apkSize ? ` (${apkSize})` : ''}
                </a>
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-3">
                Android 7.0 ou plus récent · ~{apkSize ?? '5 Mo'}
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
                <p className="opacity-70 mt-0.5">Le fichier <code className="px-1 py-0.5 rounded bg-muted text-[10px]">legends.apk</code> arrivera dans tes téléchargements.</p>
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
