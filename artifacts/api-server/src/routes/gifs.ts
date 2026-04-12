import { Router } from "express";
import axios from "axios";

const router = Router();

const TENOR_KEY = "LIVDSRZULELA";
const TENOR_BASE = "https://tenor.googleapis.com/v2";
const LIMIT = 24;

interface TenorMediaFormat {
  url: string;
  dims: [number, number];
  size: number;
}

interface TenorResult {
  id: string;
  title: string;
  media_formats: {
    gif?: TenorMediaFormat;
    tinygif?: TenorMediaFormat;
    mediumgif?: TenorMediaFormat;
    nanogif?: TenorMediaFormat;
  };
}

function formatResults(results: TenorResult[]) {
  return results.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.media_formats.gif?.url ?? r.media_formats.mediumgif?.url ?? "",
    preview: r.media_formats.tinygif?.url ?? r.media_formats.nanogif?.url ?? r.media_formats.gif?.url ?? "",
    dims: r.media_formats.gif?.dims ?? r.media_formats.tinygif?.dims ?? [200, 200],
  }));
}

router.get("/gifs/trending", async (_req, res) => {
  try {
    const { data } = await axios.get(`${TENOR_BASE}/featured`, {
      params: { key: TENOR_KEY, limit: LIMIT, media_filter: "gif,tinygif", contentfilter: "medium" },
    });
    res.json({ results: formatResults(data.results ?? []) });
  } catch (err) {
    res.status(500).json({ error: "Tenor API error" });
  }
});

router.get("/gifs/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json({ results: [] });
  try {
    const { data } = await axios.get(`${TENOR_BASE}/search`, {
      params: { key: TENOR_KEY, q, limit: LIMIT, media_filter: "gif,tinygif", contentfilter: "medium" },
    });
    res.json({ results: formatResults(data.results ?? []) });
  } catch (err) {
    res.status(500).json({ error: "Tenor API error" });
  }
});

export default router;
