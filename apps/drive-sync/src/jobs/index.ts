import type { Logger } from "@lens-and-sync/shared-logger";
import type { Index } from "@pinecone-database/pinecone";
import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import type { drive_v3 } from "googleapis";
import type { Redis } from "ioredis";
import { chunkText, type ChunkOptions } from "../chunking/index.js";
import { computeContentHash, detectChanges, listDriveFiles, shouldReembedFile, type DriveFileMetadata } from "../drive/index.js";
import { generateEmbeddings, type EmbeddingClient } from "../embeddings/index.js";
import { extractText } from "../extraction/index.js";
import { deleteSyncState, getSyncStateRecord, listKnownFiles, upsertSyncState } from "../sync-state/index.js";
import { deleteVectorsForFile, upsertChunkVectors, vectorId } from "../vector-store/index.js";
import { acquireSyncLock, releaseSyncLock } from "./lock.js";

export interface SyncDependencies {
  drive: drive_v3.Drive;
  folderIds: string[];
  embeddingClient: EmbeddingClient;
  embeddingModel: string;
  embeddingDimensions?: number;
  vectorIndex: Index;
  chunkOptions?: ChunkOptions;
}

export interface SyncFailure {
  fileId: string;
  reason: string;
}

export interface SyncRunResult {
  newFiles: number;
  updatedFiles: number;
  skippedUnchanged: number;
  deletedFiles: number;
  failures: SyncFailure[];
}

type FileSyncOutcome = { ok: true; reembedded: boolean } | { ok: false; reason: string };

/**
 * Full extract → dedup → chunk → embed → upsert → persist pass for one
 * new/updated file. Content-hash dedup (Milestone #7) runs before any
 * chunking/embedding: if the real extracted text is unchanged from what's
 * stored, this only refreshes the Postgres record (so `detectChanges`
 * stops re-flagging the file every future run) and returns without
 * spending any OpenAI/Pinecone cost.
 */
async function syncOneFile(file: DriveFileMetadata, deps: SyncDependencies): Promise<FileSyncOutcome> {
  const extraction = await extractText(deps.drive, file);
  if (!extraction.ok) {
    return { ok: false, reason: extraction.reason };
  }

  const contentHash = computeContentHash(extraction.text);
  const known = await getSyncStateRecord(file.id);

  if (!shouldReembedFile(contentHash, known?.contentHash ?? null)) {
    await upsertSyncState({
      driveFileId: file.id,
      title: file.name,
      sourceUrl: file.webViewLink,
      contentHash,
      driveModifiedTime: file.modifiedTime,
      chunkIds: known?.chunkIds ?? [],
    });
    return { ok: true, reembedded: false };
  }

  const chunks = chunkText(extraction.text, { fileId: file.id, title: file.name }, deps.chunkOptions);
  const embeddingResult = await generateEmbeddings(deps.embeddingClient, deps.embeddingModel, chunks.map((chunk) => chunk.text), {
    dimensions: deps.embeddingDimensions,
  });
  if (!embeddingResult.ok) {
    return { ok: false, reason: embeddingResult.reason };
  }

  const vectors = chunks.map((chunk, i) => ({
    fileId: chunk.fileId,
    chunkIndex: chunk.chunkIndex,
    title: chunk.title,
    sourceUrl: file.webViewLink,
    section: chunk.section,
    embedding: embeddingResult.embeddings[i] as number[],
  }));

  // Delete any previously-stored vectors for this file first - guards
  // against orphaned vectors if it has fewer chunks now than on its last
  // sync (an upsert alone would leave the extra old ones behind).
  const deleteResult = await deleteVectorsForFile(deps.vectorIndex, file.id);
  if (!deleteResult.ok) {
    return { ok: false, reason: deleteResult.reason };
  }

  const upsertResult = await upsertChunkVectors(deps.vectorIndex, vectors);
  if (!upsertResult.ok) {
    return { ok: false, reason: upsertResult.reason };
  }

  await upsertSyncState({
    driveFileId: file.id,
    title: file.name,
    sourceUrl: file.webViewLink,
    contentHash,
    driveModifiedTime: file.modifiedTime,
    chunkIds: vectors.map((vector) => vectorId(vector.fileId, vector.chunkIndex)),
  });

  return { ok: true, reembedded: true };
}

/**
 * One full sync pass across every configured Drive folder (Milestone #9's
 * job body): list every folder → detect changes against persisted state
 * (Milestone #2/#8) → sync each new/updated file (Milestone #3-#8) → delete
 * vectors and sync-state for each removed file (Milestone #7). A failure
 * on one file is recorded in `failures` and doesn't stop the rest of the
 * run - one bad file (a corrupt PDF, a transient API error) shouldn't
 * abort an otherwise-successful sync of everything else.
 */
export async function runSyncOnce(deps: SyncDependencies): Promise<SyncRunResult> {
  const result: SyncRunResult = { newFiles: 0, updatedFiles: 0, skippedUnchanged: 0, deletedFiles: 0, failures: [] };

  const currentFiles: DriveFileMetadata[] = [];
  for (const folderId of deps.folderIds) {
    currentFiles.push(...(await listDriveFiles(deps.drive, folderId)));
  }

  const knownFiles = await listKnownFiles();
  const changes = detectChanges(currentFiles, knownFiles);

  for (const file of changes.newFiles) {
    const outcome = await syncOneFile(file, deps);
    if (outcome.ok) {
      result.newFiles++;
    } else {
      result.failures.push({ fileId: file.id, reason: outcome.reason });
    }
  }

  for (const file of changes.updatedFiles) {
    const outcome = await syncOneFile(file, deps);
    if (!outcome.ok) {
      result.failures.push({ fileId: file.id, reason: outcome.reason });
    } else if (outcome.reembedded) {
      result.updatedFiles++;
    } else {
      result.skippedUnchanged++;
    }
  }

  for (const deletedId of changes.deletedFileIds) {
    const deleteResult = await deleteVectorsForFile(deps.vectorIndex, deletedId);
    if (!deleteResult.ok) {
      result.failures.push({ fileId: deletedId, reason: deleteResult.reason });
      continue;
    }
    await deleteSyncState(deletedId);
    result.deletedFiles++;
  }

  return result;
}

// Generous headroom over a real sync run's expected duration - released
// early via the worker's `finally` regardless, this is only a backstop
// against a crashed run leaving the lock held forever.
const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;

export function createSyncQueue(connection: ConnectionOptions, queueName: string): Queue {
  return new Queue(queueName, { connection });
}

/** Registers (or re-registers, idempotently by `jobId`) the recurring sync job. */
export async function scheduleSyncJob(queue: Queue, cronPattern: string): Promise<void> {
  await queue.add("sync", {}, { repeat: { pattern: cronPattern }, jobId: "drive-sync-scheduled" });
}

/**
 * A `Worker` with `concurrency: 1` (never runs two sync jobs from this
 * queue at once) plus a Redis lock (`jobs/lock.ts`) around the actual
 * sync execution - the lock is what actually satisfies
 * `01-security-checklist.md` §4's "prevents concurrent runs from
 * producing conflicting writes," since concurrency alone doesn't protect
 * against a manually-triggered run overlapping a scheduled one. Skipping
 * (not failing) a run that can't acquire the lock is deliberate - lock
 * contention is an expected, benign outcome of overlap, not an error.
 */
export function createSyncWorker(
  connection: ConnectionOptions,
  queueName: string,
  lockRedis: Redis,
  runSync: () => Promise<SyncRunResult>,
  logger: Logger,
  lockTtlMs: number = DEFAULT_LOCK_TTL_MS,
): Worker {
  return new Worker(
    queueName,
    async (job: Job): Promise<SyncRunResult | undefined> => {
      const lock = await acquireSyncLock(lockRedis, `${queueName}:lock`, lockTtlMs);
      if (!lock) {
        logger.warn({ event: "sync-skipped-locked", jobId: job.id }, "Sync run skipped - another run already holds the lock");
        return undefined;
      }
      try {
        const result = await runSync();
        logger.info({ event: "sync-completed", jobId: job.id, ...result }, "Sync run completed");
        return result;
      } catch (err) {
        logger.error({ err, jobId: job.id }, "Sync run failed");
        throw err;
      } finally {
        await releaseSyncLock(lockRedis, lock);
      }
    },
    { connection, concurrency: 1 },
  );
}
