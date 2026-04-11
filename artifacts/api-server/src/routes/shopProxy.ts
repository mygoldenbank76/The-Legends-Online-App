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
  "content-encoding",
]);

// Comprehensive JS interceptor injected into every proxied HTML page
const JS_INTERCEPTOR = `
<script data-proxy-interceptor="1">
(function() {
  var PROXY = '${PROXY_ENDPOINT}?path=';
  var SITE = '${SITE_ORIGIN}';
  var ORIGINS = ['www.goldenvibeofficiel.com', 'goldenvibeofficiel.com'];

  function toProxyHref(href) {
    if (!href) return null;
    var s = String(href).trim();
    if (!s || s.startsWith('#') || s.startsWith('javascript:') ||
        s.startsWith('mailto:') || s.startsWith('tel:') ||
        s.startsWith('data:') || s.startsWith('blob:')) return null;
    // Absolute path e.g. /collections/all
    if (s.startsWith('/') && !s.startsWith('//')) {
      return PROXY + encodeURIComponent(s);
    }
    // Full URL to the shop
    try {
      var u = new URL(s);
      if (ORIGINS.indexOf(u.hostname) !== -1) {
        return PROXY + encodeURIComponent(u.pathname + u.search + u.hash);
      }
    } catch (e) {}
    return null;
  }

  // Resolve a possibly-relative URL against the shop origin
  function resolveAgainstShop(url) {
    try {
      var parsed = new URL(String(url), SITE + '/');
      return parsed.href;
    } catch(e) { return null; }
  }

  // ── 1. Override history.pushState / replaceState ────────────────────────
  // Shopify SPA themes call pushState to navigate without a full page load.
  // We force a real navigation through the proxy instead.
  var _push = history.pushState.bind(history);
  var _replace = history.replaceState.bind(history);

  history.pushState = function(state, title, url) {
    if (url) {
      var p = toProxyHref(String(url));
      if (p) { window.location.href = p; return; }
    }
    return _push(state, title, url);
  };

  history.replaceState = function(state, title, url) {
    if (url) {
      var p = toProxyHref(String(url));
      if (p) { window.location.replace(p); return; }
    }
    return _replace(state, title, url);
  };

  // ── 2. Override window.fetch ────────────────────────────────────────────
  // Shopify JS uses fetch('/sections/...') and fetch('/cart/...') etc.
  // We rewrite goldenvibeofficiel.com paths to go through the proxy.
  if (window.fetch) {
    var _fetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      try {
        var url = (typeof input === 'string') ? input
          : (input && input.url) ? input.url : String(input);
        var resolved = resolveAgainstShop(url);
        if (resolved) {
          var parsed = new URL(resolved);
          if (ORIGINS.indexOf(parsed.hostname) !== -1) {
            var proxyUrl = PROXY + encodeURIComponent(parsed.pathname + parsed.search + parsed.hash);
            if (typeof input === 'string') {
              input = proxyUrl;
            } else {
              input = new Request(proxyUrl, input instanceof Request ? input : init);
              init = undefined;
            }
          }
        }
      } catch(e) {}
      return _fetch(input, init);
    };
  }

  // ── 3. Override XMLHttpRequest ──────────────────────────────────────────
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
    try {
      var resolved = resolveAgainstShop(String(url));
      if (resolved) {
        var parsed = new URL(resolved);
        if (ORIGINS.indexOf(parsed.hostname) !== -1) {
          url = PROXY + encodeURIComponent(parsed.pathname + parsed.search + parsed.hash);
        }
      }
    } catch(e) {}
    return _xhrOpen.call(this, method, url,
      async === undefined ? true : async, user, pass);
  };

  // ── 4. Rewrite static link/form elements ────────────────────────────────
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { rewriteAll(); });
  } else {
    rewriteAll();
  }

  // Watch for dynamically added links (Shopify lazy-renders menus)
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

  // ── 5. Click interceptor — final fallback ───────────────────────────────
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

  // ── 6. Intercept location.assign ────────────────────────────────────────
  var _assign = window.location.assign.bind(window.location);
  try {
    window.location.assign = function(url) {
      var p = toProxyHref(String(url));
      return p ? _assign(p) : _assign(url);
    };
  } catch(e) {}
})();
</script>`;

function rewriteHtml(html: string): string {
  // ── 1. Strip existing <base> tags
  html = html.replace(/<base[^>]*>/gi, "");

  // ── 2. Add our base tag for static resources (images, fonts, CSS via CDN)
  const baseTag = `<base href="${SITE_ORIGIN}/">`;
  html = html.includes("<head>")
    ? html.replace("<head>", `<head>${baseTag}`)
    : html.replace(/<head/i, `<head`).replace("<head", `<head`);
  // simpler approach:
  if (!html.includes(baseTag)) {
    html = html.replace(/<head>/i, `<head>${baseTag}`);
    html = html.replace(/<head /i, `<head>${baseTag}<head `);
  }

  // ── 3. Rewrite absolute-path href="/..." → proxy (double quotes)
  html = html.replace(
    /href="(\/(?!\/)[^"#?]*(?:[?#][^"]*)?)"/g,
    (_, path) => `href="${PROXY_ENDPOINT}?path=${encodeURIComponent(path)}"`
  );
  // Single quotes
  html = html.replace(
    /href='(\/(?!\/)[^'#?]*(?:[?#][^']*)?)'/g,
    (_, path) => `href='${PROXY_ENDPOINT}?path=${encodeURIComponent(path)}'`
  );

  // ── 4. Rewrite full-URL hrefs to the shop
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
  html = html.replace(
    /action='(\/[^']*)'/g,
    (_, path) => `action='${PROXY_ENDPOINT}?path=${encodeURIComponent(path)}'`
  );

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

async function proxyRequest(req: any, res: any) {
  const rawPath = (req.query.path as string) || "/";
  const safePath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const targetUrl = `${SITE_ORIGIN}${safePath}`;

  // Forward cookies to preserve sessions (cart, login, etc.)
  const forwardHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity",
    Referer: SITE_ORIGIN,
  };

  if (req.headers.cookie) forwardHeaders["Cookie"] = req.headers.cookie;
  if (req.headers["content-type"]) forwardHeaders["Content-Type"] = req.headers["content-type"];

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

    // Forward Set-Cookie headers to preserve sessions
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
