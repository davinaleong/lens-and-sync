import { requireAuth, type AuthenticatedRequest } from "@lens-and-sync/shared-auth";
import type { ErrorRequestHandler } from "express";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { config } from "../config.js";
import { classifyDish, type DishClassification } from "../edge-cases/index.js";
import { checkModeration } from "../moderation/index.js";
import { redis } from "../session/redis-client.js";
import { assessUpload, type UploadAssessment } from "../upload/index.js";
import { visionClient } from "../vision/client.js";
import { analyzeImage } from "../vision/index.js";

export const uploadRouter: Router = Router();

const maxSizeBytes = config.MAX_UPLOAD_SIZE_MB * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxSizeBytes, files: 1 },
});

// Per-user, distinct from the global per-IP limiter in index.ts - keyed on
// the verified userId (never an IP, which is a poor proxy for "one user" on
// shared/carrier-NAT cellular networks) so it runs *after* requireAuth.
const uploadRateLimiter = rateLimit({
  windowMs: config.UPLOAD_RATE_LIMIT_WINDOW_MS,
  max: config.UPLOAD_RATE_LIMIT_MAX_UPLOADS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: AuthenticatedRequest) => req.userId as string,
  // Match this route's own JSON error shape instead of express-rate-limit's
  // default plain-text body - one consistent error schema across every
  // rejection path on this route (`02-milestones-checklist.md` #11).
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: "rate-limited", message: "Too many uploads. Please wait before trying again." },
    });
  },
  store: new RedisStore({
    prefix: "dishlens:upload-rl:",
    sendCommand: (...args: string[]) =>
      redis.call(args[0] as string, ...args.slice(1)) as Promise<RedisReply>,
  }),
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

const DISH_REJECTION_RESPONSES: Record<Exclude<DishClassification, { ok: true }>["reason"], { status: number; message: string }> = {
  "non-dish": { status: 422, message: "Uploaded image does not appear to contain a recognizable dish." },
  "low-confidence": { status: 422, message: "Could not confidently identify a dish in this image. Please try a clearer photo." },
  "multi-dish": { status: 422, message: "Multiple dishes were detected. Please upload a photo of a single dish." },
};

uploadRouter.post(
  "/",
  requireAuth(config.JWT_ACCESS_SECRET),
  uploadRateLimiter,
  upload.single("image"),
  async (req, res, next) => {
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

      const analysis = await analyzeImage(visionClient, req.file.buffer);

      const moderation = checkModeration(analysis.safeSearch);
      if (!moderation.ok) {
        res.status(422).json({
          error: {
            code: moderation.reason,
            message: "Uploaded image was flagged by content moderation and cannot be processed.",
          },
        });
        return;
      }

      const classification = classifyDish(analysis.labels, {
        dishConfidenceThreshold: config.DISH_CONFIDENCE_THRESHOLD,
        foodEvidenceThreshold: config.FOOD_EVIDENCE_THRESHOLD,
      });

      if (!classification.ok) {
        const response = DISH_REJECTION_RESPONSES[classification.reason];
        res.status(response.status).json({ error: { code: classification.reason, message: response.message } });
        return;
      }

      // TODO: recipe generation, nutrition lookup, Redis session creation -
      // still separate cycles. A confirmed dish is acknowledged for now so
      // the pipeline up to this point can be exercised end-to-end.
      res.status(200).json({
        status: "accepted",
        dishName: classification.dishName,
        mimeType: assessment.mimeType,
        sizeBytes: assessment.sizeBytes,
        width: assessment.width,
        height: assessment.height,
      });
    } catch (err) {
      next(err);
    }
  },
);

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

  // Log server-side only - never leak internals (stack trace, Vision/Prisma
  // error text) into the client response (`01-security-checklist.md` §11).
  console.error("Unhandled error in /upload:", err);
  res.status(500).json({ error: { code: "internal-error", message: "An unexpected error occurred." } });
};

uploadRouter.use(handleUploadError);
