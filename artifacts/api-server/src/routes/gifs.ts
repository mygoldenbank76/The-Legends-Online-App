import { Router } from "express";
import axios from "axios";

const router = Router();

const TENOR_KEY = "LIVDSRZULELA";
const TENOR_V1 = "https://api.tenor.com/v1";
const LIMIT = 24;

interface TenorV1Media {
  gif?: { url: string; dims: number[] };
  tinygif?: { url: string; dims: number[] };
  nanogif?: { url: string; dims: number[] };
  mediumgif?: { url: string; dims: number[] };
}

interface TenorV1Result {
  id: string;
  title: string;
  content_description: string;
  media: TenorV1Media[];
}

function formatResults(results: TenorV1Result[]) {
  return results.map((r) => {
    const media: TenorV1Media = r.media?.[0] ?? {};
    return {
      id: r.id,
      title: r.title || r.content_description || "GIF",
      url: media.gif?.url ?? media.mediumgif?.url ?? "",
      preview: media.tinygif?.url ?? media.nanogif?.url ?? media.gif?.url ?? "",
      dims: (media.gif?.dims ?? media.tinygif?.dims ?? [200, 150]) as [number, number],
    };
  });
}

router.get("/gifs/trending", async (_req, res) => {
  try {
    const { data } = await axios.get(`${TENOR_V1}/trending`, {
      params: { key: TENOR_KEY, limit: LIMIT, media_filter: "minimal", contentfilter: "medium", locale: "fr_FR" },
    });
    res.json({ results: formatResults(data.results ?? []) });
  } catch (err: any) {
    console.error("[gifs/trending]", err?.message);
    res.status(500).json({ error: "Tenor API error" });
  }
});

router.get("/gifs/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json({ results: [] });
  try {
    const { data } = await axios.get(`${TENOR_V1}/search`, {
      params: { key: TENOR_KEY, q, limit: LIMIT, media_filter: "minimal", contentfilter: "medium", locale: "fr_FR" },
    });
    res.json({ results: formatResults(data.results ?? []) });
  } catch (err: any) {
    console.error("[gifs/search]", err?.message);
    res.status(500).json({ error: "Tenor API error" });
  }
});

export default router;
