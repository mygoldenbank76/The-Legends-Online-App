/**
 * Persistent iframe pool — iframes are NEVER destroyed once created.
 * When a component unmounts, the iframe moves to a hidden off-screen container.
 * When the same embed URL mounts again, the already-loaded iframe is reused instantly.
 *
 * This is how Telegram handles embedded players natively.
 */

interface PoolEntry {
  iframe: HTMLIFrameElement;
  loaded: boolean;
  onLoadCallbacks: (() => void)[];
}

const pool = new Map<string, PoolEntry>();
let hiddenContainer: HTMLDivElement | null = null;

function ensureHiddenContainer(): HTMLDivElement {
  if (!hiddenContainer || !document.body.contains(hiddenContainer)) {
    hiddenContainer = document.createElement('div');
    hiddenContainer.setAttribute('aria-hidden', 'true');
    hiddenContainer.style.cssText =
      'position:fixed;top:-10000px;left:-10000px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
    document.body.appendChild(hiddenContainer);
  }
  return hiddenContainer;
}

/** Create or retrieve an iframe for the given embed URL */
function getOrCreate(embedUrl: string, attrs: { allow: string; height: string }): PoolEntry {
  if (pool.has(embedUrl)) return pool.get(embedUrl)!;

  const iframe = document.createElement('iframe');
  iframe.src = embedUrl;
  iframe.allow = attrs.allow;
  iframe.height = attrs.height;
  iframe.style.cssText = 'width:100%;border:none;display:block;';
  iframe.setAttribute('loading', 'eager');

  const entry: PoolEntry = { iframe, loaded: false, onLoadCallbacks: [] };

  iframe.addEventListener('load', () => {
    entry.loaded = true;
    entry.onLoadCallbacks.forEach(cb => cb());
    entry.onLoadCallbacks = [];
  }, { once: true });

  // Start loading immediately in the hidden container
  ensureHiddenContainer().appendChild(iframe);
  pool.set(embedUrl, entry);

  return entry;
}

/**
 * Mount an iframe into a visible container.
 * Returns a cleanup function that moves the iframe back to the hidden pool.
 *
 * @param embedUrl   The embed src URL (used as cache key)
 * @param container  The DOM node to mount into
 * @param attrs      iframe attributes
 * @param onReady    Called immediately if already loaded, or when load fires
 */
export function mountIframe(
  embedUrl: string,
  container: HTMLElement,
  attrs: { allow: string; height: string },
  onReady: () => void,
): () => void {
  const entry = getOrCreate(embedUrl, attrs);

  // Move iframe into the visible container
  container.appendChild(entry.iframe);

  // Ensure iframe fills its container
  entry.iframe.style.width = '100%';
  entry.iframe.height = attrs.height;

  if (entry.loaded) {
    // Already loaded — notify immediately (next microtask to avoid setState-during-render)
    Promise.resolve().then(onReady);
  } else {
    entry.onLoadCallbacks.push(onReady);
  }

  // Return cleanup: send iframe back to hidden pool
  return () => {
    if (entry.iframe.parentElement === container) {
      ensureHiddenContainer().appendChild(entry.iframe);
    }
  };
}

/** Pre-warm: start loading an iframe NOW so it's ready when needed */
export function prewarmIframe(embedUrl: string, attrs: { allow: string; height: string }): void {
  getOrCreate(embedUrl, attrs);
}

/** How many iframes are currently pooled */
export function poolSize(): number {
  return pool.size;
}
