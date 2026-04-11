import { Router } from "express";
import axios from "axios";

const router = Router();

const SITE_ORIGIN = "https://www.goldenvibeofficiel.com";
const PROXY_PATH = "/api/shop-proxy";

const BLOCKED_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-type-options",
  "transfer-encoding",
  "connection",
]);

function rewriteHtml(html: string): string {
  const base = `<base href="${SITE_ORIGIN}/">`;

  // Rewrite absolute links pointing to the shop to go through our proxy
  html = html.replace(
    /href="https:\/\/www\.goldenvibeofficiel\.com(\/[^"]*)"/g,
    (_, path) => `href="${PROXY_PATH}?path=${encodeURIComponent(path)}"`
  );
  html = html.replace(
    /href='https:\/\/www\.goldenvibeofficiel\.com(\/[^']*)'/g,
    (_, path) => `href='${PROXY_PATH}?path=${encodeURIComponent(path)}'`
  );

  // Inject base tag so relative resources (CSS, JS, images) load from origin
  html = html.includes("<head>")
    ? html.replace("<head>", `<head>${base}`)
    : html.replace("<HEAD>", `<HEAD>${base}`);

  return html;
}

router.get("/shop-proxy", async (req, res) => {
  const rawPath = (req.query.path as string) || "/";
  const safePath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const targetUrl = `${SITE_ORIGIN}${safePath}`;

  try {
    const upstream = await axios.get(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",
        Referer: SITE_ORIGIN,
      },
      responseType: "arraybuffer",
      validateStatus: () => true,
      maxRedirects: 5,
      timeout: 15000,
    });

    // Forward safe headers (strip blocking ones)
    Object.entries(upstream.headers).forEach(([key, value]) => {
      if (!BLOCKED_HEADERS.has(key.toLowerCase()) && value) {
        res.setHeader(key, value as string | string[]);
      }
    });

    const contentType =
      (upstream.headers["content-type"] as string) || "text/html";

    if (contentType.includes("text/html")) {
      const html = rewriteHtml(upstream.data.toString("utf-8"));
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(upstream.status).send(html);
    } else {
      res.status(upstream.status).send(upstream.data);
    }
  } catch (err) {
    res.status(502).send(`<html><body style="font-family:sans-serif;padding:2rem;text-align:center;">
      <h2>Impossible de charger le shop</h2>
      <p>Essayez d'ouvrir le shop directement.</p>
      <a href="${SITE_ORIGIN}" target="_top" style="color:#8b5cf6;">Ouvrir goldenvibeofficiel.com</a>
    </body></html>`);
  }
});

export default router;
