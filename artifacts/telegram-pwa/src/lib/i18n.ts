export type AppLang = 'fr' | 'en' | 'es' | 'ar' | 'pt' | 'de';
export type TranslateLang = 'fr' | 'en' | 'es' | 'ar' | 'pt' | 'de' | 'it' | 'ru' | 'zh' | 'ja' | 'tr' | 'nl';

export const SUPPORTED_APP_LANGUAGES: { code: AppLang; label: string; flag: string }[] = [
  { code: 'fr', label: 'Français',   flag: '🇫🇷' },
  { code: 'en', label: 'English',    flag: '🇬🇧' },
  { code: 'es', label: 'Español',    flag: '🇪🇸' },
  { code: 'ar', label: 'العربية',    flag: '🇸🇦' },
  { code: 'pt', label: 'Português',  flag: '🇧🇷' },
  { code: 'de', label: 'Deutsch',    flag: '🇩🇪' },
];

export const SUPPORTED_TRANSLATE_LANGUAGES: { code: TranslateLang; label: string; flag: string }[] = [
  { code: 'fr', label: 'Français',   flag: '🇫🇷' },
  { code: 'en', label: 'English',    flag: '🇬🇧' },
  { code: 'es', label: 'Español',    flag: '🇪🇸' },
  { code: 'ar', label: 'العربية',    flag: '🇸🇦' },
  { code: 'pt', label: 'Português',  flag: '🇧🇷' },
  { code: 'de', label: 'Deutsch',    flag: '🇩🇪' },
  { code: 'it', label: 'Italiano',   flag: '🇮🇹' },
  { code: 'ru', label: 'Русский',    flag: '🇷🇺' },
  { code: 'zh', label: '中文',        flag: '🇨🇳' },
  { code: 'ja', label: '日本語',      flag: '🇯🇵' },
  { code: 'tr', label: 'Türkçe',     flag: '🇹🇷' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
];

type Dict = {
  tabs: { groups: string; messages: string; shop: string; settings: string };
  settings: {
    title: string;
    account: string;
    preferences: string;
    messaging: string;
    appLanguage: string;
    appLanguageDesc: string;
    translateLanguage: string;
    translateLanguageDesc: string;
    logout: string;
  };
  chat: {
    reply: string;
    copy: string;
    translate: string;
    hideTranslation: string;
    pin: string;
    unpin: string;
    edit: string;
    delete: string;
    confirmDelete: string;
    cancelDelete: string;
    placeholder: string;
    editPlaceholder: string;
  };
};

export const i18n: Record<AppLang, Dict> = {
  fr: {
    tabs: { groups: 'Groupes', messages: 'Messages', shop: 'Shop', settings: 'Paramètres' },
    settings: {
      title: 'Paramètres',
      account: 'Compte',
      preferences: 'Préférences',
      messaging: 'Messagerie',
      appLanguage: "Langue de l'application",
      appLanguageDesc: "Choisir la langue de l'interface",
      translateLanguage: 'Langue de traduction',
      translateLanguageDesc: 'Les messages seront traduits dans cette langue',
      logout: 'Se déconnecter',
    },
    chat: {
      reply: 'Répondre',
      copy: 'Copier',
      translate: 'Traduire',
      hideTranslation: 'Masquer traduction',
      pin: 'Épingler',
      unpin: 'Désépingler',
      edit: 'Modifier',
      delete: 'Supprimer',
      confirmDelete: 'Confirmer la suppression ?',
      cancelDelete: 'Annuler',
      placeholder: 'Écrire un message...',
      editPlaceholder: 'Modifier…',
    },
  },
  en: {
    tabs: { groups: 'Groups', messages: 'Messages', shop: 'Shop', settings: 'Settings' },
    settings: {
      title: 'Settings',
      account: 'Account',
      preferences: 'Preferences',
      messaging: 'Messaging',
      appLanguage: 'App language',
      appLanguageDesc: 'Choose the interface language',
      translateLanguage: 'Translation language',
      translateLanguageDesc: 'Messages will be translated into this language',
      logout: 'Sign out',
    },
    chat: {
      reply: 'Reply',
      copy: 'Copy',
      translate: 'Translate',
      hideTranslation: 'Hide translation',
      pin: 'Pin',
      unpin: 'Unpin',
      edit: 'Edit',
      delete: 'Delete',
      confirmDelete: 'Confirm deletion?',
      cancelDelete: 'Cancel',
      placeholder: 'Write a message...',
      editPlaceholder: 'Edit…',
    },
  },
  es: {
    tabs: { groups: 'Grupos', messages: 'Mensajes', shop: 'Tienda', settings: 'Ajustes' },
    settings: {
      title: 'Ajustes',
      account: 'Cuenta',
      preferences: 'Preferencias',
      messaging: 'Mensajería',
      appLanguage: 'Idioma de la app',
      appLanguageDesc: 'Elegir el idioma de la interfaz',
      translateLanguage: 'Idioma de traducción',
      translateLanguageDesc: 'Los mensajes serán traducidos a este idioma',
      logout: 'Cerrar sesión',
    },
    chat: {
      reply: 'Responder',
      copy: 'Copiar',
      translate: 'Traducir',
      hideTranslation: 'Ocultar traducción',
      pin: 'Fijar',
      unpin: 'Desfijar',
      edit: 'Editar',
      delete: 'Eliminar',
      confirmDelete: '¿Confirmar eliminación?',
      cancelDelete: 'Cancelar',
      placeholder: 'Escribe un mensaje...',
      editPlaceholder: 'Editar…',
    },
  },
  ar: {
    tabs: { groups: 'المجموعات', messages: 'الرسائل', shop: 'المتجر', settings: 'الإعدادات' },
    settings: {
      title: 'الإعدادات',
      account: 'الحساب',
      preferences: 'التفضيلات',
      messaging: 'المراسلة',
      appLanguage: 'لغة التطبيق',
      appLanguageDesc: 'اختر لغة الواجهة',
      translateLanguage: 'لغة الترجمة',
      translateLanguageDesc: 'ستُترجم الرسائل إلى هذه اللغة',
      logout: 'تسجيل الخروج',
    },
    chat: {
      reply: 'رد',
      copy: 'نسخ',
      translate: 'ترجمة',
      hideTranslation: 'إخفاء الترجمة',
      pin: 'تثبيت',
      unpin: 'إلغاء التثبيت',
      edit: 'تعديل',
      delete: 'حذف',
      confirmDelete: 'تأكيد الحذف؟',
      cancelDelete: 'إلغاء',
      placeholder: 'اكتب رسالة...',
      editPlaceholder: 'تعديل...',
    },
  },
  pt: {
    tabs: { groups: 'Grupos', messages: 'Mensagens', shop: 'Loja', settings: 'Configurações' },
    settings: {
      title: 'Configurações',
      account: 'Conta',
      preferences: 'Preferências',
      messaging: 'Mensagens',
      appLanguage: 'Idioma do app',
      appLanguageDesc: 'Escolher o idioma da interface',
      translateLanguage: 'Idioma de tradução',
      translateLanguageDesc: 'As mensagens serão traduzidas para este idioma',
      logout: 'Sair',
    },
    chat: {
      reply: 'Responder',
      copy: 'Copiar',
      translate: 'Traduzir',
      hideTranslation: 'Ocultar tradução',
      pin: 'Fixar',
      unpin: 'Desafixar',
      edit: 'Editar',
      delete: 'Excluir',
      confirmDelete: 'Confirmar exclusão?',
      cancelDelete: 'Cancelar',
      placeholder: 'Escreva uma mensagem...',
      editPlaceholder: 'Editar…',
    },
  },
  de: {
    tabs: { groups: 'Gruppen', messages: 'Nachrichten', shop: 'Shop', settings: 'Einstellungen' },
    settings: {
      title: 'Einstellungen',
      account: 'Konto',
      preferences: 'Einstellungen',
      messaging: 'Nachrichten',
      appLanguage: 'App-Sprache',
      appLanguageDesc: 'Interface-Sprache wählen',
      translateLanguage: 'Übersetzungssprache',
      translateLanguageDesc: 'Nachrichten werden in diese Sprache übersetzt',
      logout: 'Abmelden',
    },
    chat: {
      reply: 'Antworten',
      copy: 'Kopieren',
      translate: 'Übersetzen',
      hideTranslation: 'Übersetzung ausblenden',
      pin: 'Anpinnen',
      unpin: 'Ablösen',
      edit: 'Bearbeiten',
      delete: 'Löschen',
      confirmDelete: 'Löschen bestätigen?',
      cancelDelete: 'Abbrechen',
      placeholder: 'Nachricht schreiben...',
      editPlaceholder: 'Bearbeiten…',
    },
  },
};
