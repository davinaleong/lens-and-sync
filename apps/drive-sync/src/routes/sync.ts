import { requireAuth, type AuthenticatedRequest } from "@lens-and-sync/shared-auth";
import type { ErrorRequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { driveClient } from "../drive/client.js";
import { openaiClient } from "../embeddings/client.js";
import { extractText } from "../extraction/index.js";
import { readSyncStatus } from "../jobs/status.js";
import { logger } from "../logger.js";
import { redis } from "../redis-client.js";
import { retrieveChunks } from "../retrieval/index.js";
import { getKnownFile, listAllSyncState } from "../sync-state/index.js";
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

const EXTRACTION_ERROR_RESPONSES: Record<Exclude<Awaited<ReturnType<typeof extractText>>, { ok: true }>["reason"], { status: number; message: string }> = {
  "unsupported-mime-type": { status: 415, message: "This file's format isn't supported for text extraction." },
  "empty-content": { status: 422, message: "This file has no extractable text content." },
  "scanned-pdf-ocr-not-implemented": { status: 422, message: "This PDF appears to be scanned images - text extraction (OCR) isn't supported yet." },
  "extraction-failed": { status: 502, message: "Could not extract text from this file. Please try again." },
};

/**
 * On-demand plain-text fetch for a single synced file - deliberately
 * fetched live from Drive on every call rather than cached/stored
 * anywhere (Pinecone metadata still never gets raw content, per
 * `vector-store/index.ts`). Scoped to files this deployment actually
 * tracks (`getKnownFile`) rather than any Drive file the service
 * account's credentials happen to be able to read, so this can't become
 * an arbitrary Drive-read proxy.
 */
syncRouter.get("/document/:fileId", requireAuth(config.JWT_ACCESS_SECRET, logger), async (req: AuthenticatedRequest, res, next) => {
  try {
    const fileId = req.params.fileId;
    if (!fileId) {
      res.status(400).json({ error: { code: "invalid-request", message: "A file ID is required." } });
      return;
    }

    const known = await getKnownFile(fileId);
    if (!known) {
      res.status(404).json({ error: { code: "not-found", message: "That file isn't part of the synced index." } });
      return;
    }

    const meta = await driveClient.files.get({ fileId, fields: "mimeType" });
    const mimeType = meta.data.mimeType;
    if (!mimeType) {
      res.status(502).json({ error: { code: "extraction-failed", message: "Could not read this file's metadata from Drive." } });
      return;
    }

    const extracted = await extractText(driveClient, { id: fileId, mimeType });
    if (!extracted.ok) {
      const response = EXTRACTION_ERROR_RESPONSES[extracted.reason];
      res.status(response.status).json({ error: { code: extracted.reason, message: response.message } });
      return;
    }

    res.status(200).json({ fileId, title: known.title, sourceUrl: known.sourceUrl, text: extracted.text });
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

/**
 * Audit endpoint: last sync result + full Postgres index state in one call.
 * Gives a complete picture of what the worker has processed without needing
 * to query Postgres or Pinecone directly.
 */
syncRouter.get("/audit", requireAuth(config.JWT_ACCESS_SECRET, logger), async (_req: AuthenticatedRequest, res, next) => {
  try {
    const [lastSync, files] = await Promise.all([readSyncStatus(redis), listAllSyncState()]);
    const totalChunks = files.reduce((sum, f) => sum + f.chunkCount, 0);
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      lastSync,
      index: { totalFiles: files.length, totalChunks, files },
    });
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
