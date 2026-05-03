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

export default defineConfig({
  base: basePath,
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
