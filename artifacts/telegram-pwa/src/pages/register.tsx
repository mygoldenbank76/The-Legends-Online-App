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
  title: string; subtitle: string;
  username: string; displayName: string; password: string;
  submit: string; loading: string; hasAccount: string; signin: string;
  errUsername: string; errDisplayName: string; errPassword: string;
  errFailed: string; errDesc: string; success: string;
  placeholderUser: string; placeholderName: string;
}> = {
  fr: {
    title: 'The Legends Online', subtitle: 'Rejoins la communauté',
    username: 'Identifiant', displayName: 'Nom affiché', password: 'Mot de passe',
    submit: "S'inscrire", loading: 'Création…',
    hasAccount: 'Déjà un compte ?', signin: 'Se connecter',
    errUsername: '3 caractères minimum', errDisplayName: '2 caractères minimum',
    errPassword: '6 caractères minimum',
    errFailed: 'Inscription échouée', errDesc: 'Réessaie plus tard',
    success: 'Compte créé avec succès !',
    placeholderUser: 'identifiant', placeholderName: 'Ton nom',
  },
  en: {
    title: 'The Legends Online', subtitle: 'Join the community',
    username: 'Username', displayName: 'Display Name', password: 'Password',
    submit: 'Sign up', loading: 'Creating…',
    hasAccount: 'Already have an account?', signin: 'Sign in',
    errUsername: 'At least 3 characters', errDisplayName: 'At least 2 characters',
    errPassword: 'At least 6 characters',
    errFailed: 'Registration failed', errDesc: 'Please try again',
    success: 'Account created!',
    placeholderUser: 'username', placeholderName: 'Your name',
  },
  es: {
    title: 'The Legends Online', subtitle: 'Únete a la comunidad',
    username: 'Usuario', displayName: 'Nombre visible', password: 'Contraseña',
    submit: 'Registrarse', loading: 'Creando…',
    hasAccount: '¿Ya tienes cuenta?', signin: 'Iniciar sesión',
    errUsername: 'Mínimo 3 caracteres', errDisplayName: 'Mínimo 2 caracteres',
    errPassword: 'Mínimo 6 caracteres',
    errFailed: 'Registro fallido', errDesc: 'Inténtalo de nuevo',
    success: '¡Cuenta creada!',
    placeholderUser: 'usuario', placeholderName: 'Tu nombre',
  },
  pt: {
    title: 'The Legends Online', subtitle: 'Junta-te à comunidade',
    username: 'Utilizador', displayName: 'Nome de exibição', password: 'Senha',
    submit: 'Registar', loading: 'A criar…',
    hasAccount: 'Já tem conta?', signin: 'Entrar',
    errUsername: 'Mínimo 3 caracteres', errDisplayName: 'Mínimo 2 caracteres',
    errPassword: 'Mínimo 6 caracteres',
    errFailed: 'Registo falhou', errDesc: 'Por favor tente novamente',
    success: 'Conta criada!',
    placeholderUser: 'utilizador', placeholderName: 'O seu nome',
  },
  ar: {
    title: 'The Legends Online', subtitle: 'انضم إلى المجتمع',
    username: 'اسم المستخدم', displayName: 'الاسم المعروض', password: 'كلمة المرور',
    submit: 'إنشاء حساب', loading: '…جارٍ الإنشاء',
    hasAccount: 'لديك حساب بالفعل؟', signin: 'تسجيل الدخول',
    errUsername: '3 أحرف على الأقل', errDisplayName: 'حرفان على الأقل',
    errPassword: '6 أحرف على الأقل',
    errFailed: 'فشل التسجيل', errDesc: 'حاول مجدداً',
    success: '!تم إنشاء الحساب',
    placeholderUser: 'اسم المستخدم', placeholderName: 'اسمك',
  },
  de: {
    title: 'The Legends Online', subtitle: 'Tritt der Community bei',
    username: 'Benutzername', displayName: 'Anzeigename', password: 'Passwort',
    submit: 'Registrieren', loading: 'Wird erstellt…',
    hasAccount: 'Schon ein Konto?', signin: 'Anmelden',
    errUsername: 'Mindestens 3 Zeichen', errDisplayName: 'Mindestens 2 Zeichen',
    errPassword: 'Mindestens 6 Zeichen',
    errFailed: 'Registrierung fehlgeschlagen', errDesc: 'Bitte erneut versuchen',
    success: 'Konto erstellt!',
    placeholderUser: 'benutzername', placeholderName: 'Dein Name',
  },
};

export default function Register() {
  const { register } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [lang, setLang] = useState<Lang>(() =>
    (localStorage.getItem('telechat_app_lang') as Lang) ?? 'fr'
  );

  const t = T[lang];

  const registerSchema = z.object({
    username: z.string().min(3, t.errUsername),
    displayName: z.string().min(2, t.errDisplayName),
    password: z.string().min(6, t.errPassword),
  });

  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: '', displayName: '', password: '' },
  });

  const onSubmit = async (values: z.infer<typeof registerSchema>) => {
    try {
      setIsLoading(true);
      const result = await register({ data: values });
      localStorage.setItem('telechat_token', result.token);
      localStorage.setItem('telechat_app_lang', lang);
      toast({ title: t.success });
      window.location.href = '/';
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
                        placeholder={t.placeholderUser}
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
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80 text-sm">{t.displayName}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t.placeholderName}
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
            <span className="text-muted-foreground">{t.hasAccount} </span>
            <button
              onClick={() => setLocation('/login')}
              className="text-primary font-semibold hover:underline"
            >
              {t.signin}
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
