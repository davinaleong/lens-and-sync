import type { ErrorRequestHandler } from "express";
import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { assessUpload, type UploadAssessment } from "../upload/index.js";

export const uploadRouter: Router = Router();

const maxSizeBytes = config.MAX_UPLOAD_SIZE_MB * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxSizeBytes, files: 1 },
});

// Fixed, non-leaky messages per rejection reason - never echo internal
// details (blur variance value, detected mime type) back to the client.
const REJECTION_RESPONSES: Record<Exclude<UploadAssessment, { ok: true }>["reason"], { status: number; message: string }> = {
  "too-large": { status: 413, message: "Uploaded file exceeds the maximum allowed size." },
  "unrecognized-format": { status: 415, message: "Uploaded file is not a recognized image format." },
  "unsupported-format": { status: 415, message: "Uploaded image format is not supported." },
  "unreadable-image": { status: 422, message: "Uploaded image could not be processed." },
  "dimensions-too-large": { status: 413, message: "Uploaded image exceeds the maximum allowed dimensions." },
  "too-blurry": { status: 422, message: "Uploaded image is too blurry to process. Please retake the photo." },
};

uploadRouter.post("/", upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: { code: "no-file", message: "No image file was provided." } });
      return;
    }

    const assessment = await assessUpload(req.file.buffer, {
      maxSizeBytes,
      maxDimensionPx: config.MAX_IMAGE_DIMENSION_PX,
      blurVarianceThreshold: config.BLUR_VARIANCE_THRESHOLD,
    });

    if (!assessment.ok) {
      const response = REJECTION_RESPONSES[assessment.reason];
      res.status(response.status).json({ error: { code: assessment.reason, message: response.message } });
      return;
    }

    // TODO: Vision dish detection + edge-case rejection, recipe/nutrition
    // generation, Redis session creation - all need live credentials that
    // don't exist yet. A validated image is acknowledged for now so the
    // pipeline up to this point can be exercised end-to-end.
    res.status(200).json({
      status: "accepted",
      mimeType: assessment.mimeType,
      sizeBytes: assessment.sizeBytes,
      width: assessment.width,
      height: assessment.height,
    });
  } catch (err) {
    next(err);
  }
});

const handleUploadError: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: { code: "too-large", message: "Uploaded file exceeds the maximum allowed size." } });
      return;
    }
    res.status(400).json({ error: { code: "invalid-upload", message: "Uploaded file could not be processed." } });
    return;
  }

  res.status(500).json({ error: { code: "internal-error", message: "An unexpected error occurred." } });
};

uploadRouter.use(handleUploadError);
