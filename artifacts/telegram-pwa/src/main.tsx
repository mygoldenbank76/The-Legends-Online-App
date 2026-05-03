import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import "./lib/auth-fetch"; // Initialize auth fetch

// Theme is locked to dark for the whole platform.
document.documentElement.dataset.theme = "dark";
document.documentElement.classList.add("dark");
const _metaThemeColor = document.querySelector('meta[name="theme-color"]');
if (_metaThemeColor) {
  _metaThemeColor.setAttribute("content", "#0e121c");
}

// ── Persistent storage request ────────────────────────────────────────
// Without this, Chrome's default storage quota for a site is "best
// effort": under disk pressure the browser is allowed to evict our
// MEDIA_CACHE / STATIC_CACHE entries even though the user installed
// the app and expects native-app behaviour. With persistent storage
// granted, caches survive until the user manually clears site data —
// which is the behaviour Telegram, WhatsApp, etc. native apps have.
//
// For installed PWAs and Trusted Web Activities (our APK), Chrome
// auto-grants this without a user prompt. For regular browser tabs
// it may be denied silently — that's fine, the cache still works,
// it's just evictable. Either way, calling persist() is harmless.
//
// Runs in PROD only (dev unregisters the SW entirely below) and is
// fire-and-forget — we never want to block app startup on this.
async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return;
  try {
    const already = await navigator.storage.persisted();
    if (already) return;
    const granted = await navigator.storage.persist();
    if (granted) {
      console.info('[storage] persistent storage granted — cache survives eviction');
    }
  } catch {
    /* non-fatal */
  }
}

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      const basePath = import.meta.env.BASE_URL || '/';
      navigator.serviceWorker
        .register(`${basePath}sw.js`, { updateViaCache: 'none' })
        .then((reg) => {
          // Auto-reload as soon as a new SW takes control of this page.
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', () => {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                sw.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
          // Actively poll for SW updates: on every cold launch + each time
          // the app comes back into the foreground. Without this, the
          // browser only checks for SW updates every 24h, so the user
          // could keep booting old code for a full day after a deploy.
          reg.update().catch(() => {});
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              reg.update().catch(() => {});
            }
          });
          // Once the SW is registered, lock our caches into persistent
          // storage so the browser doesn't evict media under pressure.
          requestPersistentStorage();
        })
        .catch((err) => {
          console.log("ServiceWorker registration failed: ", err);
        });

      // When a new SW activates and broadcasts SW_UPDATED, force a clean reload.
      let _swReloaded = false;
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'SW_UPDATED' && !_swReloaded) {
          _swReloaded = true;
          window.location.reload();
        }
        // ── Quota telemetry ────────────────────────────────────────────────
        // The SW posts SW_QUOTA_EXCEEDED when cache.put fails because the
        // OS storage quota is full. We forward to the server so we can see
        // how often real users hit quota and tune MEDIA_CACHE_MAX_ENTRIES.
        // Fire-and-forget; never block the UI on telemetry.
        if (e.data && e.data.type === 'SW_QUOTA_EXCEEDED') {
          (async () => {
            let conversationCount: number | null = null;
            try {
              const w = window as Window & { __legendsConversationCount?: number };
              if (typeof w.__legendsConversationCount === 'number') {
                conversationCount = w.__legendsConversationCount;
              }
            } catch { /* ignore */ }
            let estimate: { quota?: number; usage?: number } = {};
            try {
              if (navigator.storage?.estimate) {
                const est = await navigator.storage.estimate();
                estimate = { quota: est.quota, usage: est.usage };
              }
            } catch { /* ignore */ }
            try {
              await fetch('/api/telemetry/quota-exceeded', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  context: e.data.context,
                  mediaCacheCount: e.data.mediaCacheCount,
                  conversationCount,
                  errorName: e.data.errorName,
                  errorMessage: e.data.errorMessage,
                  ts: e.data.ts,
                  quota: estimate.quota,
                  usage: estimate.usage,
                  userAgent: navigator.userAgent,
                }),
                keepalive: true,
              });
            } catch { /* swallow — telemetry must never break the app */ }
          })();
        }
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (_swReloaded) return;
        _swReloaded = true;
        window.location.reload();
      });
    });
  } else {
    // Dev mode: actively unregister any leftover SW + clear caches so HMR works.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
    if (typeof caches !== 'undefined') {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);