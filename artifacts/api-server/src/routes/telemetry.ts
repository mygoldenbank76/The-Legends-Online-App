import { Router, type IRouter } from "express";

const router: IRouter = Router();

// In-memory aggregation of quota-exceeded events. The APK ships to a
// modest user base and we only need rough hit-rate visibility — no DB
// table required. Counters reset on server restart, which is fine
// because we read them via /api/telemetry/quota-exceeded/stats and
// log them through pino on every event anyway.
const stats = {
  total: 0,
  byContext: {} as Record<string, number>,
  lastEventAt: null as number | null,
  lastMediaCacheCount: null as number | null,
  lastConversationCount: null as number | null,
};

type QuotaExceededBody = {
  context?: string;
  mediaCacheCount?: number;
  conversationCount?: number | null;
  errorName?: string;
  errorMessage?: string;
  ts?: number;
  quota?: number;
  usage?: number;
  userAgent?: string;
};

// Whitelist of context values the SW is allowed to report. Anything
// outside this list is bucketed as "other" so a malicious/malformed
// client can't grow the in-memory map without bound.
const ALLOWED_CONTEXTS = new Set(["media-proxy", "external-media"]);

// POST /telemetry/quota-exceeded — SW reports a cache.put quota miss
router.post("/telemetry/quota-exceeded", (req, res) => {
  const body = (req.body ?? {}) as QuotaExceededBody;
  const rawContext = typeof body.context === "string" ? body.context : "unknown";
  const context = ALLOWED_CONTEXTS.has(rawContext) ? rawContext : "other";

  stats.total += 1;
  stats.byContext[context] = (stats.byContext[context] ?? 0) + 1;
  stats.lastEventAt = Date.now();
  if (typeof body.mediaCacheCount === "number") {
    stats.lastMediaCacheCount = body.mediaCacheCount;
  }
  if (typeof body.conversationCount === "number") {
    stats.lastConversationCount = body.conversationCount;
  }

  req.log.warn(
    {
      telemetry: "sw_quota_exceeded",
      context,
      mediaCacheCount: body.mediaCacheCount,
      conversationCount: body.conversationCount,
      errorName: body.errorName,
      errorMessage: body.errorMessage,
      quota: body.quota,
      usage: body.usage,
      userAgent: body.userAgent,
      clientTs: body.ts,
    },
    "Service worker hit storage QuotaExceededError",
  );

  res.json({ success: true });
});

// GET /telemetry/quota-exceeded/stats — quick aggregate read
router.get("/telemetry/quota-exceeded/stats", (_req, res) => {
  res.json(stats);
});

export default router;
