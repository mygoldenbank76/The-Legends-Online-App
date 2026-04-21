const CACHE_NAME = 'legends-v5';
const STATIC_CACHE = 'legends-static-v5';
const MEDIA_CACHE = 'legends-media-v5';

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(['/manifest.json', '/icon-192.png']);
    })
  );
});

// ── Activate: delete old caches ──────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== STATIC_CACHE && k !== MEDIA_CACHE)
          .map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** URLs that should be served Cache-First (media files) */
function isMediaRequest(url) {
  const pathname = url.pathname;
  // Our own GCS media proxy
  if (pathname.startsWith('/api/uploads/gcs/')) return true;
  // Static image/video extensions
  if (/\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|ico|woff2?)(\?|$)/i.test(pathname)) return true;
  return false;
}

/** External media hosts to cache (thumbnails, avatars, og-images) */
const EXTERNAL_MEDIA_HOSTS = [
  'i.ytimg.com',
  'img.youtube.com',
  'i.scdn.co',
  'mosaic.scdn.co',
  'i.imgur.com',
  'media.giphy.com',
  'media0.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com',
  'c.tenor.com',
  'media.tenor.com',
];

function isExternalMedia(url) {
  return EXTERNAL_MEDIA_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET
  if (request.method !== 'GET') return;

  // ── 1. Our own media proxy — Cache First, very long TTL ──────────────────
  if (url.origin === self.location.origin && isMediaRequest(url)) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // ── 2. External media thumbnails — Cache First (opaque ok) ───────────────
  if (isExternalMedia(url)) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          // no-cors gives opaque response — still cacheable and displayable
          const response = await fetch(request, { mode: 'no-cors' });
          if (response.type === 'opaque' || response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  // Skip API (data) and socket — always network
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io'))
  ) {
    return;
  }

  // Skip cross-origin non-media
  if (url.origin !== self.location.origin) return;

  // ── 3. Navigation requests — Network First, cache fallback ───────────────
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  // ── 4. Hashed static assets (JS/CSS bundles) — Cache First ───────────────
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // ── 5. Everything else — Network First ───────────────────────────────────
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

// ── Push notification handler ─────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'The Legends Online', body: event.data.text() };
  }

  const { title, body, icon, badge, data } = payload;
  const origin = self.location.origin;
  const toAbsolute = (path) => {
    if (!path) return origin + '/icon-notification.png';
    if (path.startsWith('http')) return path;
    return origin + path;
  };

  // Use conversation-specific tag so notifications can be grouped/replaced
  const conversationId = data?.conversationId;
  const notifTag = conversationId ? `conv-${conversationId}` : 'legends-notification';

  event.waitUntil(
    // Check existing notifications for this conversation to group them
    self.registration.getNotifications({ tag: notifTag }).then((existing) => {
      let finalTitle = title || 'The Legends Online';
      let finalBody = body || '';

      if (existing.length > 0) {
        // Group: show cumulative count
        const count = existing.length + 1;
        finalTitle = data?.groupName || data?.conversationName || 'The Legends Online';
        finalBody = `${count} nouveaux messages`;
      }

      return self.registration.showNotification(finalTitle, {
        body: finalBody,
        icon: toAbsolute(icon),
        badge: toAbsolute(badge),
        tag: notifTag,
        renotify: true,          // vibrate/sound even when replacing same tag
        data: data || {},
        vibrate: [200, 100, 200],
        requireInteraction: false,
        actions: [
          { action: 'reply', title: 'Répondre', type: 'text', placeholder: 'Écrire un message…' },
        ],
      });
    })
  );
});

// ── IndexedDB helper (SW context) ─────────────────────────────────────────────
function getTokenFromIDB() {
  return new Promise((resolve) => {
    const req = indexedDB.open('legends-auth', 1);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('keyval')) { resolve(null); return; }
      const tx = db.transaction('keyval', 'readonly');
      const get = tx.objectStore('keyval').get('token');
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

// ── Notification click handler ─────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  const conversationId = notifData.conversationId;
  const isGroup = notifData.isGroup;
  const type = isGroup ? 'group' : 'direct';
  const fallbackUrl = conversationId ? `/?conv=${conversationId}&type=${type}` : '/';

  function findAppClient(clientList) {
    return clientList.find(
      (c) => c.url.startsWith(self.location.origin) && 'focus' in c
    ) || null;
  }

  if (event.action === 'reply' && event.reply && conversationId) {
    const replyText = event.reply.trim();
    event.waitUntil(
      getTokenFromIDB().then((token) => {
        if (!token || !replyText) return;
        return fetch(`/api/conversations/${conversationId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content: replyText }),
        }).then(() => {
          return clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            const appClient = findAppClient(clientList);
            if (appClient) {
              appClient.postMessage({ type: 'MESSAGE_SENT', conversationId, isGroup });
            }
          });
        });
      })
    );
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const appClient = findAppClient(clientList);
      if (appClient) {
        return appClient.focus().then((focused) => {
          if (conversationId) {
            focused.postMessage({ type: 'OPEN_CONVERSATION', conversationId, isGroup });
          }
        });
      }
      if (clients.openWindow) {
        return clients.openWindow(fallbackUrl);
      }
    })
  );
});
