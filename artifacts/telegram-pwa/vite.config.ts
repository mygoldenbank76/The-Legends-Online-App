import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Replace the literal __SW_BUILD_ID__ inside public/sw.js with a unique
// per-build identifier, so every deploy ships a *different* sw.js file.
// Without this, browsers see byte-identical sw.js files between deploys
// and never trigger an update — meaning the cached app shell sticks
// around forever and code changes never reach installed APKs / PWAs.
function swBuildIdPlugin(): Plugin {
  const BUILD_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    name: 'sw-build-id',
    transform(code, id) {
      if (id.endsWith('/public/sw.js') || id.endsWith('\\public\\sw.js')) {
        return code.replace(/__SW_BUILD_ID__/g, BUILD_ID);
      }
      return null;
    },
    // Vite copies public/* verbatim without going through transform(),
    // so we patch the file on disk after the build too via writeBundle.
    async writeBundle(options) {
      const fs = await import('node:fs/promises');
      const out = path.join(options.dir || 'dist', 'sw.js');
      try {
        const content = await fs.readFile(out, 'utf8');
        if (content.includes('__SW_BUILD_ID__')) {
          await fs.writeFile(out, content.replace(/__SW_BUILD_ID__/g, BUILD_ID));
        }
      } catch {
        /* sw.js not in this output, ignore */
      }
    },
  };
}

const rawPort = process.env.PORT;
const port = rawPort && !Number.isNaN(Number(rawPort)) && Number(rawPort) > 0
  ? Number(rawPort)
  : 3000;

const basePath = process.env.BASE_PATH ?? '/';

// Inject a stable, human-readable version + build identifier into the bundle
// so the Settings footer can display "The Legends Online · PWA v1.0.0 (build
// 28ddfb4)" the same way Telegram shows "Telegram pour Android v12.6.4 (6666)".
// On the APK we override these at runtime with App.getInfo() (versionName +
// versionCode), but on web/PWA these compile-time constants are the source
// of truth.
const APP_VERSION = '1.0.0';
const APP_BUILD = (process.env.GITHUB_SHA || process.env.REPL_DEPLOYMENT_ID || `dev-${Date.now().toString(36)}`).slice(0, 7);

export default defineConfig({
  base: basePath,
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_BUILD__: JSON.stringify(APP_BUILD),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    swBuildIdPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
