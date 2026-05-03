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