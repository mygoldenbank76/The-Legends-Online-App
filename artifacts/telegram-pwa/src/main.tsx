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

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      const basePath = import.meta.env.BASE_URL || '/';
      navigator.serviceWorker
        .register(`${basePath}sw.js`)
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