import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../lib/auth";
import { objectStorageClient } from "../lib/objectStorage";

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
    res.json({ url: `/api/uploads/gcs/${objectId}` });
  } catch (e) {
    console.error("GCS upload error", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

router.post("/uploads/audio", requireAuth, audioUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  try {
    const objectId = await uploadToGcs(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ url: `/api/uploads/gcs/${objectId}` });
  } catch (e) {
    console.error("GCS upload error", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

router.post("/uploads/document", requireAuth, documentUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  try {
    const objectId = await uploadToGcs(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ url: `/api/uploads/gcs/${objectId}`, name: req.file.originalname, size: req.file.size });
  } catch (e) {
    console.error("GCS upload error", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ── Serve from GCS ──────────────────────────────────────────────────────────
router.get("/uploads/gcs/:objectId", async (req, res): Promise<void> => {
  const objectId = req.params.objectId;
  const objectName = `${UPLOAD_PREFIX}/${objectId}`;
  try {
    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) { res.status(404).json({ error: "File not found" }); return; }

    const [metadata] = await file.getMetadata();
    const contentType = (metadata.contentType as string) || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));

    file.createReadStream().pipe(res);
  } catch (e) {
    console.error("GCS serve error", e);
    res.status(500).json({ error: "Failed to serve file" });
  }
});

export default router;
