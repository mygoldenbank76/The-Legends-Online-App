import { Router } from "express";
import axios from "axios";

const router = Router();

const SITE_ORIGIN = "https://www.goldenvibeofficiel.com";
const PROXY_ENDPOINT = "/api/shop-proxy";

const BLOCKED_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-type-options",
  "transfer-encoding",
  "connection",
]);

// JS injected into every proxied HTML page
// Rewrites dynamically-created links and intercepts all clicks
const JS_INTERCEPTOR = `
<script data-proxy-interceptor="1">
(function() {
  var PROXY = '${PROXY_ENDPOINT}?path=';
  var ORIGINS = ['www.goldenvibeofficiel.com', 'goldenvibeofficiel.com'];

  function toProxyHref(href) {
    if (!href) return null;
    var s = href.trim();
    if (!s || s.startsWith('#') || s.startsWith('javascript:') ||
        s.startsWith('mailto:') || s.startsWith('tel:') ||
        s.startsWith('data:') || s.startsWith('blob:')) return null;

    // Absolute path (e.g. /collections/all)
    if (s.startsWith('/') && !s.startsWith('//')) {
      return PROXY + encodeURIComponent(s);
    }
    // Absolute URL to the shop
    try {
      var u = new URL(s);
      if (ORIGINS.indexOf(u.hostname) !== -1) {
        return PROXY + encodeURIComponent(u.pathname + u.search + u.hash);
      }
    } catch (e) {}
    return null;
  }

  function rewriteEl(el) {
    if (!el || !el.tagName) return;
    var tag = el.tagName.toUpperCase();
    if (tag === 'A') {
      var href = el.getAttribute('href');
      var p = toProxyHref(href);
      if (p) { el.setAttribute('href', p); el.setAttribute('data-proxied', '1'); }
    }
    if (tag === 'FORM') {
      var action = el.getAttribute('action');
      var pa = toProxyHref(action);
      if (pa) el.setAttribute('action', pa);
    }
  }

  function rewriteAll(root) {
    (root || document).querySelectorAll('a[href]:not([data-proxied])').forEach(rewriteEl);
    (root || document).querySelectorAll('form[action]').forEach(rewriteEl);
  }

  // Initial rewrite after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { rewriteAll(); });
  } else {
    rewriteAll();
  }

  // Watch for new links added by Shopify JS
  var obs = new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      m.addedNodes.forEach(function(n) {
        if (n.nodeType !== 1) return;
        rewriteEl(n);
        if (n.querySelectorAll) {
          n.querySelectorAll('a[href]:not([data-proxied]), form[action]').forEach(rewriteEl);
        }
      });
    });
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // Click interceptor as final fallback (for links Shopify recreates)
  document.addEventListener('click', function(e) {
    var el = e.target && typeof e.target.closest === 'function' && e.target.closest('a');
    if (!el) return;
    var href = el.getAttribute('href') || '';
    var p = toProxyHref(href);
    if (p) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = p;
    }
  }, true);
})();
</script>`;

function rewriteHtml(html: string): string {
  // ── 1. Strip any existing <base> tag that could confuse things
  html = html.replace(/<base[^>]*>/gi, "");

  // ── 2. Add our base tag for static resources (images, fonts via CDN)
  const baseTag = `<base href="${SITE_ORIGIN}/">`;
  html = html.includes("<head>")
    ? html.replace("<head>", `<head>${baseTag}`)
    : html.replace("<HEAD>", `<HEAD>${baseTag}`);

  // ── 3. Rewrite absolute-path links  href="/..." → proxy
  // Double quotes
  html = html.replace(
    /href="(\/(?!\/)[^"#?]*(?:[?#][^"]*)?)"/g,
    (_, path) => `href="${PROXY_ENDPOINT}?path=${encodeURIComponent(path)}"`
  );
  // Single quotes
  html = html.replace(
    /href='(\/(?!\/)[^'#?]*(?:[?#][^']*)?)'/g,
    (_, path) => `href='${PROXY_ENDPOINT}?path=${encodeURIComponent(path)}'`
  );

  // ── 4. Rewrite full-URL links to the shop
  html = html.replace(
    /href="https?:\/\/(?:www\.)?goldenvibeofficiel\.com(\/[^"]*)"/g,
    (_, path) => `href="${PROXY_ENDPOINT}?path=${encodeURIComponent(path)}"`
  );
  html = html.replace(
    /href='https?:\/\/(?:www\.)?goldenvibeofficiel\.com(\/[^']*)'/g,
    (_, path) => `href='${PROXY_ENDPOINT}?path=${encodeURIComponent(path)}'`
  );

  // ── 5. Rewrite form actions
  html = html.replace(
    /action="(\/[^"]*)"/g,
    (_, path) => `action="${PROXY_ENDPOINT}?path=${encodeURIComponent(path)}"`
  );

  // ── 6. Inject JS interceptor before </head>
  html = html.replace("</head>", `${JS_INTERCEPTOR}</head>`);

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
        Cookie: (req.headers.cookie as string) || "",
      },
      responseType: "arraybuffer",
      validateStatus: () => true,
      maxRedirects: 5,
      timeout: 20000,
    });

    // Forward safe headers only
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
      // Forward CSS, JS, images, fonts, etc. as-is
      res.status(upstream.status).send(upstream.data);
    }
  } catch (err) {
    res.status(502).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;background:#0d0d1a;color:#ccc;">
      <h2 style="color:#8b5cf6;">Chargement impossible</h2>
      <p>Le shop n'a pas pu être chargé. Ouvre-le directement :</p>
      <a href="${SITE_ORIGIN}" target="_top" style="display:inline-block;margin-top:1rem;padding:.75rem 1.5rem;background:#8b5cf6;color:#fff;border-radius:.75rem;text-decoration:none;">Ouvrir Golden Vibe</a>
    </body></html>`);
  }
});

export default router;
