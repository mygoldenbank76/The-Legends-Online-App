// ─────────────────────────────────────────────────────────────────────────────
// Service Worker — app-shell + network-first navigation
//
// VERSION is replaced at build time with a per-deploy unique ID by the
// `swBuildIdPlugin` Vite plugin. This guarantees that every deploy ships
// a byte-different sw.js → the browser detects an updatefound → installs
// the new SW → broadcasts SW_UPDATED → the page reloads with fresh code.
// Without this, the same `v11` string would persist across deploys and
// installed APKs / PWAs would never receive UI updates without a manual
// reinstall.
// ─────────────────────────────────────────────────────────────────────────────

const VERSION = '__SW_BUILD_ID__';
const CACHE_NAME = `legends-${VERSION}`;
const STATIC_CACHE = `legends-static-${VERSION}`;
const MEDIA_CACHE = `legends-media-${VERSION}`;
const SHELL_CACHE = `legends-shell-${VERSION}`;

// App-shell URLs precached at install time. These are the bare minimum
// the browser needs to paint the first frame from cache without any
// network call. The hashed JS/CSS bundles are NOT listed here — they
// live in /assets/ and get cache-first treatment on first request,
// then live forever in STATIC_CACHE thanks to their content-hashed
// filenames (immutable).
const SHELL_URLS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-notification.png',
  '/icon-badge.png',
  '/favicon.svg',
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll is atomic — if any URL fails the whole precache fails and the
    // SW won't install. We use addAll with allSettled-like resilience by
    // adding one-by-one so a single missing icon doesn't break everything.
    await Promise.all(
      SHELL_URLS.map((url) =>
        fetch(url, { cache: 'reload' })
          .then((res) => (res.ok ? cache.put(url, res) : null))
          .catch(() => null),
      ),
    );
    self.skipWaiting();
  })());
});

// Allow the page to force activation of an installed-but-waiting SW.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Activate: nuke ALL old caches (any version), then claim ──────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const valid = new Set([CACHE_NAME, STATIC_CACHE, MEDIA_CACHE, SHELL_CACHE]);
    await Promise.all(
      keys
        .filter((k) => !valid.has(k))
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
    // Tell all open clients a new SW is controlling them so they can reload.
    const clientsList = await self.clients.matchAll({ type: 'window' });
    clientsList.forEach((c) => c.postMessage({ type: 'SW_UPDATED' }));
  })());
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** URLs that should be served Cache-First (media files) */
function isMediaRequest(url) {
  const pathname = url.pathname;
  // Our own GCS media proxy — covers every uploaded media (image, video,
  // audio, document) so even PDFs and voice notes are cached for offline
  // re-visits and instant re-opens.
  if (pathname.startsWith('/api/uploads/gcs/')) return true;
  // Static media extensions (images / video / audio / fonts).
  // The audio formats here matter so voice messages and music attachments
  // hit the same cache-first path as images and don't re-stream every
  // time the user navigates away and back.
  if (/\.(png|jpe?g|gif|webp|avif|svg|bmp|heic|heif|ico|mp4|webm|mov|m4v|mp3|m4a|ogg|wav|opus|aac|weba|woff2?)(\?|$)/i.test(pathname)) return true;
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

  // ── 3. Navigation requests — Network-first with fast-cache fallback ──
  // The HTML shell is the *only* file that controls which JS/CSS bundle
  // hashes the page loads. If we serve a stale cached shell, the user
  // boots into old code and never sees any deploy until the SW happens
  // to update. To guarantee fresh code on every launch with online
  // connectivity — while still giving an instant boot when offline or
  // the network is slow — we race the network against a 1.5 s timer
  // that falls back to the cache. The cache is also refreshed in the
  // background on every successful network response.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match('/');
      const networkFetch = fetch(request).then((res) => {
        if (res && res.ok) cache.put('/', res.clone());
        return res;
      }).catch(() => null);

      // If we have a cached shell, race network vs a 1.5s timeout so
      // boot is instant on poor connections. Without cache, await the
      // network indefinitely (first ever visit).
      if (cached) {
        const winner = await Promise.race([
          networkFetch,
          new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
        return winner || cached;
      }
      return (await networkFetch) || new Response('', { status: 504 });
    })());
    return;
  }

  // ── 4. Hashed static assets (JS/CSS bundles) — Cache First, immutable ──
  // Hashed filenames mean the same URL ALWAYS returns the same bytes,
  // so we can cache forever — that's why STATIC_CACHE never needs to
  // expire entries. New deploys use new hashes, which simply add new
  // entries without invalidating old ones.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── 5. Everything else — Network First with cache fallback ──────────────
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

  // ── Incoming call notification ─────────────────────────────────────────────
  if (data?.type === 'incoming_call') {
    event.waitUntil(
      self.registration.showNotification(title || '📞 Appel entrant', {
        body: body || '',
        icon: toAbsolute(icon),
        badge: toAbsolute(badge),
        tag: `call-incoming-${data.conversationId}`,
        renotify: true,
        data: data || {},
        vibrate: [300, 150, 300, 150, 300],
        requireInteraction: true, // keep visible until user interacts
        actions: [
          { action: 'accept_call', title: '✅ Accepter' },
          { action: 'reject_call', title: '❌ Refuser' },
        ],
      })
    );
    return;
  }

  // ── Regular message notification ───────────────────────────────────────────
  const conversationId = data?.conversationId;
  const notifTag = conversationId ? `conv-${conversationId}` : 'legends-notification';

  event.waitUntil(
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
        renotify: true,
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

  // ── Call actions from notification ──────────────────────────────────────────
  if (event.action === 'accept_call' || event.action === 'reject_call') {
    const action = event.action === 'accept_call' ? 'ACCEPT_CALL' : 'REJECT_CALL';
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        const appClient = findAppClient(clientList);
        if (appClient) {
          appClient.focus();
          appClient.postMessage({ type: action, conversationId });
          return;
        }
        // App not open — open it; user will see the call UI when they arrive
        if (clients.openWindow) {
          return clients.openWindow(conversationId ? `/?conv=${conversationId}&type=direct` : '/');
        }
      })
    );
    return;
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
