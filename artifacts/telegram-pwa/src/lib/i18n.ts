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
  tabs: { groups: string; messages: string; profile: string; contacts: string; settings: string };
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
    appearance: string;
    theme: string;
    themeDesc: string;
    themeDark: string;
    themeLight: string;
    themeSystem: string;
    visualEffects: string;
    visualEffectsDesc: string;
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
    reactions: string;
    views: string;
    back: string;
  };
  groupInfo: {
    members: string;
    groupLink: string;
    linkCopied: string;
    media: string;
    files: string;
    links: string;
    voice: string;
    gifs: string;
    noMedia: string;
    noFiles: string;
    noLinks: string;
    noVoice: string;
    noGifs: string;
    voiceMessage: string;
    searchMembers: string;
    addMembers: string;
    searchPlaceholder: string;
    searchPeoplePlaceholder: string;
    membersInGroup: string;
    add: string;
    membersAdded: string;
    addMembersError: string;
    noMembersFound: string;
    noPeopleFound: string;
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
    copyUsername: string;
    usernameCopied: string;
  };
  contacts: {
    title: string;
    searchPlaceholder: string;
    inviteFriends: string;
    inviteMessage: string;
    sortByOnline: string;
    onlineRecently: string;
    noContacts: string;
    noContactsHint: string;
    noResults: string;
    newContact: string;
    identifier: string;
    identifierPlaceholder: string;
    identifierHint: string;
    create: string;
    creating: string;
    contactAdded: string;
    contactAlreadyExists: string;
    userNotFound: string;
    cannotAddSelf: string;
    addContactError: string;
    cancel: string;
    inviteLinkCopied: string;
    addFromContacts: string;
    contactsInGroup: string;
    selectContacts: string;
  };
  home: {
    selectConversation: string;
  };
  groupNames: Record<string, string>;
};

export const i18n: Record<AppLang, Dict> = {
  fr: {
    tabs: { groups: 'Groupes', messages: 'Messages', profile: 'Profil', contacts: 'Contacts', settings: 'Paramètres' },
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
      adminPanelDesc: 'Gérer les utilisateurs et la modération',
      application: 'Application',
      appInstalled: 'Application installée',
      appInstalledDesc: 'Vous utilisez déjà la version native',
      installApp: "Télécharger l'application",
      installAppIos: 'Installer sur iPhone / iPad',
      installAppDesc: 'Installer en application native',
      installAppIosDesc: "Ajouter à l'écran d'accueil via Safari",
      appearance: 'Apparence',
      theme: 'Thème',
      themeDesc: "Choisir l'apparence de l'application",
      themeDark: 'Sombre',
      themeLight: 'Clair',
      themeSystem: 'Système',
      visualEffects: 'Effets visuels',
      visualEffectsDesc: 'Désactive les animations pour économiser la batterie',
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
      reactions: 'Réactions',
      views: 'Vues',
      back: 'Retour',
    },
    groupInfo: {
      members: 'membres',
      groupLink: 'Lien du groupe',
      linkCopied: 'Lien copié dans le presse-papiers',
      media: 'Médias',
      files: 'Fichiers',
      links: 'Liens',
      voice: 'Voix',
      gifs: 'GIFs',
      noMedia: 'Aucun média partagé',
      noFiles: 'Aucun fichier partagé',
      noLinks: 'Aucun lien partagé',
      noVoice: 'Aucun message vocal',
      noGifs: 'Aucun GIF partagé',
      voiceMessage: 'Message vocal',
      searchMembers: 'Rechercher des membres',
      addMembers: 'Ajouter des membres',
      searchPlaceholder: 'Rechercher',
      searchPeoplePlaceholder: 'Rechercher des personnes…',
      membersInGroup: 'Membres du groupe',
      add: 'Ajouter',
      membersAdded: 'Membres ajoutés au groupe',
      addMembersError: 'Impossible d\'ajouter les membres',
      noMembersFound: 'Aucun membre trouvé',
      noPeopleFound: 'Aucun utilisateur trouvé',
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
      copyUsername: "Copier l'identifiant",
      usernameCopied: "Identifiant copié",
    },
    contacts: {
      title: "Contacts",
      searchPlaceholder: "Rechercher des contacts",
      inviteFriends: "Inviter des amis",
      inviteMessage: "Salut, je t'invite à me rejoindre sur The Legends Online :",
      sortByOnline: "Trier par heure de connexion",
      onlineRecently: "en ligne récemment",
      noContacts: "Aucun contact pour le moment",
      noContactsHint: "Ajoute ton premier contact avec son identifiant.",
      noResults: "Aucun résultat",
      newContact: "Nouveau contact",
      identifier: "Identifiant",
      identifierPlaceholder: "L'identifiant de la personne",
      identifierHint: "Entre l'identifiant exact (sans @) de la personne à ajouter.",
      create: "Créer le contact",
      creating: "Ajout en cours…",
      contactAdded: "Contact ajouté",
      contactAlreadyExists: "Cette personne fait déjà partie de tes contacts",
      userNotFound: "Aucun utilisateur trouvé avec cet identifiant",
      cannotAddSelf: "Tu ne peux pas t'ajouter toi-même",
      addContactError: "Impossible d'ajouter le contact",
      cancel: "Annuler",
      inviteLinkCopied: "Lien d'invitation copié",
      addFromContacts: "Ajouter depuis mes contacts",
      contactsInGroup: "Mes contacts",
      selectContacts: "Sélectionne les contacts à ajouter",
    },
    home: {
      selectConversation: 'Sélectionne une conversation',
    },
    groupNames: {},
  },

  en: {
    tabs: { groups: 'Groups', messages: 'Messages', profile: 'Profile', contacts: 'Contacts', settings: 'Settings' },
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
      appearance: 'Appearance',
      theme: 'Theme',
      themeDesc: 'Choose the look of the app',
      themeDark: 'Dark',
      themeLight: 'Light',
      themeSystem: 'System',
      visualEffects: 'Visual effects',
      visualEffectsDesc: 'Disable animations to save battery',
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
      reactions: 'Reactions',
      views: 'Views',
      back: 'Back',
    },
    groupInfo: {
      members: 'members',
      groupLink: 'Group link',
      linkCopied: 'Link copied to clipboard',
      media: 'Media',
      files: 'Files',
      links: 'Links',
      voice: 'Voice',
      gifs: 'GIFs',
      noMedia: 'No media shared',
      noFiles: 'No files shared',
      noLinks: 'No links shared',
      noVoice: 'No voice messages',
      noGifs: 'No GIFs shared',
      voiceMessage: 'Voice message',
      searchMembers: 'Search members',
      addMembers: 'Add members',
      searchPlaceholder: 'Search',
      searchPeoplePlaceholder: 'Search people…',
      membersInGroup: 'Group members',
      add: 'Add',
      membersAdded: 'Members added to the group',
      addMembersError: 'Could not add members',
      noMembersFound: 'No members found',
      noPeopleFound: 'No users found',
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
      copyUsername: "Copy username",
      usernameCopied: "Username copied",
    },
    contacts: {
      title: "Contacts",
      searchPlaceholder: "Search contacts",
      inviteFriends: "Invite friends",
      inviteMessage: "Hey, I'd like you to join me on The Legends Online:",
      sortByOnline: "Sort by recent activity",
      onlineRecently: "online recently",
      noContacts: "No contacts yet",
      noContactsHint: "Add your first contact by their username.",
      noResults: "No results",
      newContact: "New contact",
      identifier: "Username",
      identifierPlaceholder: "The person's username",
      identifierHint: "Enter the exact username (no @) to add.",
      create: "Create contact",
      creating: "Adding…",
      contactAdded: "Contact added",
      contactAlreadyExists: "This person is already in your contacts",
      userNotFound: "No user found with this username",
      cannotAddSelf: "You can't add yourself",
      addContactError: "Could not add contact",
      cancel: "Cancel",
      inviteLinkCopied: "Invite link copied",
      addFromContacts: "Add from my contacts",
      contactsInGroup: "My contacts",
      selectContacts: "Select contacts to add",
    },
    home: {
      selectConversation: 'Select a conversation',
    },
    groupNames: {
      'Discussion générale': 'General Discussion',
      'Divertissement': 'Entertainment',
    },
  },

  es: {
    tabs: { groups: 'Grupos', messages: 'Mensajes', profile: 'Perfil', contacts: 'Contactos', settings: 'Ajustes' },
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
      appearance: 'Apariencia',
      theme: 'Tema',
      themeDesc: 'Elige el aspecto de la aplicación',
      themeDark: 'Oscuro',
      themeLight: 'Claro',
      themeSystem: 'Sistema',
      visualEffects: 'Efectos visuales',
      visualEffectsDesc: 'Desactiva las animaciones para ahorrar batería',
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
      reactions: 'Reacciones',
      views: 'Vistas',
      back: 'Volver',
    },
    groupInfo: {
      members: 'miembros',
      groupLink: 'Enlace del grupo',
      linkCopied: 'Enlace copiado al portapapeles',
      media: 'Medios',
      files: 'Archivos',
      links: 'Enlaces',
      voice: 'Voz',
      gifs: 'GIFs',
      noMedia: 'No hay medios compartidos',
      noFiles: 'No hay archivos compartidos',
      noLinks: 'No hay enlaces compartidos',
      noVoice: 'No hay mensajes de voz',
      noGifs: 'No hay GIFs compartidos',
      voiceMessage: 'Mensaje de voz',
      searchMembers: 'Buscar miembros',
      addMembers: 'Añadir miembros',
      searchPlaceholder: 'Buscar',
      searchPeoplePlaceholder: 'Buscar personas…',
      membersInGroup: 'Miembros del grupo',
      add: 'Añadir',
      membersAdded: 'Miembros añadidos al grupo',
      addMembersError: 'No se pudieron añadir los miembros',
      noMembersFound: 'No se encontraron miembros',
      noPeopleFound: 'No se encontraron usuarios',
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
      copyUsername: "Copiar identificador",
      usernameCopied: "Identificador copiado",
    },
    contacts: {
      title: "Contactos",
      searchPlaceholder: "Buscar contactos",
      inviteFriends: "Invitar amigos",
      inviteMessage: "Hola, te invito a unirte a The Legends Online:",
      sortByOnline: "Ordenar por actividad reciente",
      onlineRecently: "en línea recientemente",
      noContacts: "Sin contactos todavía",
      noContactsHint: "Añade tu primer contacto por su identificador.",
      noResults: "Sin resultados",
      newContact: "Nuevo contacto",
      identifier: "Identificador",
      identifierPlaceholder: "El identificador de la persona",
      identifierHint: "Introduce el identificador exacto (sin @) a añadir.",
      create: "Crear contacto",
      creating: "Añadiendo…",
      contactAdded: "Contacto añadido",
      contactAlreadyExists: "Esta persona ya está en tus contactos",
      userNotFound: "No se encontró ningún usuario con ese identificador",
      cannotAddSelf: "No puedes añadirte a ti mismo",
      addContactError: "No se pudo añadir el contacto",
      cancel: "Cancelar",
      inviteLinkCopied: "Enlace de invitación copiado",
      addFromContacts: "Añadir desde mis contactos",
      contactsInGroup: "Mis contactos",
      selectContacts: "Selecciona contactos para añadir",
    },
    home: {
      selectConversation: 'Selecciona una conversación',
    },
    groupNames: {
      'Discussion générale': 'Discusión general',
      'Divertissement': 'Entretenimiento',
    },
  },

  ar: {
    tabs: { groups: 'المجموعات', messages: 'الرسائل', profile: 'الملف الشخصي', contacts: 'جهات الاتصال', settings: 'الإعدادات' },
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
      appearance: 'المظهر',
      theme: 'السمة',
      themeDesc: 'اختر مظهر التطبيق',
      themeDark: 'داكن',
      themeLight: 'فاتح',
      themeSystem: 'النظام',
      visualEffects: 'التأثيرات البصرية',
      visualEffectsDesc: 'عطّل الرسوم المتحركة لتوفير البطارية',
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
      reactions: 'التفاعلات',
      views: 'المشاهدات',
      back: 'رجوع',
    },
    groupInfo: {
      members: 'أعضاء',
      groupLink: 'رابط المجموعة',
      linkCopied: 'تم نسخ الرابط إلى الحافظة',
      media: 'الوسائط',
      files: 'الملفات',
      links: 'الروابط',
      voice: 'الصوت',
      gifs: 'صور متحركة',
      noMedia: 'لا توجد وسائط مشتركة',
      noFiles: 'لا توجد ملفات مشتركة',
      noLinks: 'لا توجد روابط مشتركة',
      noVoice: 'لا توجد رسائل صوتية',
      noGifs: 'لا توجد صور متحركة مشتركة',
      voiceMessage: 'رسالة صوتية',
      searchMembers: 'البحث عن أعضاء',
      addMembers: 'إضافة أعضاء',
      searchPlaceholder: 'بحث',
      searchPeoplePlaceholder: 'البحث عن أشخاص…',
      membersInGroup: 'أعضاء المجموعة',
      add: 'إضافة',
      membersAdded: 'تمت إضافة الأعضاء إلى المجموعة',
      addMembersError: 'تعذر إضافة الأعضاء',
      noMembersFound: 'لم يتم العثور على أعضاء',
      noPeopleFound: 'لم يتم العثور على مستخدمين',
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
      copyUsername: "نسخ المعرف",
      usernameCopied: "تم نسخ المعرف",
    },
    contacts: {
      title: "جهات الاتصال",
      searchPlaceholder: "ابحث عن جهات الاتصال",
      inviteFriends: "دعوة الأصدقاء",
      inviteMessage: "مرحبًا، أدعوك للانضمام إلى The Legends Online:",
      sortByOnline: "الترتيب حسب النشاط الأخير",
      onlineRecently: "متصل مؤخرًا",
      noContacts: "لا توجد جهات اتصال بعد",
      noContactsHint: "أضف أول جهة اتصال باستخدام معرّفها.",
      noResults: "لا توجد نتائج",
      newContact: "جهة اتصال جديدة",
      identifier: "المعرّف",
      identifierPlaceholder: "معرّف الشخص",
      identifierHint: "أدخل المعرّف الدقيق (بدون @) لإضافته.",
      create: "إنشاء جهة اتصال",
      creating: "جارٍ الإضافة…",
      contactAdded: "تمت إضافة جهة الاتصال",
      contactAlreadyExists: "هذا الشخص موجود بالفعل في جهات اتصالك",
      userNotFound: "لم يتم العثور على مستخدم بهذا المعرّف",
      cannotAddSelf: "لا يمكنك إضافة نفسك",
      addContactError: "تعذر إضافة جهة الاتصال",
      cancel: "إلغاء",
      inviteLinkCopied: "تم نسخ رابط الدعوة",
      addFromContacts: "أضف من جهات اتصالي",
      contactsInGroup: "جهات اتصالي",
      selectContacts: "اختر جهات الاتصال المراد إضافتها",
    },
    home: {
      selectConversation: 'اختر محادثة',
    },
    groupNames: {
      'Discussion générale': 'نقاش عام',
      'Divertissement': 'ترفيه',
    },
  },

  pt: {
    tabs: { groups: 'Grupos', messages: 'Mensagens', profile: 'Perfil', contacts: 'Contatos', settings: 'Configurações' },
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
      appearance: 'Aparência',
      theme: 'Tema',
      themeDesc: 'Escolha a aparência do app',
      themeDark: 'Escuro',
      themeLight: 'Claro',
      themeSystem: 'Sistema',
      visualEffects: 'Efeitos visuais',
      visualEffectsDesc: 'Desative as animações para economizar bateria',
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
      reactions: 'Reações',
      views: 'Visualizações',
      back: 'Voltar',
    },
    groupInfo: {
      members: 'membros',
      groupLink: 'Link do grupo',
      linkCopied: 'Link copiado para a área de transferência',
      media: 'Mídia',
      files: 'Arquivos',
      links: 'Links',
      voice: 'Voz',
      gifs: 'GIFs',
      noMedia: 'Nenhuma mídia compartilhada',
      noFiles: 'Nenhum arquivo compartilhado',
      noLinks: 'Nenhum link compartilhado',
      noVoice: 'Nenhuma mensagem de voz',
      noGifs: 'Nenhum GIF compartilhado',
      voiceMessage: 'Mensagem de voz',
      searchMembers: 'Procurar membros',
      addMembers: 'Adicionar membros',
      searchPlaceholder: 'Procurar',
      searchPeoplePlaceholder: 'Procurar pessoas…',
      membersInGroup: 'Membros do grupo',
      add: 'Adicionar',
      membersAdded: 'Membros adicionados ao grupo',
      addMembersError: 'Não foi possível adicionar os membros',
      noMembersFound: 'Nenhum membro encontrado',
      noPeopleFound: 'Nenhum usuário encontrado',
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
      copyUsername: "Copiar identificador",
      usernameCopied: "Identificador copiado",
    },
    contacts: {
      title: "Contatos",
      searchPlaceholder: "Pesquisar contatos",
      inviteFriends: "Convidar amigos",
      inviteMessage: "Olá, te convido para o The Legends Online:",
      sortByOnline: "Ordenar por atividade recente",
      onlineRecently: "on-line recentemente",
      noContacts: "Sem contatos ainda",
      noContactsHint: "Adicione o primeiro contato pelo identificador.",
      noResults: "Sem resultados",
      newContact: "Novo contato",
      identifier: "Identificador",
      identifierPlaceholder: "O identificador da pessoa",
      identifierHint: "Digite o identificador exato (sem @) para adicionar.",
      create: "Criar contato",
      creating: "Adicionando…",
      contactAdded: "Contato adicionado",
      contactAlreadyExists: "Esta pessoa já está nos seus contatos",
      userNotFound: "Nenhum usuário encontrado com esse identificador",
      cannotAddSelf: "Você não pode se adicionar",
      addContactError: "Não foi possível adicionar o contato",
      cancel: "Cancelar",
      inviteLinkCopied: "Link de convite copiado",
      addFromContacts: "Adicionar dos meus contatos",
      contactsInGroup: "Meus contatos",
      selectContacts: "Selecione os contatos a adicionar",
    },
    home: {
      selectConversation: 'Selecione uma conversa',
    },
    groupNames: {
      'Discussion générale': 'Discussão geral',
      'Divertissement': 'Entretenimento',
    },
  },

  de: {
    tabs: { groups: 'Gruppen', messages: 'Nachrichten', profile: 'Profil', contacts: 'Kontakte', settings: 'Einstellungen' },
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
      appearance: 'Erscheinungsbild',
      theme: 'Design',
      themeDesc: 'Wähle das Aussehen der App',
      themeDark: 'Dunkel',
      themeLight: 'Hell',
      themeSystem: 'System',
      visualEffects: 'Visuelle Effekte',
      visualEffectsDesc: 'Animationen deaktivieren, um Akku zu sparen',
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
      reactions: 'Reaktionen',
      views: 'Aufrufe',
      back: 'Zurück',
    },
    groupInfo: {
      members: 'Mitglieder',
      groupLink: 'Gruppenlink',
      linkCopied: 'Link in die Zwischenablage kopiert',
      media: 'Medien',
      files: 'Dateien',
      links: 'Links',
      voice: 'Sprache',
      gifs: 'GIFs',
      noMedia: 'Keine geteilten Medien',
      noFiles: 'Keine geteilten Dateien',
      noLinks: 'Keine geteilten Links',
      noVoice: 'Keine Sprachnachrichten',
      noGifs: 'Keine geteilten GIFs',
      voiceMessage: 'Sprachnachricht',
      searchMembers: 'Mitglieder suchen',
      addMembers: 'Mitglieder hinzufügen',
      searchPlaceholder: 'Suchen',
      searchPeoplePlaceholder: 'Personen suchen…',
      membersInGroup: 'Gruppenmitglieder',
      add: 'Hinzufügen',
      membersAdded: 'Mitglieder zur Gruppe hinzugefügt',
      addMembersError: 'Mitglieder konnten nicht hinzugefügt werden',
      noMembersFound: 'Keine Mitglieder gefunden',
      noPeopleFound: 'Keine Benutzer gefunden',
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
      copyUsername: "Benutzernamen kopieren",
      usernameCopied: "Benutzername kopiert",
    },
    contacts: {
      title: "Kontakte",
      searchPlaceholder: "Kontakte suchen",
      inviteFriends: "Freunde einladen",
      inviteMessage: "Hey, komm zu mir auf The Legends Online:",
      sortByOnline: "Nach letzter Aktivität sortieren",
      onlineRecently: "kürzlich online",
      noContacts: "Noch keine Kontakte",
      noContactsHint: "Füge deinen ersten Kontakt per Benutzername hinzu.",
      noResults: "Keine Ergebnisse",
      newContact: "Neuer Kontakt",
      identifier: "Benutzername",
      identifierPlaceholder: "Benutzername der Person",
      identifierHint: "Gib den genauen Benutzernamen (ohne @) ein.",
      create: "Kontakt erstellen",
      creating: "Wird hinzugefügt…",
      contactAdded: "Kontakt hinzugefügt",
      contactAlreadyExists: "Diese Person ist bereits in deinen Kontakten",
      userNotFound: "Kein Benutzer mit diesem Benutzernamen gefunden",
      cannotAddSelf: "Du kannst dich nicht selbst hinzufügen",
      addContactError: "Kontakt konnte nicht hinzugefügt werden",
      cancel: "Abbrechen",
      inviteLinkCopied: "Einladungslink kopiert",
      addFromContacts: "Aus meinen Kontakten hinzufügen",
      contactsInGroup: "Meine Kontakte",
      selectContacts: "Kontakte zum Hinzufügen auswählen",
    },
    home: {
      selectConversation: 'Gespräch auswählen',
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
