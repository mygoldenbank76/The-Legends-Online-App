import { Router, Request, Response } from "express";
import axios from "axios";

const router = Router();

const SITE_ORIGIN = "https://www.goldenvibeofficiel.com";

const BLOCKED_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-type-options",
  "transfer-encoding",
  "connection",
  "content-encoding",
]);

/**
 * Get the public-facing origin of the app.
 * Priority: Referer origin → x-forwarded headers → host header.
 * The Referer is the most reliable because it contains the URL the user
 * actually sees in the browser.
 */
function getPublicOrigin(req: Request): string {
  const referer = (req.headers["referer"] || req.headers["referrer"] || "") as string;
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {}
  }
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
  return `${proto}://${host}`;
}

/**
 * JS injected into every proxied HTML page.
 * Uses window.location.origin (reliable client-side) for the proxy base URL.
 */
const JS_INTERCEPTOR = `
<script data-proxy-interceptor="1">
(function() {
  // Compute proxy base from the iframe's own origin — always correct.
  var PROXY_BASE = window.location.origin + '/api/shop-proxy?path=';
  var SITE = ${JSON.stringify(SITE_ORIGIN)};
  var ORIGINS = ['www.goldenvibeofficiel.com', 'goldenvibeofficiel.com'];

  function toProxyUrl(href) {
    if (!href) return null;
    var s = String(href).trim();
    if (!s || s.startsWith('#') || s.startsWith('javascript:') ||
        s.startsWith('mailto:') || s.startsWith('tel:') ||
        s.startsWith('data:') || s.startsWith('blob:')) return null;
    // Already a proxy URL
    if (s.indexOf('/api/shop-proxy') !== -1) return null;
    // Absolute path e.g. /collections/all
    if (s.startsWith('/') && !s.startsWith('//')) {
      return PROXY_BASE + encodeURIComponent(s);
    }
    // Full URL to the shop
    try {
      var u = new URL(s);
      if (ORIGINS.indexOf(u.hostname) !== -1) {
        return PROXY_BASE + encodeURIComponent(u.pathname + u.search + u.hash);
      }
    } catch (e) {}
    return null;
  }

  // Resolve a URL relative to the shop origin (for fetch/XHR interception)
  function shopProxyUrl(url) {
    if (!url) return null;
    try {
      var parsed = new URL(String(url), SITE + '/');
      if (ORIGINS.indexOf(parsed.hostname) !== -1) {
        return PROXY_BASE + encodeURIComponent(parsed.pathname + parsed.search + parsed.hash);
      }
    } catch(e) {}
    return null;
  }

  // ── 1. Override history.pushState / replaceState ────────────────────
  var _push = history.pushState.bind(history);
  var _replace = history.replaceState.bind(history);

  history.pushState = function(state, title, url) {
    if (url) {
      var p = toProxyUrl(String(url));
      if (p) { window.location.href = p; return; }
    }
    return _push(state, title, url);
  };
  history.replaceState = function(state, title, url) {
    if (url) {
      var p = toProxyUrl(String(url));
      if (p) { window.location.replace(p); return; }
    }
    return _replace(state, title, url);
  };

  // ── 2. Override window.fetch ────────────────────────────────────────
  if (window.fetch) {
    var _fetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      try {
        var url = (typeof input === 'string') ? input
          : (input && input.url) ? input.url : String(input);
        var p = shopProxyUrl(url);
        if (p) {
          input = (typeof input === 'string') ? p : new Request(p, init);
          if (typeof input !== 'string') init = undefined;
        }
      } catch(e) {}
      return _fetch(input, init);
    };
  }

  // ── 3. Override XMLHttpRequest ──────────────────────────────────────
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
    try {
      var p = shopProxyUrl(String(url));
      if (p) url = p;
    } catch(e) {}
    return _xhrOpen.call(this, method, url,
      async === undefined ? true : async, user, pass);
  };

  // ── 4. Rewrite existing <a> and <form> elements ─────────────────────
  function rewriteEl(el) {
    if (!el || !el.tagName) return;
    var tag = el.tagName.toUpperCase();
    if (tag === 'A') {
      var href = el.getAttribute('href');
      var p = toProxyUrl(href);
      if (p) { el.setAttribute('href', p); el.setAttribute('data-proxied', '1'); }
    }
    if (tag === 'FORM') {
      var action = el.getAttribute('action');
      var pa = toProxyUrl(action);
      if (pa) { el.setAttribute('action', pa); el.setAttribute('data-proxied', '1'); }
    }
  }
  function rewriteAll(root) {
    (root || document).querySelectorAll('a[href]:not([data-proxied])').forEach(rewriteEl);
    (root || document).querySelectorAll('form[action]:not([data-proxied])').forEach(rewriteEl);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { rewriteAll(); });
  } else {
    rewriteAll();
  }

  // Watch for dynamically added elements
  new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      m.addedNodes.forEach(function(n) {
        if (n.nodeType !== 1) return;
        rewriteEl(n);
        if (n.querySelectorAll) {
          n.querySelectorAll('a[href]:not([data-proxied]), form[action]:not([data-proxied])').forEach(rewriteEl);
        }
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ── 5. Click capture — final fallback ──────────────────────────────
  document.addEventListener('click', function(e) {
    var el = e.target && typeof e.target.closest === 'function' && e.target.closest('a');
    if (!el) return;
    var href = el.getAttribute('href') || '';
    if (href.indexOf('/api/shop-proxy') !== -1) return; // already proxied
    var p = toProxyUrl(href);
    if (p) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = p;
    }
  }, true);

})();
</script>`;

function rewriteHtml(html: string, publicOrigin: string): string {
  const proxyBase = `${publicOrigin}/api/shop-proxy?path=`;

  // ── 1. Strip existing <base> tags
  html = html.replace(/<base[^>]*>/gi, "");

  // ── 2. Server-side: rewrite href="/path" on <a> tags → absolute proxy URL
  //    Use absolute URLs so the <base> tag we inject doesn't affect them.
  html = html.replace(
    /(<a\s[^>]*?)href="(\/(?!\/)[^"]*?)"/gi,
    (match, pre, path) => `${pre}href="${proxyBase}${encodeURIComponent(path)}"`
  );
  html = html.replace(
    /(<a\s[^>]*?)href='(\/(?!\/)[^']*?)'/gi,
    (match, pre, path) => `${pre}href='${proxyBase}${encodeURIComponent(path)}'`
  );

  // ── 3. Rewrite full shop URLs in <a href>
  html = html.replace(
    /(<a\s[^>]*?)href="https?:\/\/(?:www\.)?goldenvibeofficiel\.com(\/[^"]*)"/gi,
    (match, pre, path) => `${pre}href="${proxyBase}${encodeURIComponent(path)}"`
  );

  // ── 4. Rewrite form actions
  html = html.replace(
    /action="(\/[^"]*)"/g,
    (_, path) => `action="${proxyBase}${encodeURIComponent(path)}"`
  );

  // ── 5. Add base tag for static resources AFTER href rewriting
  //    This ensures images, CSS, fonts resolve to goldenvibeofficiel.com
  const baseTag = `<base href="${SITE_ORIGIN}/">`;
  html = html.replace(/<head>/i, `<head>${baseTag}`);
  if (!html.includes(SITE_ORIGIN) && !html.includes('<base')) {
    html = html.replace(/<head\b[^>]*>/i, (m) => `${m}${baseTag}`);
  }

  // ── 6. Inject JS interceptor before </head>
  if (html.includes("</head>")) {
    html = html.replace("</head>", `${JS_INTERCEPTOR}</head>`);
  } else if (html.includes("</body>")) {
    html = html.replace("</body>", `${JS_INTERCEPTOR}</body>`);
  } else {
    html += JS_INTERCEPTOR;
  }

  return html;
}

async function proxyRequest(req: Request, res: Response) {
  const publicOrigin = getPublicOrigin(req);
  const rawPath = (req.query.path as string) || "/";
  const safePath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const targetUrl = `${SITE_ORIGIN}${safePath}`;

  const forwardHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity",
    Referer: SITE_ORIGIN,
    Origin: SITE_ORIGIN,
  };

  if (req.headers.cookie) {
    forwardHeaders["Cookie"] = req.headers.cookie as string;
  }
  if (req.headers["content-type"]) {
    forwardHeaders["Content-Type"] = req.headers["content-type"] as string;
  }

  try {
    const upstream = await axios({
      method: req.method,
      url: targetUrl,
      headers: forwardHeaders,
      data: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      responseType: "arraybuffer",
      validateStatus: () => true,
      maxRedirects: 5,
      timeout: 20000,
    });

    Object.entries(upstream.headers).forEach(([key, value]) => {
      if (!BLOCKED_HEADERS.has(key.toLowerCase()) && value) {
        res.setHeader(key, value as string | string[]);
      }
    });

    const contentType = (upstream.headers["content-type"] as string) || "text/html";

    if (contentType.includes("text/html")) {
      const html = rewriteHtml(upstream.data.toString("utf-8"), publicOrigin);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(upstream.status).send(html);
    } else {
      res.status(upstream.status).send(upstream.data);
    }
  } catch (err) {
    res.status(502).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;background:#0d0d1a;color:#ccc;">
      <h2 style="color:#8b5cf6;">Chargement impossible</h2>
      <p>Le shop n'a pas pu être chargé.</p>
      <a href="${SITE_ORIGIN}" target="_top" style="display:inline-block;margin-top:1rem;padding:.75rem 1.5rem;background:#8b5cf6;color:#fff;border-radius:.75rem;text-decoration:none;">Ouvrir Golden Vibe</a>
    </body></html>`);
  }
}

router.get("/shop-proxy", proxyRequest);
router.post("/shop-proxy", proxyRequest);

export default router;
