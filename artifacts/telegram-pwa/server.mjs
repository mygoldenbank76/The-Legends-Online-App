import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist", "public");
const indexHtmlPath = path.join(distDir, "index.html");

const app = express();
const port = Number(process.env.PORT) || 22768;

function setNoCache(res) {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

app.use((req, res, next) => {
  if (req.path === "/sw.js" || req.path === "/manifest.json") {
    setNoCache(res);
    res.setHeader("Service-Worker-Allowed", "/");
  }
  next();
});

app.use(
  express.static(distDir, {
    index: false,
    etag: true,
    lastModified: true,
    // dotfiles: "allow" lets Express serve `/.well-known/assetlinks.json`,
    // which Chrome / Android fetch to verify our Trusted Web Activity APK
    // is allowed to render this domain without the URL bar. Without this
    // (default is "ignore"), the request 404s, falls through to the SPA
    // catch-all below, and gets served index.html — Android then sees
    // an HTML body where it expected JSON and treats the link as
    // unverified, so the APK shows the Chrome address bar.
    dotfiles: "allow",
    setHeaders(res, filePath) {
      const rel = path.relative(distDir, filePath).split(path.sep).join("/");
      if (rel === "sw.js" || rel === "manifest.json" || rel === "index.html") {
        setNoCache(res);
        return;
      }
      if (rel === ".well-known/assetlinks.json") {
        // Explicit content-type — some Android verifier builds are picky
        // and reject anything that isn't exactly application/json. Short
        // cache so cert-fingerprint rotations propagate within the hour.
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=3600");
        return;
      }
      if (rel.startsWith("assets/")) {
        res.setHeader(
          "Cache-Control",
          "public, max-age=31536000, immutable"
        );
        return;
      }
      res.setHeader("Cache-Control", "public, max-age=3600");
    },
  })
);

app.use((_req, res) => {
  setNoCache(res);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  fs.createReadStream(indexHtmlPath).pipe(res);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`telegram-pwa static server listening on ${port}`);
});
