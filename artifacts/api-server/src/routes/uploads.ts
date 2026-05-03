import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../lib/auth";
import { objectStorageClient } from "../lib/objectStorage";
import { signMediaUrl, verifyMediaToken } from "../lib/mediaSigning";

const router: IRouter = Router();

// ── Multer memory storage (no disk) ────────────────────────────────────────
const memStorage = multer.memoryStorage();

const imageUpload = multer({
  storage: memStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image or video files are allowed"));
    }
  },
});

const audioUpload = multer({
  storage: memStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, _file, cb) => { cb(null, true); },
});

const documentUpload = multer({
  storage: memStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ── Helpers ─────────────────────────────────────────────────────────────────
const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!;
const UPLOAD_PREFIX = "telechat-uploads";

async function uploadToGcs(
  buffer: Buffer,
  originalname: string,
  mimetype: string
): Promise<string> {
  const ext = path.extname(originalname) || ".bin";
  const objectId = `${Date.now()}-${randomUUID()}${ext}`;
  const objectName = `${UPLOAD_PREFIX}/${objectId}`;

  const bucket = objectStorageClient.bucket(BUCKET_ID);
  const file = bucket.file(objectName);

  await file.save(buffer, {
    contentType: mimetype,
    resumable: false,
  });

  return objectId;
}

// ── Upload endpoints ─────────────────────────────────────────────────────────
router.post("/uploads/image", requireAuth, imageUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  try {
    const objectId = await uploadToGcs(req.file.buffer, req.file.originalname, req.file.mimetype);
    // Sign the URL so the uploader can immediately preview their own
    // upload without going through a re-fetch from the messages list.
    res.json({ url: signMediaUrl(`/api/uploads/gcs/${objectId}`) });
  } catch (e) {
    console.error("GCS upload error", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

router.post("/uploads/audio", requireAuth, audioUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  try {
    const objectId = await uploadToGcs(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ url: signMediaUrl(`/api/uploads/gcs/${objectId}`) });
  } catch (e) {
    console.error("GCS upload error", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

router.post("/uploads/document", requireAuth, documentUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  try {
    const objectId = await uploadToGcs(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ url: signMediaUrl(`/api/uploads/gcs/${objectId}`), name: req.file.originalname, size: req.file.size });
  } catch (e) {
    console.error("GCS upload error", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ── Serve from GCS ──────────────────────────────────────────────────────────
//
// SECURITY: signed-URL gate. See lib/mediaSigning.ts. Every request must
// carry a valid `?e=…&s=…` token. Without this, the route was completely
// public — anyone with a leaked URL could download any photo, video,
// audio or document sent in any private DM. The token has a 7-day TTL
// and is rebuilt on every API response, so an exfiltrated URL stops
// working quickly.
router.get("/uploads/gcs/:objectId", async (req, res): Promise<void> => {
  const objectId = req.params.objectId;
  const { e, s } = req.query as { e?: string; s?: string };
  if (!verifyMediaToken(objectId, e, s)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const objectName = `${UPLOAD_PREFIX}/${objectId}`;
  try {
    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) { res.status(404).json({ error: "File not found" }); return; }

    const [metadata] = await file.getMetadata();
    const contentType = (metadata.contentType as string) || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    // Per-token URLs are stable for the token's lifetime — long max-age
    // is safe because each unique signed URL is its own cache key. When
    // the token rotates the next signed URL is a fresh cache entry.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));

    file.createReadStream().pipe(res);
  } catch (e) {
    console.error("GCS serve error", e);
    res.status(500).json({ error: "Failed to serve file" });
  }
});

export default router;
