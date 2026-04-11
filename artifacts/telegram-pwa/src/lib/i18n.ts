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
    typingOne: string;
    typingTwo: string;
    typingMany: string;
    lastSeen: string;
    offline: string;
    online: string;
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
  poll: {
    title: string;
    question: string;
    questionPlaceholder: string;
    options: string;
    addOption: string;
    remainingOptions: string;
    settings: string;
    anonymousVote: string;
    multipleChoice: string;
    create: string;
    anonymous: string;
    public: string;
    viewVotes: string;
    votesTitle: string;
    noVotes: string;
  };
  profile: {
    editProfile: string;
    publicInfo: string;
    displayName: string;
    displayNamePlaceholder: string;
    username: string;
    usernameHint: string;
    bio: string;
    bioPlaceholder: string;
    addPhoto: string;
    changePhoto: string;
    removePhoto: string;
    save: string;
    saving: string;
    saved: string;
    sendMessage: string;
    opening: string;
  };
  home: {
    selectConversation: string;
    loadingShop: string;
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
      typingOne: '{name} écrit…',
      typingTwo: '{a} et {b} écrivent…',
      typingMany: '{n} personnes écrivent…',
      lastSeen: 'vu à {time}',
      offline: 'hors ligne',
      online: 'en ligne',
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
    poll: {
      title: 'Nouveau sondage',
      question: 'Question du sondage',
      questionPlaceholder: 'Posez une question...',
      options: 'Options de réponse',
      addOption: 'Ajouter une option...',
      remainingOptions: 'Vous pouvez encore ajouter {n} options.',
      settings: 'Paramètres',
      anonymousVote: 'Vote anonyme',
      multipleChoice: 'Réponses multiples',
      create: 'Créer le sondage',
      anonymous: 'Anonyme',
      public: 'Public',
      viewVotes: 'Voir les votes',
      votesTitle: 'Résultats du vote',
      noVotes: 'Aucun vote',
    },
    profile: {
      editProfile: 'Modifier le profil',
      publicInfo: 'Infos visibles par tous',
      displayName: 'Nom affiché',
      displayNamePlaceholder: 'Ton nom affiché…',
      username: 'Identifiant',
      usernameHint: '3–20 caractères, lettres, chiffres et _ uniquement',
      bio: 'Bio',
      bioPlaceholder: 'Quelques mots sur toi…',
      addPhoto: 'Ajouter une photo',
      changePhoto: 'Changer la photo',
      removePhoto: 'Supprimer',
      save: 'Enregistrer les modifications',
      saving: 'Enregistrement…',
      saved: 'Enregistré !',
      sendMessage: 'Envoyer un message',
      opening: 'Ouverture…',
    },
    home: {
      selectConversation: 'Sélectionne une conversation',
      loadingShop: 'Chargement du shop…',
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
      typingOne: '{name} is typing…',
      typingTwo: '{a} and {b} are typing…',
      typingMany: '{n} people are typing…',
      lastSeen: 'seen at {time}',
      offline: 'offline',
      online: 'online',
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
    poll: {
      title: 'New poll',
      question: 'Poll question',
      questionPlaceholder: 'Ask a question...',
      options: 'Answer options',
      addOption: 'Add an option...',
      remainingOptions: 'You can still add {n} options.',
      settings: 'Settings',
      anonymousVote: 'Anonymous vote',
      multipleChoice: 'Multiple answers',
      create: 'Create poll',
      anonymous: 'Anonymous',
      public: 'Public',
      viewVotes: 'View votes',
      votesTitle: 'Vote results',
      noVotes: 'No votes',
    },
    profile: {
      editProfile: 'Edit profile',
      publicInfo: 'Info visible to all',
      displayName: 'Display name',
      displayNamePlaceholder: 'Your display name…',
      username: 'Username',
      usernameHint: '3–20 characters, letters, digits and _ only',
      bio: 'Bio',
      bioPlaceholder: 'A few words about you…',
      addPhoto: 'Add a photo',
      changePhoto: 'Change photo',
      removePhoto: 'Remove',
      save: 'Save changes',
      saving: 'Saving…',
      saved: 'Saved!',
      sendMessage: 'Send a message',
      opening: 'Opening…',
    },
    home: {
      selectConversation: 'Select a conversation',
      loadingShop: 'Loading shop…',
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
      typingOne: '{name} está escribiendo…',
      typingTwo: '{a} y {b} están escribiendo…',
      typingMany: '{n} personas están escribiendo…',
      lastSeen: 'visto a las {time}',
      offline: 'desconectado',
      online: 'en línea',
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
    poll: {
      title: 'Nueva encuesta',
      question: 'Pregunta de la encuesta',
      questionPlaceholder: 'Haz una pregunta...',
      options: 'Opciones de respuesta',
      addOption: 'Añadir una opción...',
      remainingOptions: 'Puedes añadir {n} opciones más.',
      settings: 'Configuración',
      anonymousVote: 'Voto anónimo',
      multipleChoice: 'Respuestas múltiples',
      create: 'Crear encuesta',
      anonymous: 'Anónimo',
      public: 'Público',
      viewVotes: 'Ver votos',
      votesTitle: 'Resultados del voto',
      noVotes: 'Sin votos',
    },
    profile: {
      editProfile: 'Editar perfil',
      publicInfo: 'Info visible para todos',
      displayName: 'Nombre mostrado',
      displayNamePlaceholder: 'Tu nombre mostrado…',
      username: 'Usuario',
      usernameHint: '3–20 caracteres, letras, dígitos y _ únicamente',
      bio: 'Bio',
      bioPlaceholder: 'Unas palabras sobre ti…',
      addPhoto: 'Añadir una foto',
      changePhoto: 'Cambiar foto',
      removePhoto: 'Eliminar',
      save: 'Guardar cambios',
      saving: 'Guardando…',
      saved: '¡Guardado!',
      sendMessage: 'Enviar un mensaje',
      opening: 'Abriendo…',
    },
    home: {
      selectConversation: 'Selecciona una conversación',
      loadingShop: 'Cargando tienda…',
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
      typingOne: '{name} يكتب…',
      typingTwo: '{a} و {b} يكتبان…',
      typingMany: '{n} أشخاص يكتبون…',
      lastSeen: 'شوهد في {time}',
      offline: 'غير متصل',
      online: 'متصل',
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
    poll: {
      title: 'استطلاع جديد',
      question: 'سؤال الاستطلاع',
      questionPlaceholder: 'اطرح سؤالاً...',
      options: 'خيارات الإجابة',
      addOption: 'إضافة خيار...',
      remainingOptions: 'يمكنك إضافة {n} خيارات إضافية.',
      settings: 'الإعدادات',
      anonymousVote: 'تصويت مجهول',
      multipleChoice: 'إجابات متعددة',
      create: 'إنشاء استطلاع',
      anonymous: 'مجهول',
      public: 'عام',
      viewVotes: 'عرض الأصوات',
      votesTitle: 'نتائج التصويت',
      noVotes: 'لا توجد أصوات',
    },
    profile: {
      editProfile: 'تعديل الملف الشخصي',
      publicInfo: 'معلومات مرئية للجميع',
      displayName: 'الاسم المعروض',
      displayNamePlaceholder: 'اسمك المعروض…',
      username: 'المعرّف',
      usernameHint: '3–20 حرفاً، أحرف وأرقام و _ فقط',
      bio: 'السيرة',
      bioPlaceholder: 'بضع كلمات عنك…',
      addPhoto: 'إضافة صورة',
      changePhoto: 'تغيير الصورة',
      removePhoto: 'حذف',
      save: 'حفظ التغييرات',
      saving: 'جارٍ الحفظ…',
      saved: 'تم الحفظ!',
      sendMessage: 'إرسال رسالة',
      opening: 'جارٍ الفتح…',
    },
    home: {
      selectConversation: 'اختر محادثة',
      loadingShop: 'تحميل المتجر…',
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
      typingOne: '{name} está digitando…',
      typingTwo: '{a} e {b} estão digitando…',
      typingMany: '{n} pessoas estão digitando…',
      lastSeen: 'visto às {time}',
      offline: 'offline',
      online: 'online',
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
    poll: {
      title: 'Nova enquete',
      question: 'Pergunta da enquete',
      questionPlaceholder: 'Faça uma pergunta...',
      options: 'Opções de resposta',
      addOption: 'Adicionar uma opção...',
      remainingOptions: 'Você pode adicionar mais {n} opções.',
      settings: 'Configurações',
      anonymousVote: 'Voto anônimo',
      multipleChoice: 'Respostas múltiplas',
      create: 'Criar enquete',
      anonymous: 'Anônimo',
      public: 'Público',
      viewVotes: 'Ver votos',
      votesTitle: 'Resultados da votação',
      noVotes: 'Nenhum voto',
    },
    profile: {
      editProfile: 'Editar perfil',
      publicInfo: 'Info visível para todos',
      displayName: 'Nome exibido',
      displayNamePlaceholder: 'Seu nome exibido…',
      username: 'Identificador',
      usernameHint: '3–20 caracteres, letras, dígitos e _ apenas',
      bio: 'Bio',
      bioPlaceholder: 'Algumas palavras sobre você…',
      addPhoto: 'Adicionar foto',
      changePhoto: 'Alterar foto',
      removePhoto: 'Remover',
      save: 'Salvar alterações',
      saving: 'Salvando…',
      saved: 'Salvo!',
      sendMessage: 'Enviar mensagem',
      opening: 'Abrindo…',
    },
    home: {
      selectConversation: 'Selecione uma conversa',
      loadingShop: 'Carregando loja…',
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
      typingOne: '{name} schreibt…',
      typingTwo: '{a} und {b} schreiben…',
      typingMany: '{n} Personen schreiben…',
      lastSeen: 'gesehen um {time}',
      offline: 'offline',
      online: 'online',
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
    poll: {
      title: 'Neue Umfrage',
      question: 'Umfragefrage',
      questionPlaceholder: 'Eine Frage stellen...',
      options: 'Antwortoptionen',
      addOption: 'Option hinzufügen...',
      remainingOptions: 'Sie können noch {n} Optionen hinzufügen.',
      settings: 'Einstellungen',
      anonymousVote: 'Anonyme Abstimmung',
      multipleChoice: 'Mehrfachantworten',
      create: 'Umfrage erstellen',
      anonymous: 'Anonym',
      public: 'Öffentlich',
      viewVotes: 'Stimmen anzeigen',
      votesTitle: 'Abstimmungsergebnisse',
      noVotes: 'Keine Stimmen',
    },
    profile: {
      editProfile: 'Profil bearbeiten',
      publicInfo: 'Für alle sichtbare Info',
      displayName: 'Anzeigename',
      displayNamePlaceholder: 'Dein Anzeigename…',
      username: 'Benutzername',
      usernameHint: '3–20 Zeichen, Buchstaben, Ziffern und _ nur',
      bio: 'Bio',
      bioPlaceholder: 'Ein paar Worte über dich…',
      addPhoto: 'Foto hinzufügen',
      changePhoto: 'Foto ändern',
      removePhoto: 'Entfernen',
      save: 'Änderungen speichern',
      saving: 'Speichern…',
      saved: 'Gespeichert!',
      sendMessage: 'Nachricht senden',
      opening: 'Öffnen…',
    },
    home: {
      selectConversation: 'Gespräch auswählen',
      loadingShop: 'Shop wird geladen…',
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
