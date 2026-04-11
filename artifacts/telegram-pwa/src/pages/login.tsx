import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useLocation } from 'wouter';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { AnimatedBackground } from '@/components/animated-background';
import { Zap } from 'lucide-react';

type Lang = 'fr' | 'en' | 'es' | 'pt' | 'ar' | 'de';

const LANGS: { code: Lang; flag: string; label: string }[] = [
  { code: 'fr', flag: '🇫🇷', label: 'FR' },
  { code: 'en', flag: '🇬🇧', label: 'EN' },
  { code: 'es', flag: '🇪🇸', label: 'ES' },
  { code: 'pt', flag: '🇧🇷', label: 'PT' },
  { code: 'ar', flag: '🇸🇦', label: 'AR' },
  { code: 'de', flag: '🇩🇪', label: 'DE' },
];

const T: Record<Lang, {
  title: string; subtitle: string; username: string; password: string;
  submit: string; loading: string; noAccount: string; signup: string;
  errRequired: string; errPassword: string; errFailed: string; errDesc: string;
  welcome: string;
}> = {
  fr: {
    title: 'The Legends Online', subtitle: 'Connecte-toi pour rejoindre la communauté',
    username: 'Identifiant', password: 'Mot de passe',
    submit: 'Se connecter', loading: 'Connexion…',
    noAccount: 'Pas encore de compte ?', signup: "S'inscrire",
    errRequired: "L'identifiant est requis", errPassword: 'Minimum 6 caractères',
    errFailed: 'Connexion échouée', errDesc: 'Vérifie tes identifiants',
    welcome: 'Bienvenue !',
  },
  en: {
    title: 'The Legends Online', subtitle: 'Sign in to join the community',
    username: 'Username', password: 'Password',
    submit: 'Sign in', loading: 'Signing in…',
    noAccount: "Don't have an account?", signup: 'Sign up',
    errRequired: 'Username is required', errPassword: 'Minimum 6 characters',
    errFailed: 'Login failed', errDesc: 'Please check your credentials',
    welcome: 'Welcome back!',
  },
  es: {
    title: 'The Legends Online', subtitle: 'Inicia sesión para unirte a la comunidad',
    username: 'Usuario', password: 'Contraseña',
    submit: 'Iniciar sesión', loading: 'Iniciando…',
    noAccount: '¿No tienes cuenta?', signup: 'Registrarse',
    errRequired: 'El usuario es obligatorio', errPassword: 'Mínimo 6 caracteres',
    errFailed: 'Error de inicio de sesión', errDesc: 'Comprueba tus credenciales',
    welcome: '¡Bienvenido!',
  },
  pt: {
    title: 'The Legends Online', subtitle: 'Entre para se juntar à comunidade',
    username: 'Utilizador', password: 'Senha',
    submit: 'Entrar', loading: 'Entrando…',
    noAccount: 'Não tem conta?', signup: 'Registar',
    errRequired: 'O utilizador é obrigatório', errPassword: 'Mínimo 6 caracteres',
    errFailed: 'Falha no login', errDesc: 'Verifique as suas credenciais',
    welcome: 'Bem-vindo!',
  },
  ar: {
    title: 'The Legends Online', subtitle: 'سجّل دخولك للانضمام إلى المجتمع',
    username: 'اسم المستخدم', password: 'كلمة المرور',
    submit: 'تسجيل الدخول', loading: '…جارٍ الدخول',
    noAccount: 'ليس لديك حساب؟', signup: 'إنشاء حساب',
    errRequired: 'اسم المستخدم مطلوب', errPassword: '6 أحرف على الأقل',
    errFailed: 'فشل تسجيل الدخول', errDesc: 'تحقق من بيانات الاعتماد',
    welcome: '!أهلاً بعودتك',
  },
  de: {
    title: 'The Legends Online', subtitle: 'Meld dich an, um der Community beizutreten',
    username: 'Benutzername', password: 'Passwort',
    submit: 'Anmelden', loading: 'Anmeldung…',
    noAccount: 'Noch kein Konto?', signup: 'Registrieren',
    errRequired: 'Benutzername ist erforderlich', errPassword: 'Mindestens 6 Zeichen',
    errFailed: 'Anmeldung fehlgeschlagen', errDesc: 'Bitte Zugangsdaten prüfen',
    welcome: 'Willkommen zurück!',
  },
};

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [lang, setLang] = useState<Lang>(() =>
    (localStorage.getItem('telechat_app_lang') as Lang) ?? 'fr'
  );

  const t = T[lang];

  const loginSchema = z.object({
    username: z.string().min(1, t.errRequired),
    password: z.string().min(6, t.errPassword),
  });

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = async (values: z.infer<typeof loginSchema>) => {
    try {
      setIsLoading(true);
      const result = await login({ data: values });
      // Clear any stale query cache before redirecting to avoid loops
      localStorage.removeItem('telechat-query-cache');
      localStorage.setItem('telechat_token', result.token);
      localStorage.setItem('telechat_app_lang', lang);
      toast({ title: t.welcome });
      // Use BASE_URL so this works correctly on both dev and deployed environments
      window.location.href = import.meta.env.BASE_URL || '/';
    } catch (error: any) {
      toast({ variant: 'destructive', title: t.errFailed, description: error.message || t.errDesc });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 relative overflow-hidden" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <AnimatedBackground />

      <div className="relative z-10 w-full max-w-sm flex flex-col gap-6">
        {/* Logo + titre */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-20 h-20 rounded-3xl bg-primary/20 border border-primary/30 flex items-center justify-center shadow-lg shadow-primary/20">
            <Zap className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t.subtitle}</p>
          </div>
        </div>

        {/* Card */}
        <div className="glass rounded-3xl p-6 shadow-2xl">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80 text-sm">{t.username}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t.username.toLowerCase()}
                        className="bg-white/5 border-white/10 focus:border-primary/50 rounded-xl h-11"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80 text-sm">{t.password}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        className="bg-white/5 border-white/10 focus:border-primary/50 rounded-xl h-11"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full h-11 rounded-xl font-semibold bg-primary hover:bg-primary/90 text-white mt-2"
                disabled={isLoading}
              >
                {isLoading ? t.loading : t.submit}
              </Button>
            </form>
          </Form>

          <div className="mt-4 text-center text-sm">
            <span className="text-muted-foreground">{t.noAccount} </span>
            <button
              onClick={() => setLocation('/register')}
              className="text-primary font-semibold hover:underline"
            >
              {t.signup}
            </button>
          </div>
        </div>

        {/* Sélecteur de langue */}
        <div className="flex items-center justify-center gap-1.5 flex-wrap">
          {LANGS.map(l => (
            <button
              key={l.code}
              onClick={() => { setLang(l.code); localStorage.setItem('telechat_app_lang', l.code); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                lang === l.code
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent'
              }`}
            >
              <span>{l.flag}</span>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
