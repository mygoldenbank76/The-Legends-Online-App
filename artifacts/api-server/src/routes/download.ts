import { Router, type IRouter, type Request, type Response } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// /api/download/apk — proxy the latest signed APK from GitHub Releases through
// our own domain so end users never see github.com URLs in their download
// notification or browser. The actual file lives on GitHub (free CDN, no
// bandwidth cost for us) but the download is served from
// https://thelegendsonline.social/api/download/apk so it looks 100% like a
// first-party install.
//
// Resolution:
//   1. Fetch the `native-latest` release metadata from the GitHub API.
//   2. Pick the .apk asset (preferring the canonical name).
//   3. Stream the binary back to the client with the right Content-Type and
//      a `Content-Disposition: attachment; filename="The Legends Online.apk"`
//      so Android opens its native install dialog.
// ─────────────────────────────────────────────────────────────────────────────

const router: IRouter = Router();

const GITHUB_REPO = "mygoldenbank76/The-Legends-Online-App";
const RELEASE_TAG = "native-latest";
const APK_ASSET_CANDIDATES = [
  "The Legends Online.apk",
  "The.Legends.Online.apk",
  "The_Legends_Online.apk",
];
const FILENAME = "The Legends Online.apk";
// Cache the resolved asset URL for 5 minutes to avoid hitting the GitHub
// API rate limit on every download click.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { url: string; size: number | null; build: number | null; at: number } | null = null;

async function resolveApkAsset(): Promise<{ url: string; size: number | null; build: number | null } | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { url: cached.url, size: cached.size, build: cached.build };
  }
  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${RELEASE_TAG}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "TheLegendsOnline-APK-Proxy",
        },
      },
    );
    if (!r.ok) return null;
    const data = (await r.json()) as {
      body?: string;
      name?: string;
      assets?: Array<{ name: string; browser_download_url: string; size: number }>;
    };
    const assets = data.assets ?? [];
    const apk =
      APK_ASSET_CANDIDATES.map((n) => assets.find((a) => a.name === n)).find(Boolean) ||
      assets.find((a) => /\.apk$/i.test(a.name) && a.name !== "legends.apk");
    if (!apk) return null;
    // The GitHub Actions workflow embeds "Build #N" in the release body
    // (and also bumps the APK versionCode to N). We parse that out so the
    // client can compare it against Capacitor's installed app build number
    // and only show "update available" when there's actually a new build.
    let build: number | null = null;
    const m = (data.body || "").match(/Build\s*#(\d+)/i) ||
              (data.name || "").match(/Build\s*#?(\d+)/i);
    if (m) build = parseInt(m[1], 10);
    cached = { url: apk.browser_download_url, size: apk.size, build, at: Date.now() };
    return { url: apk.browser_download_url, size: apk.size, build };
  } catch {
    return null;
  }
}

// HEAD: lets the install page query the size without triggering a download.
router.head("/download/apk", async (_req: Request, res: Response) => {
  const asset = await resolveApkAsset();
  if (!asset) {
    res.status(503).end();
    return;
  }
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  if (asset.size) res.setHeader("Content-Length", String(asset.size));
  res.setHeader("Content-Disposition", `attachment; filename="${FILENAME}"`);
  res.status(200).end();
});

// GET: stream the APK bytes from GitHub through our domain.
router.get("/download/apk", async (req: Request, res: Response) => {
  const asset = await resolveApkAsset();
  if (!asset) {
    res.status(503).json({ error: "APK not available yet, please retry shortly." });
    return;
  }

  try {
    const upstream = await fetch(asset.url, {
      headers: { "User-Agent": "TheLegendsOnline-APK-Proxy" },
      redirect: "follow",
    });
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: `Upstream ${upstream.status}` });
      return;
    }

    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", `attachment; filename="${FILENAME}"`);
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    // Light cache so a quick double-tap doesn't re-fetch from GitHub but
    // a real new release within minutes is still picked up.
    res.setHeader("Cache-Control", "public, max-age=300");

    // Stream the body chunk-by-chunk so we never hold the whole APK in RAM.
    const reader = upstream.body.getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      // res.write returns false when the internal buffer is full — wait for
      // 'drain' to back-pressure correctly.
      const ok = res.write(value);
      if (!ok) {
        await new Promise<void>((resolve) => res.once("drain", () => resolve()));
      }
      return pump();
    };

    req.on("close", () => {
      reader.cancel().catch(() => {});
    });

    await pump();
  } catch (err) {
    req.log?.error({ err }, "APK proxy stream failed");
    if (!res.headersSent) {
      res.status(502).json({ error: "Stream failed" });
    } else {
      res.end();
    }
  }
});

// JSON metadata endpoint — used by the install page and the in-app update
// checker to display "X.X Mo" without downloading the file.
router.get("/download/apk/info", async (_req: Request, res: Response) => {
  const asset = await resolveApkAsset();
  if (!asset) {
    res.status(503).json({ available: false });
    return;
  }
  res.json({
    available: true,
    sizeMb: asset.size ? asset.size / (1024 * 1024) : null,
    build: asset.build,
    url: "/api/download/apk",
    filename: FILENAME,
  });
});

export default router;
