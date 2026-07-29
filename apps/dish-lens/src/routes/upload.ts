import { requireAuth, type AuthenticatedRequest } from "@lens-and-sync/shared-auth";
import { logSecurityEvent } from "@lens-and-sync/shared-logger";
import type { ErrorRequestHandler, NextFunction, Response } from "express";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { config } from "../config.js";
import { classifyDish, type DishClassification } from "../edge-cases/index.js";
import { logger } from "../logger.js";
import { checkModeration } from "../moderation/index.js";
import { lookupNutrition } from "../nutrition/index.js";
import { normalizeImage } from "../preprocessing/image-normalize.js";
import { anthropicClient } from "../recipe/client.js";
import { generateRecipe } from "../recipe/index.js";
import { redis } from "../session/redis-client.js";
import { createSessionStore } from "../session/session-store.js";
import { getSignedReadUrl, uploadNormalizedImage } from "../storage/index.js";
import { uploadsBucket } from "../storage/gcs-client.js";
import { assessUpload, type UploadAssessment } from "../upload/index.js";
import { visionClient } from "../vision/client.js";
import { analyzeImage } from "../vision/index.js";

const ROUTE = "POST /upload";

const sessionStore = createSessionStore(redis, config.REDIS_SESSION_TTL_SECONDS);

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
  handler: (req: AuthenticatedRequest, res) => {
    logSecurityEvent(logger, { type: "rate-limited", route: ROUTE, reason: "upload-rate-limit-exceeded", statusCode: 429, userId: req.userId });
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

/**
 * Rejects anything that isn't a multipart request before multer parses
 * it - a strict Content-Type check distinct from `validateUpload`'s
 * magic-byte sniffing of the *file itself* (`01-security-checklist.md`
 * §3's "validate Content-Type strictly; reject unexpected MIME types").
 * Runs after auth/rate-limiting so an unauthenticated or rate-limited
 * request is rejected first without this check needing to run at all.
 */
function requireMultipartContentType(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const contentType = req.headers["content-type"];
  if (!contentType?.startsWith("multipart/form-data")) {
    logSecurityEvent(logger, { type: "upload-rejected", route: ROUTE, reason: "invalid-content-type", statusCode: 415, userId: req.userId });
    res.status(415).json({ error: { code: "invalid-content-type", message: "Expected a multipart/form-data request." } });
    return;
  }
  next();
}

uploadRouter.post(
  "/",
  requireAuth(config.JWT_ACCESS_SECRET, logger),
  uploadRateLimiter,
  requireMultipartContentType,
  upload.single("image"),
  async (req: AuthenticatedRequest, res, next) => {
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
        logSecurityEvent(logger, { type: "upload-rejected", route: ROUTE, reason: assessment.reason, statusCode: response.status, userId: req.userId });
        res.status(response.status).json({ error: { code: assessment.reason, message: response.message } });
        return;
      }

      const analysis = await analyzeImage(visionClient, req.file.buffer);

      const moderation = checkModeration(analysis.safeSearch);
      if (!moderation.ok) {
        logSecurityEvent(logger, { type: "moderation-blocked", route: ROUTE, reason: moderation.reason, statusCode: 422, userId: req.userId });
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
        logSecurityEvent(logger, { type: "upload-rejected", route: ROUTE, reason: classification.reason, statusCode: response.status, userId: req.userId });
        res.status(response.status).json({ error: { code: classification.reason, message: response.message } });
        return;
      }

      // Store the image only once it's cleared moderation and been
      // confirmed as a real dish - never persist a photo that failed
      // format/blur/moderation checks, and never store the raw upload
      // as-is (re-encoded via normalizeImage() first: orientation-correct,
      // EXIF/GPS stripped). Best-effort, like nutrition below: a storage
      // hiccup shouldn't fail a request whose core recipe result doesn't
      // depend on it.
      let image: { objectKey: string; url: string } | null = null;
      const normalized = await normalizeImage(req.file.buffer);
      if (normalized.ok) {
        try {
          const stored = await uploadNormalizedImage(uploadsBucket, normalized.buffer, normalized.mimeType);
          const url = await getSignedReadUrl(uploadsBucket, stored.objectKey, config.GCS_SIGNED_URL_EXPIRY_SECONDS);
          image = { objectKey: stored.objectKey, url };
        } catch (err) {
          logger.error({ err, dishName: classification.dishName }, "Image storage failed - continuing without a stored image.");
        }
      } else {
        logger.error({ reason: normalized.reason, dishName: classification.dishName }, "Image normalization failed - continuing without a stored image.");
      }

      const recipeResult = await generateRecipe(anthropicClient, config.ANTHROPIC_MODEL, classification.dishName);
      if (!recipeResult.ok) {
        res.status(502).json({
          error: {
            code: "recipe-generation-failed",
            message: "Could not generate a recipe for this dish. Please try again.",
          },
        });
        return;
      }
      const { recipe } = recipeResult;

      // Nutrition is a best-effort enrichment, not a gate - Edamam being
      // down/rate-limited shouldn't block the core recipe result the user
      // actually asked for. Logged server-side so a persistent outage is
      // still visible, but the client just gets `nutrition: null`.
      const nutritionResult = await lookupNutrition(
        fetch,
        { appId: config.NUTRITION_API_APP_ID, appKey: config.NUTRITION_API_APP_KEY },
        recipe.dishName,
        recipe.ingredients,
      );
      if (!nutritionResult.ok) {
        logger.error({ reason: nutritionResult.reason, dishName: recipe.dishName }, "Nutrition lookup failed - continuing without nutrition data.");
      }
      const nutrition = nutritionResult.ok ? nutritionResult.nutrition : null;

      const userId = req.userId as string;
      const session = await sessionStore.createSession(userId);
      await sessionStore.appendMessage(userId, session.sessionId, {
        role: "assistant",
        content: JSON.stringify({
          dishName: classification.dishName,
          confidence: classification.confidence,
          recipe,
          nutrition,
          imageObjectKey: image?.objectKey ?? null,
        }),
      });

      res.status(200).json({
        status: "accepted",
        sessionId: session.sessionId,
        dishName: classification.dishName,
        recipe,
        nutrition,
        image,
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
      logSecurityEvent(logger, { type: "upload-rejected", route: ROUTE, reason: "too-large", statusCode: 413, userId: (_req as AuthenticatedRequest).userId });
      res.status(413).json({ error: { code: "too-large", message: "Uploaded file exceeds the maximum allowed size." } });
      return;
    }
    res.status(400).json({ error: { code: "invalid-upload", message: "Uploaded file could not be processed." } });
    return;
  }

  // Log server-side only - never leak internals (stack trace, Vision/Prisma
  // error text) into the client response (`01-security-checklist.md` §11).
  logger.error({ err }, "Unhandled error in /upload");
  res.status(500).json({ error: { code: "internal-error", message: "An unexpected error occurred." } });
};

uploadRouter.use(handleUploadError);
