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
      if (rel.startsWith("downloads/") && rel.endsWith(".apk")) {
        // Android-specific MIME type — without this, some browsers serve
        // the APK as `application/octet-stream` and Chrome/Files won't
        // offer the "Install" button. `Content-Disposition: attachment`
        // forces a download instead of letting Chrome try to render it.
        res.setHeader(
          "Content-Type",
          "application/vnd.android.package-archive"
        );
        const filename = rel.split("/").pop();
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );
        // 1-day cache; users on slow connections shouldn't re-download
        // mid-install if they retry, but we want new releases to
        // propagate within a day.
        res.setHeader("Cache-Control", "public, max-age=86400");
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

// Explicit 404 for missing APK / well-known files BEFORE the SPA
// catch-all. Without this, a request for `/downloads/legends.apk`
// when the file isn't uploaded yet would fall through to the SPA
// catch-all below, get served `index.html` with `Content-Type:
// text/html`, and Chrome would happily save the response as
// `legends.apk.html` — confusing the user. Same risk for
// `/.well-known/assetlinks.json` if the file is ever removed.
app.use((req, res, next) => {
  const p = req.path;
  const isApk = p.startsWith("/downloads/") && p.endsWith(".apk");
  const isWellKnown = p.startsWith("/.well-known/");
  if (!isApk && !isWellKnown) return next();
  res
    .status(404)
    .type("application/json")
    .send(JSON.stringify({ error: "not_found", path: p }));
});

app.use((_req, res) => {
  setNoCache(res);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  fs.createReadStream(indexHtmlPath).pipe(res);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`telegram-pwa static server listening on ${port}`);
});
