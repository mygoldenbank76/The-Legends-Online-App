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
    setHeaders(res, filePath) {
      const rel = path.relative(distDir, filePath).split(path.sep).join("/");
      if (rel === "sw.js" || rel === "manifest.json" || rel === "index.html") {
        setNoCache(res);
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
