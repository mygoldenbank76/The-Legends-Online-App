const CACHE_NAME = 'legends-v3';
const STATIC_CACHE = 'legends-static-v3';

// On install: skip waiting to activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(['/manifest.json', '/icon-192.png']);
    })
  );
});

// On activate: delete all old caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and non-same-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Skip API and socket requests — always go to network
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) {
    return;
  }

  // Navigation requests (HTML) — network first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => cached || caches.match('/index.html'));
        })
    );
    return;
  }

  // Static assets with content hash in filename (JS, CSS) — cache first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Everything else — network first
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ── Push notification handler ──────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'The Legends Online', body: event.data.text() };
  }

  const { title, body, icon, badge, tag, data } = payload;

  // Always use absolute URLs so Android can load the icon correctly
  const origin = self.location.origin;
  const toAbsolute = (path) => {
    if (!path) return origin + '/icon-notification.png';
    if (path.startsWith('http')) return path;
    return origin + path;
  };

  event.waitUntil(
    self.registration.showNotification(title || 'The Legends Online', {
      body: body || '',
      icon: toAbsolute(icon),
      badge: toAbsolute(badge),
      tag: tag || 'legends-notification',
      data: data || {},
      vibrate: [200, 100, 200],
      requireInteraction: false,
      actions: [
        { action: 'reply', title: 'Répondre', type: 'text', placeholder: 'Écrire un message…' },
      ],
    })
  );
});

// ── IndexedDB helper (SW context) ─────────────────────────────────────────
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

// ── Notification click handler ─────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  const conversationId = notifData.conversationId;
  const isGroup = notifData.isGroup;
  const type = isGroup ? 'group' : 'direct';
  const fallbackUrl = conversationId ? `/?conv=${conversationId}&type=${type}` : '/';

  // ── Inline reply action ────────────────────────────────────────────────
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
          // Notify open app to refresh the conversation
          return clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
              client.postMessage({ type: 'MESSAGE_SENT', conversationId });
            }
          });
        });
      })
    );
    return;
  }

  // ── Normal tap: open conversation ─────────────────────────────────────
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (conversationId) {
            client.postMessage({ type: 'OPEN_CONVERSATION', conversationId, isGroup });
          }
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(fallbackUrl);
      }
    })
  );
});
