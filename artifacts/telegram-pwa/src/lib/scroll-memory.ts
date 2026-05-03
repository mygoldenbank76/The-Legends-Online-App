/**
 * Per-conversation scroll-position memory.
 *
 * Telegram-grade UX: when you reopen a conversation, you land at
 * exactly the same scroll position you left it at, with the same
 * messages already in view — not jerked back down to the latest
 * message you'd already read 100 messages ago.
 *
 * Implementation: a module-level LRU map keyed by conversation id.
 * The chat-area saves the current `scrollTop` on every scroll (cheap
 * — one Map.set per scroll event) and on unmount, then on the next
 * mount of the same conversation reads the saved value and restores
 * it inside the same `useLayoutEffect` that would otherwise snap to
 * the bottom — so the restore happens BEFORE first paint, with no
 * visible flash of "scrolled to bottom then jumped".
 *
 * Storage is RAM-only by design. Persisting to localStorage would
 * cost a sync write on every scroll and adds zero value: scroll
 * memory only matters within a session (cold-start opens always
 * land at the bottom, which is the same behaviour as Telegram on
 * a fresh launch).
 *
 * Capacity: 50 conversations is plenty for the heaviest user — the
 * average user opens 5–10 conversations per day; 50 covers a week
 * of unique opens before the LRU starts evicting cold entries.
 */

const MAX_ENTRIES = 50;

type ScrollState = {
  /** Pixel offset from top of the messages container. */
  scrollTop: number;
  /**
   * `scrollHeight` at the moment we saved. Used to detect "the
   * conversation grew while you were away" so we can decide whether
   * to honour the saved offset or fall through to bottom-snap. If
   * the live scrollHeight has grown by less than ~40 px we honour
   * the offset (small layout drift is fine); larger growth means
   * new messages arrived and the conversation should snap to the
   * bottom as usual.
   */
  scrollHeight: number;
};

// Map insertion order doubles as our LRU recency order: every
// `set()` of an existing key replaces the entry at the end of the
// iterator, naturally moving it to the back. Eviction drops the
// front (oldest).
const positions = new Map<number, ScrollState>();

function evictIfNeeded(): void {
  if (positions.size <= MAX_ENTRIES) return;
  const overflow = positions.size - MAX_ENTRIES;
  let dropped = 0;
  for (const key of positions.keys()) {
    positions.delete(key);
    if (++dropped >= overflow) break;
  }
}

/**
 * Save the current scroll position for a conversation. Called on
 * scroll events (throttled by the browser) and on unmount.
 */
export function saveScrollPosition(
  conversationId: number,
  scrollTop: number,
  scrollHeight: number,
): void {
  if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight)) return;
  if (positions.has(conversationId)) positions.delete(conversationId);
  positions.set(conversationId, { scrollTop, scrollHeight });
  evictIfNeeded();
}

/**
 * Read the saved scroll position for a conversation. Returns `null`
 * when nothing is saved (first ever open this session) so the caller
 * can fall through to its default snap-to-bottom behaviour.
 *
 * Marks the entry as recently-used (move-to-back) so a heavy user
 * who keeps revisiting the same 5 conversations never loses their
 * positions to LRU eviction.
 */
export function readScrollPosition(conversationId: number): ScrollState | null {
  const v = positions.get(conversationId);
  if (v === undefined) return null;
  // touch
  positions.delete(conversationId);
  positions.set(conversationId, v);
  return v;
}

/**
 * Drop a saved position. Called when the user explicitly clears
 * the conversation history or when the conversation is deleted, so
 * the next reopen doesn't restore a position that no longer maps
 * to anything in the message list.
 */
export function clearScrollPosition(conversationId: number): void {
  positions.delete(conversationId);
}
