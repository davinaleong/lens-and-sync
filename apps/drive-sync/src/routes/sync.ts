import { requireAuth, type AuthenticatedRequest } from "@lens-and-sync/shared-auth";
import type { ErrorRequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { openaiClient } from "../embeddings/client.js";
import { readSyncStatus } from "../jobs/status.js";
import { logger } from "../logger.js";
import { redis } from "../redis-client.js";
import { retrieveChunks } from "../retrieval/index.js";
import { vectorIndex } from "../vector-store/pinecone-client.js";

export const syncRouter: Router = Router();

const queryBodySchema = z.object({
  query: z.string().min(1).max(2000),
  topK: z.coerce.number().int().min(1).max(20).optional(),
});

/**
 * Milestone #10's retrieval endpoint. Requires auth like every other live
 * route in this project (`requireAuth`, shared JWT scheme with dish-lens)
 * - synced Drive content isn't public data, so an unauthenticated caller
 * shouldn't be able to query it. Returns source-attribution metadata
 * only, never chunk text - see `retrieval/index.ts` for why.
 */
syncRouter.post("/query", requireAuth(config.JWT_ACCESS_SECRET, logger), async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = queryBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A non-empty 'query' string is required." } });
      return;
    }

    const result = await retrieveChunks(openaiClient, config.EMBEDDING_MODEL, vectorIndex, parsed.data.query, {
      topK: parsed.data.topK,
      embeddingDimensions: config.EMBEDDING_DIMENSIONS,
    });

    if (!result.ok) {
      logger.error({ reason: result.reason, userId: req.userId }, "Retrieval query failed");
      res.status(502).json({ error: { code: result.reason, message: "Could not complete the retrieval query. Please try again." } });
      return;
    }

    res.status(200).json({ chunks: result.chunks });
  } catch (err) {
    next(err);
  }
});

/**
 * Milestone #11's last-sync-status endpoint. Reads the single Redis key
 * `writeSyncStatus`/`readSyncStatus` (`jobs/status.ts`) maintains -
 * whatever the most recent sync run (scheduled or manually triggered)
 * left behind, including per-file failures if any occurred. `status:
 * null` (not an error) is the correct response before any sync has ever
 * run yet.
 */
syncRouter.get("/status", requireAuth(config.JWT_ACCESS_SECRET, logger), async (_req: AuthenticatedRequest, res, next) => {
  try {
    const status = await readSyncStatus(redis);
    res.status(200).json({ status });
  } catch (err) {
    next(err);
  }
});

const handleSyncError: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  logger.error({ err }, "Unhandled error in /sync");
  res.status(500).json({ error: { code: "internal-error", message: "An unexpected error occurred." } });
};

syncRouter.use(handleSyncError);
