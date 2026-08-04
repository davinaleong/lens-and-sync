import { requireAuth, type AuthenticatedRequest } from "@lens-and-sync/shared-auth";
import type { ErrorRequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { createScan, listScans, type ScanSummary } from "../scans/index.js";
import { uploadsBucket } from "../storage/gcs-client.js";
import { getSignedReadUrl } from "../storage/index.js";

const nutritionSchema = z.object({
  calories: z.number().nonnegative(),
  proteinGrams: z.number().nonnegative(),
  fatGrams: z.number().nonnegative(),
  carbsGrams: z.number().nonnegative(),
});

const createScanSchema = z.object({
  dishName: z.string().min(1).max(200),
  recipe: z.object({
    ingredients: z.array(z.string().min(1)).min(1),
    steps: z.array(z.string().min(1)).min(1),
  }),
  nutrition: nutritionSchema.nullable(),
  imageObjectKey: z.string().min(1).nullable().optional(),
});

export const scansRouter: Router = Router();

scansRouter.use(requireAuth(config.JWT_ACCESS_SECRET, logger));

/** Signed read URLs are short-lived (GCS_SIGNED_URL_EXPIRY_SECONDS), so they're regenerated on every read rather than stored. */
async function withImageUrl(scan: ScanSummary): Promise<ScanSummary & { imageUrl: string | null }> {
  if (!scan.imageObjectKey) return { ...scan, imageUrl: null };
  try {
    const imageUrl = await getSignedReadUrl(uploadsBucket, scan.imageObjectKey, config.GCS_SIGNED_URL_EXPIRY_SECONDS);
    return { ...scan, imageUrl };
  } catch (err) {
    logger.error({ err, scanId: scan.id }, "Failed to sign scan image URL - continuing without it.");
    return { ...scan, imageUrl: null };
  }
}

scansRouter.post("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = createScanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "invalid-request",
          message: "A dishName, recipe (ingredients + steps), and nutrition (or null) are required.",
        },
      });
      return;
    }

    const scan = await createScan(req.userId as string, {
      dishName: parsed.data.dishName,
      ingredients: parsed.data.recipe.ingredients,
      steps: parsed.data.recipe.steps,
      nutrition: parsed.data.nutrition,
      imageObjectKey: parsed.data.imageObjectKey ?? null,
    });
    res.status(201).json({ scan: await withImageUrl(scan) });
  } catch (err) {
    next(err);
  }
});

scansRouter.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const scans = await listScans(req.userId as string);
    const withUrls = await Promise.all(scans.map(withImageUrl));
    res.status(200).json({ scans: withUrls });
  } catch (err) {
    next(err);
  }
});

const handleScansError: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  logger.error({ err }, "Unhandled error in /scans");
  res.status(500).json({ error: { code: "internal-error", message: "An unexpected error occurred." } });
};

scansRouter.use(handleScansError);
