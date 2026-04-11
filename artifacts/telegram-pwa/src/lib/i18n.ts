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
    notifications: string;
    notifBlocked: string;
    notifBlockedDesc: string;
    notifEnabled: string;
    notifEnabledDesc: string;
    notifEnable: string;
    notifEnableDesc: string;
    administration: string;
    adminPanel: string;
    adminPanelDesc: string;
    application: string;
    appInstalled: string;
    appInstalledDesc: string;
    installApp: string;
    installAppIos: string;
    installAppDesc: string;
    installAppIosDesc: string;
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
  groupInfo: {
    members: string;
    groupLink: string;
    media: string;
    files: string;
    voice: string;
    noMedia: string;
    noFiles: string;
    noVoice: string;
    voiceMessage: string;
  };
  attachments: {
    camera: string;
    gallery: string;
    document: string;
    poll: string;
  };
  conversations: {
    noConversation: string;
    noConversationDesc: string;
    voiceMessage: string;
    poll: string;
    image: string;
    you: string;
    noMessage: string;
  };
  groupNames: Record<string, string>;
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
      notifications: 'Notifications',
      notifBlocked: 'Notifications bloquées',
      notifBlockedDesc: 'Autorise-les dans les réglages du navigateur',
      notifEnabled: 'Notifications activées',
      notifEnabledDesc: 'Appuie pour désactiver',
      notifEnable: 'Activer les notifications',
      notifEnableDesc: 'Reçois une alerte pour chaque nouveau message',
      administration: 'Administration',
      adminPanel: 'Panel Administrateur',
      adminPanelDesc: 'Gérer les utilisateurs et surveiller',
      application: 'Application',
      appInstalled: 'Application installée',
      appInstalledDesc: 'Vous utilisez déjà la version native',
      installApp: "Télécharger l'application",
      installAppIos: 'Installer sur iPhone / iPad',
      installAppDesc: 'Installer en application native',
      installAppIosDesc: "Ajouter à l'écran d'accueil via Safari",
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
    groupInfo: {
      members: 'membres',
      groupLink: 'Lien du groupe',
      media: 'Médias',
      files: 'Fichiers',
      voice: 'Voix',
      noMedia: 'Aucun média partagé',
      noFiles: 'Aucun fichier partagé',
      noVoice: 'Aucun message vocal',
      voiceMessage: 'Message vocal',
    },
    attachments: {
      camera: 'Caméra',
      gallery: 'Galerie',
      document: 'Documents',
      poll: 'Sondage',
    },
    conversations: {
      noConversation: 'Aucune conversation',
      noConversationDesc: 'Utilise la recherche pour démarrer',
      voiceMessage: '🎤 Message vocal',
      poll: '📊 Sondage',
      image: '📷 Image',
      you: 'Vous',
      noMessage: 'Aucun message',
    },
    groupNames: {},
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
      notifications: 'Notifications',
      notifBlocked: 'Notifications blocked',
      notifBlockedDesc: 'Allow them in your browser settings',
      notifEnabled: 'Notifications enabled',
      notifEnabledDesc: 'Tap to disable',
      notifEnable: 'Enable notifications',
      notifEnableDesc: 'Get an alert for every new message',
      administration: 'Administration',
      adminPanel: 'Admin Panel',
      adminPanelDesc: 'Manage users and monitor activity',
      application: 'Application',
      appInstalled: 'App installed',
      appInstalledDesc: 'You are already using the native version',
      installApp: 'Download the app',
      installAppIos: 'Install on iPhone / iPad',
      installAppDesc: 'Install as a native app',
      installAppIosDesc: 'Add to home screen via Safari',
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
    groupInfo: {
      members: 'members',
      groupLink: 'Group link',
      media: 'Media',
      files: 'Files',
      voice: 'Voice',
      noMedia: 'No media shared',
      noFiles: 'No files shared',
      noVoice: 'No voice messages',
      voiceMessage: 'Voice message',
    },
    attachments: {
      camera: 'Camera',
      gallery: 'Gallery',
      document: 'Documents',
      poll: 'Poll',
    },
    conversations: {
      noConversation: 'No conversation',
      noConversationDesc: 'Use the search to start',
      voiceMessage: '🎤 Voice message',
      poll: '📊 Poll',
      image: '📷 Image',
      you: 'You',
      noMessage: 'No message',
    },
    groupNames: {
      'Discussion générale': 'General Discussion',
      'Divertissement': 'Entertainment',
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
      notifications: 'Notificaciones',
      notifBlocked: 'Notificaciones bloqueadas',
      notifBlockedDesc: 'Actívalas en la configuración del navegador',
      notifEnabled: 'Notificaciones activadas',
      notifEnabledDesc: 'Toca para desactivar',
      notifEnable: 'Activar notificaciones',
      notifEnableDesc: 'Recibe una alerta por cada mensaje nuevo',
      administration: 'Administración',
      adminPanel: 'Panel de administración',
      adminPanelDesc: 'Gestionar usuarios y supervisar',
      application: 'Aplicación',
      appInstalled: 'Aplicación instalada',
      appInstalledDesc: 'Ya estás usando la versión nativa',
      installApp: 'Descargar la aplicación',
      installAppIos: 'Instalar en iPhone / iPad',
      installAppDesc: 'Instalar como aplicación nativa',
      installAppIosDesc: 'Añadir a la pantalla de inicio con Safari',
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
    groupInfo: {
      members: 'miembros',
      groupLink: 'Enlace del grupo',
      media: 'Medios',
      files: 'Archivos',
      voice: 'Voz',
      noMedia: 'No hay medios compartidos',
      noFiles: 'No hay archivos compartidos',
      noVoice: 'No hay mensajes de voz',
      voiceMessage: 'Mensaje de voz',
    },
    attachments: {
      camera: 'Cámara',
      gallery: 'Galería',
      document: 'Documentos',
      poll: 'Encuesta',
    },
    conversations: {
      noConversation: 'Sin conversación',
      noConversationDesc: 'Usa la búsqueda para empezar',
      voiceMessage: '🎤 Mensaje de voz',
      poll: '📊 Encuesta',
      image: '📷 Imagen',
      you: 'Tú',
      noMessage: 'Sin mensajes',
    },
    groupNames: {
      'Discussion générale': 'Discusión general',
      'Divertissement': 'Entretenimiento',
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
      notifications: 'الإشعارات',
      notifBlocked: 'الإشعارات محظورة',
      notifBlockedDesc: 'فعّلها في إعدادات المتصفح',
      notifEnabled: 'الإشعارات مفعّلة',
      notifEnabledDesc: 'اضغط للإيقاف',
      notifEnable: 'تفعيل الإشعارات',
      notifEnableDesc: 'استقبل تنبيهاً لكل رسالة جديدة',
      administration: 'الإدارة',
      adminPanel: 'لوحة المشرف',
      adminPanelDesc: 'إدارة المستخدمين والمراقبة',
      application: 'التطبيق',
      appInstalled: 'التطبيق مثبّت',
      appInstalledDesc: 'أنت تستخدم النسخة الأصلية بالفعل',
      installApp: 'تحميل التطبيق',
      installAppIos: 'تثبيت على iPhone / iPad',
      installAppDesc: 'تثبيت كتطبيق أصلي',
      installAppIosDesc: 'أضف إلى الشاشة الرئيسية عبر Safari',
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
    groupInfo: {
      members: 'أعضاء',
      groupLink: 'رابط المجموعة',
      media: 'الوسائط',
      files: 'الملفات',
      voice: 'الصوت',
      noMedia: 'لا توجد وسائط مشتركة',
      noFiles: 'لا توجد ملفات مشتركة',
      noVoice: 'لا توجد رسائل صوتية',
      voiceMessage: 'رسالة صوتية',
    },
    attachments: {
      camera: 'الكاميرا',
      gallery: 'المعرض',
      document: 'مستندات',
      poll: 'استطلاع',
    },
    conversations: {
      noConversation: 'لا توجد محادثة',
      noConversationDesc: 'استخدم البحث للبدء',
      voiceMessage: '🎤 رسالة صوتية',
      poll: '📊 استطلاع',
      image: '📷 صورة',
      you: 'أنت',
      noMessage: 'لا توجد رسالة',
    },
    groupNames: {
      'Discussion générale': 'نقاش عام',
      'Divertissement': 'ترفيه',
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
      notifications: 'Notificações',
      notifBlocked: 'Notificações bloqueadas',
      notifBlockedDesc: 'Ative-as nas configurações do navegador',
      notifEnabled: 'Notificações ativadas',
      notifEnabledDesc: 'Toque para desativar',
      notifEnable: 'Ativar notificações',
      notifEnableDesc: 'Receba um alerta para cada nova mensagem',
      administration: 'Administração',
      adminPanel: 'Painel Admin',
      adminPanelDesc: 'Gerenciar usuários e monitorar',
      application: 'Aplicativo',
      appInstalled: 'Aplicativo instalado',
      appInstalledDesc: 'Você já está usando a versão nativa',
      installApp: 'Baixar o aplicativo',
      installAppIos: 'Instalar no iPhone / iPad',
      installAppDesc: 'Instalar como aplicativo nativo',
      installAppIosDesc: 'Adicionar à tela inicial pelo Safari',
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
    groupInfo: {
      members: 'membros',
      groupLink: 'Link do grupo',
      media: 'Mídia',
      files: 'Arquivos',
      voice: 'Voz',
      noMedia: 'Nenhuma mídia compartilhada',
      noFiles: 'Nenhum arquivo compartilhado',
      noVoice: 'Nenhuma mensagem de voz',
      voiceMessage: 'Mensagem de voz',
    },
    attachments: {
      camera: 'Câmera',
      gallery: 'Galeria',
      document: 'Documentos',
      poll: 'Enquete',
    },
    conversations: {
      noConversation: 'Nenhuma conversa',
      noConversationDesc: 'Use a busca para começar',
      voiceMessage: '🎤 Mensagem de voz',
      poll: '📊 Enquete',
      image: '📷 Imagem',
      you: 'Você',
      noMessage: 'Nenhuma mensagem',
    },
    groupNames: {
      'Discussion générale': 'Discussão geral',
      'Divertissement': 'Entretenimento',
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
      notifications: 'Benachrichtigungen',
      notifBlocked: 'Benachrichtigungen blockiert',
      notifBlockedDesc: 'In den Browser-Einstellungen aktivieren',
      notifEnabled: 'Benachrichtigungen aktiviert',
      notifEnabledDesc: 'Tippen zum Deaktivieren',
      notifEnable: 'Benachrichtigungen aktivieren',
      notifEnableDesc: 'Erhalte eine Benachrichtigung für jede neue Nachricht',
      administration: 'Administration',
      adminPanel: 'Admin-Panel',
      adminPanelDesc: 'Benutzer verwalten und überwachen',
      application: 'Anwendung',
      appInstalled: 'App installiert',
      appInstalledDesc: 'Sie verwenden bereits die native Version',
      installApp: 'App herunterladen',
      installAppIos: 'Auf iPhone / iPad installieren',
      installAppDesc: 'Als native App installieren',
      installAppIosDesc: 'Zum Startbildschirm via Safari hinzufügen',
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
    groupInfo: {
      members: 'Mitglieder',
      groupLink: 'Gruppenlink',
      media: 'Medien',
      files: 'Dateien',
      voice: 'Sprache',
      noMedia: 'Keine geteilten Medien',
      noFiles: 'Keine geteilten Dateien',
      noVoice: 'Keine Sprachnachrichten',
      voiceMessage: 'Sprachnachricht',
    },
    attachments: {
      camera: 'Kamera',
      gallery: 'Galerie',
      document: 'Dokumente',
      poll: 'Umfrage',
    },
    conversations: {
      noConversation: 'Keine Unterhaltung',
      noConversationDesc: 'Suche verwenden, um zu beginnen',
      voiceMessage: '🎤 Sprachnachricht',
      poll: '📊 Umfrage',
      image: '📷 Bild',
      you: 'Sie',
      noMessage: 'Keine Nachricht',
    },
    groupNames: {
      'Discussion générale': 'Allgemeine Diskussion',
      'Divertissement': 'Unterhaltung',
    },
  },
};

export function translateGroupName(name: string, lang: AppLang): string {
  if (lang === 'fr') return name;
  return i18n[lang].groupNames[name] ?? name;
}
