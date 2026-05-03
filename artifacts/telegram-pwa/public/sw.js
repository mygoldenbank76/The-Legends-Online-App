// ─────────────────────────────────────────────────────────────────────────────
// Service Worker — app-shell + categorised media cache (Telegram-style)
//
// VERSION is replaced at build time with a per-deploy unique ID by the
// `swBuildIdPlugin` Vite plugin. This guarantees that every deploy ships
// a byte-different sw.js → the browser detects an updatefound → installs
// the new SW → broadcasts SW_UPDATED → the page reloads with fresh code.
// Without this, the same `v11` string would persist across deploys and
// installed APKs / PWAs would never receive UI updates without a manual
// reinstall.
//
// Media caching strategy (parity with TDLib's FileManager):
//
//   Telegram doesn't put every cached file in one bucket — that would
//   let a flurry of large videos evict your avatars and the stripped
//   thumbnails of last week's chats. Instead it categorises by purpose
//   and applies an independent quota + LRU per category. We mirror that
//   here at the Cache Storage API level by routing each request to one
//   of four caches:
//
//     • avatars → small, very long-lived, never evicted by media bursts
//     • thumbs  → still images and stripped previews
//     • media   → photos, videos, voice notes, music
//     • docs    → PDFs / archives / spreadsheets
//
//   Each cache has its own MAX_ENTRIES + TRIM_TO so heavy media use
//   can't push avatars / thumbs out, and a giant document download
//   can't blow away your photo cache. The legacy `legends-media-v1`
//   cache (created before this categorisation existed) is read on
//   miss-fallback so existing user data is preserved across the
//   upgrade.
//
//   "True" LRU vs FIFO: on every cache hit we re-PUT the response in
//   the background. Because Cache Storage's `put` of an existing key
//   removes the old entry and inserts a fresh one at the END of the
//   keys() iterator, this turns the FIFO trim (drop from front) into
//   a real LRU (drop least-recently-touched). The cost is one extra
//   write per read, kicked off via event.waitUntil so it never
//   delays the response.
// ─────────────────────────────────────────────────────────────────────────────

const VERSION = '__SW_BUILD_ID__';
const CACHE_NAME = `legends-${VERSION}`;
const STATIC_CACHE = `legends-static-${VERSION}`;
const SHELL_CACHE = `legends-shell-${VERSION}`;

// IMPORTANT: media cache names are intentionally VERSION-INDEPENDENT.
// Photos, videos, voice notes, and external thumbnails are immutable
// (the URL itself contains a content-hashed object id, or it's an
// external CDN with its own cache headers), so they remain valid
// across every app deploy. Keeping the same cache names across
// deploys means an APK update never wipes the user's already-
// downloaded media — fixing the "after closing/reopening the app,
// photos reload from scratch" complaint. The shell/static caches
// still version-bump so code updates roll out instantly.
const AVATARS_CACHE = 'legends-avatars-v1';
const THUMBS_CACHE = 'legends-thumbs-v1';
const MEDIA_CACHE = 'legends-media-v1'; // photos, videos, voice (also pre-v2 entries)
const DOCS_CACHE = 'legends-docs-v1';

// Per-category quotas. Sized for a heavy user: months of typical use
// without trim churn, while keeping total disk footprint under ~600 MB
// at saturation (avatars ~10 MB + thumbs ~50 MB + media ~500 MB +
// docs ~50 MB, rough back-of-envelope at average byte sizes).
//
// Telegram's defaults on Android are ~500 MB / ~3 GB depending on
// device class; the browser's storage quota is generally ~10% of
// disk free space, so even on a 32 GB phone we have ~3 GB to play
// with. We stay well under that to leave room for IDB and other
// app data.
const QUOTAS = {
  [AVATARS_CACHE]: { max: 600, trimTo: 480 },     // ~600 unique users covered
  [THUMBS_CACHE]:  { max: 4000, trimTo: 3200 },   // months of stripped previews
  [MEDIA_CACHE]:   { max: 2000, trimTo: 1600 },   // recent full-res photos/videos/voice
  [DOCS_CACHE]:    { max: 400, trimTo: 320 },     // PDFs/zips don't need huge depth
};

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

// All categorised media caches, in fallback-search order (avatar
// requests check avatars first, then thumbs/media/docs in case the
// URL was previously categorised differently). Keeps backward compat
// with pre-v2 entries that all live in MEDIA_CACHE.
const ALL_MEDIA_CACHES = [AVATARS_CACHE, THUMBS_CACHE, MEDIA_CACHE, DOCS_CACHE];

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
    const valid = new Set([
      CACHE_NAME, STATIC_CACHE, SHELL_CACHE,
      AVATARS_CACHE, THUMBS_CACHE, MEDIA_CACHE, DOCS_CACHE,
    ]);
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

const AUDIO_RE = /\.(mp3|m4a|ogg|wav|opus|aac|weba)(\?|$)/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|$)/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|heic|heif|ico)(\?|$)/i;
const DOC_RE = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|zip|rar|7z|gz|tgz|tar|csv|txt)(\?|$)/i;
const FONT_RE = /\.(woff2?|ttf|otf)(\?|$)/i;

/**
 * Categorise a media request to its target cache. Routing is purely
 * by URL shape — no need to parse the response. Order matters:
 * avatars are detected first because their URLs may end in .jpg
 * which would otherwise route to thumbs.
 */
function categoriseMedia(url) {
  const p = url.pathname.toLowerCase();
  // Avatars: our /api/avatars/ proxy or any URL whose path explicitly
  // mentions "avatar" or "profile". External user avatars (gravatar,
  // OAuth profile pics) too.
  if (p.includes('/avatar') || p.includes('/profile-pic') || p.includes('/profile_pic')) return AVATARS_CACHE;
  if (FONT_RE.test(p)) return STATIC_CACHE;
  if (DOC_RE.test(p)) return DOCS_CACHE;
  if (VIDEO_RE.test(p) || AUDIO_RE.test(p)) return MEDIA_CACHE;
  // Stripped thumbnails / link-preview images / reaction emoji etc.
  // are small and high-frequency — give them their own bucket so a
  // burst of full-res photos can't evict them.
  if (IMAGE_RE.test(p)) return THUMBS_CACHE;
  // Default for anything else our /api/uploads/gcs/ path serves
  // (mime-detected on the server, no useful extension).
  return MEDIA_CACHE;
}

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
  if (DOC_RE.test(pathname)) return true;
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

// ── Quota error telemetry ────────────────────────────────────────────────────
// When cache.put fails with QuotaExceededError, the OS-level storage
// quota was hit before our LRU trim could run. We rate-limit reports
// to one every 5 minutes per SW instance to avoid swamping the client
// (and the telemetry endpoint) on a sustained quota miss.
let lastQuotaReportAt = 0;
async function reportQuotaExceeded(err, context) {
  const now = Date.now();
  if (now - lastQuotaReportAt < 5 * 60_000) return;
  lastQuotaReportAt = now;
  try {
    const counts = {};
    for (const name of ALL_MEDIA_CACHES) {
      try {
        const c = await caches.open(name);
        counts[name] = (await c.keys()).length;
      } catch { counts[name] = -1; }
    }
    const clientsList = await self.clients.matchAll({ type: 'window' });
    clientsList.forEach((c) => c.postMessage({
      type: 'SW_QUOTA_EXCEEDED',
      context,
      cacheCounts: counts,
      errorName: (err && err.name) || 'QuotaExceededError',
      errorMessage: (err && err.message) || String(err),
      ts: now,
    }));
  } catch {
    /* swallow — telemetry must never break the SW */
  }
}

// ── Per-category LRU trim ────────────────────────────────────────────────────
// Each cache trims independently against its own quota. Trim is rate-
// limited per cache so a burst of puts to the same bucket doesn't
// re-walk keys() on every single put.
const lastTrimAt = new Map(); // cacheName → timestamp
const trimInFlight = new Set(); // cacheName

async function trimCacheIfNeeded(cacheName, cache) {
  const now = Date.now();
  if (trimInFlight.has(cacheName)) return;
  if ((lastTrimAt.get(cacheName) || 0) > now - 30_000) return;
  trimInFlight.add(cacheName);
  try {
    const quota = QUOTAS[cacheName];
    if (!quota) return;
    const keys = await cache.keys();
    if (keys.length <= quota.max) {
      lastTrimAt.set(cacheName, now);
      return;
    }
    const toDelete = keys.length - quota.trimTo;
    // keys() is insertion-ordered → first N are oldest (least
    // recently touched, since touch-on-read re-PUTs to the end).
    for (let i = 0; i < toDelete; i++) {
      await cache.delete(keys[i]);
    }
    lastTrimAt.set(cacheName, Date.now());
  } catch {
    // Best-effort — quota errors etc. are silently ignored
  } finally {
    trimInFlight.delete(cacheName);
  }
}

// ── True-LRU touch-on-read ───────────────────────────────────────────────────
// Re-PUT the cached response so it moves to the end of the cache's
// keys() iterator. The trim above drops from the FRONT, so this turns
// FIFO into LRU. We rate-limit per URL to avoid burning IO when the
// same image is requested back-to-back (e.g. a loop of `<img>` re-
// renders within the same React commit).
const lastTouchAt = new Map(); // url string → timestamp
const TOUCH_DEBOUNCE_MS = 60_000; // re-touch at most once per minute per URL

async function touchCacheEntry(cacheName, cache, request, cached) {
  const url = request.url;
  const now = Date.now();
  if ((lastTouchAt.get(url) || 0) > now - TOUCH_DEBOUNCE_MS) return;
  lastTouchAt.set(url, now);
  // Cap the touch map so a session that opens thousands of unique
  // URLs doesn't grow it unbounded. Drop oldest 25% when over 5000.
  if (lastTouchAt.size > 5000) {
    const drop = Math.floor(lastTouchAt.size / 4);
    let n = 0;
    for (const k of lastTouchAt.keys()) {
      lastTouchAt.delete(k);
      if (++n >= drop) break;
    }
  }
  try {
    // Clone is required because the original `cached` was already
    // returned to the page (its body is consumed by the renderer).
    await cache.put(request, cached.clone());
  } catch (err) {
    if (err && err.name === 'QuotaExceededError') {
      // No telemetry spam from a touch — it's purely a hint.
    }
  }
}

// ── Search all categorised caches for a request ──────────────────────────────
// Used on the cache-first path so a URL that was originally cached
// pre-categorisation (everything in MEDIA_CACHE before this upgrade,
// or routed to a different cache because the URL changed shape) is
// still found instead of triggering an unnecessary network roundtrip.
async function findInAnyMediaCache(request, primaryCacheName) {
  // Try the primary first (most common hit)
  const primary = await caches.open(primaryCacheName);
  const direct = await primary.match(request);
  if (direct) return { cache: primary, cacheName: primaryCacheName, response: direct };
  // Fallback: scan the others in order. Avoid scanning STATIC_CACHE here
  // (different lifecycle, version-bumped per deploy).
  for (const name of ALL_MEDIA_CACHES) {
    if (name === primaryCacheName) continue;
    const c = await caches.open(name);
    const r = await c.match(request);
    if (r) return { cache: c, cacheName: name, response: r };
  }
  return null;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET — POST/PUT/DELETE/etc. (auth, mutations, analytics
  // beacons via navigator.sendBeacon) MUST always go straight to the
  // network. Caching them would corrupt server state on replay.
  if (request.method !== 'GET') return;

  // Stale-while-revalidate threshold for media: serve cached response
  // immediately, but if it's older than 7 days, refresh it in the
  // background so user-uploaded content that mutates at the same URL
  // (avatars overwritten in object storage, etc.) eventually picks up.
  // Hashed/signed URLs never trigger a refetch since their URL changes.
  const SWR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const isCachedStale = (cached) => {
    try {
      const dateHeader = cached.headers.get('date');
      if (!dateHeader) return false;
      return Date.now() - new Date(dateHeader).getTime() > SWR_MAX_AGE_MS;
    } catch { return false; }
  };

  // ── 1. Our own media proxy — Cache First, categorised ──────────────────
  if (url.origin === self.location.origin && isMediaRequest(url)) {
    const targetCacheName = categoriseMedia(url);
    event.respondWith((async () => {
      const hit = await findInAnyMediaCache(request, targetCacheName);
      if (hit) {
        // Touch-on-read in the background so this entry survives the
        // next trim pass over its cache. Also re-fetch in the
        // background if the cached response is stale.
        event.waitUntil(touchCacheEntry(hit.cacheName, hit.cache, request, hit.response));
        if (isCachedStale(hit.response)) {
          event.waitUntil(
            fetch(request).then(async (res) => {
              if (res.ok) {
                try { await hit.cache.put(request, res.clone()); } catch {}
              }
            }).catch(() => {})
          );
        }
        return hit.response;
      }
      // Cache miss → network → put in the categorised cache.
      const targetCache = await caches.open(targetCacheName);
      const response = await fetch(request);
      if (response.ok) {
        try {
          await targetCache.put(request, response.clone());
        } catch (err) {
          if (err && err.name === 'QuotaExceededError') {
            event.waitUntil(reportQuotaExceeded(err, `media-${targetCacheName}`));
          }
        }
        // Fire-and-forget trim — never blocks the response.
        event.waitUntil(trimCacheIfNeeded(targetCacheName, targetCache));
      }
      return response;
    })());
    return;
  }

  // ── 2. External media thumbnails — Cache First (opaque ok) ───────────────
  if (isExternalMedia(url)) {
    const targetCacheName = categoriseMedia(url);
    event.respondWith((async () => {
      const hit = await findInAnyMediaCache(request, targetCacheName);
      if (hit) {
        event.waitUntil(touchCacheEntry(hit.cacheName, hit.cache, request, hit.response));
        if (isCachedStale(hit.response)) {
          event.waitUntil(
            fetch(request, { mode: 'no-cors' }).then(async (res) => {
              if (res.type === 'opaque' || res.ok) {
                try { await hit.cache.put(request, res.clone()); } catch {}
              }
            }).catch(() => {})
          );
        }
        return hit.response;
      }
      try {
        // no-cors gives opaque response — still cacheable and displayable
        const targetCache = await caches.open(targetCacheName);
        const response = await fetch(request, { mode: 'no-cors' });
        if (response.type === 'opaque' || response.ok) {
          try {
            await targetCache.put(request, response.clone());
          } catch (err) {
            if (err && err.name === 'QuotaExceededError') {
              event.waitUntil(reportQuotaExceeded(err, `external-${targetCacheName}`));
            }
          }
          event.waitUntil(trimCacheIfNeeded(targetCacheName, targetCache));
        }
        return response;
      } catch {
        return new Response('', { status: 503 });
      }
    })());
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
