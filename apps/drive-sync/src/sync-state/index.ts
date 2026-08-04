import { prisma } from "@lens-and-sync/shared-db";
import type { KnownFileRecord } from "../drive/index.js";

export interface SyncStateInput {
  driveFileId: string;
  title: string;
  sourceUrl: string;
  contentHash: string;
  driveModifiedTime: string;
  chunkIds: string[];
}

/**
 * Reads the subset of persisted sync state that `detectChanges()`
 * (`drive/index.ts`, Milestone #2) needs to compare against a live Drive
 * folder listing - Milestone #8's `DriveFile` model is the durable memory
 * of "what we last saw," replacing the hand-built known-file lists every
 * earlier DriveSync cycle used for testing/live-verification.
 *
 * Reads every `DriveFile` row, not scoped to a folder - the schema has no
 * `folderId` column (Milestone #8's field list is `driveFileId`/
 * `contentHash`/`driveModifiedTime`/`chunkIds`/`lastSyncedAt` only), so a
 * file's Drive folder membership isn't part of the persisted comparison
 * key. This matches `detectChanges`'s own behavior: a file moved between
 * tracked folders keeps the same `driveFileId` and is never mistaken for
 * a delete-then-recreate.
 */
export async function listKnownFiles(): Promise<KnownFileRecord[]> {
  const rows = await prisma.driveFile.findMany({ select: { driveFileId: true, driveModifiedTime: true } });
  return rows.map((row: { driveFileId: string; driveModifiedTime: Date }) => ({ driveFileId: row.driveFileId, driveModifiedTime: row.driveModifiedTime.toISOString() }));
}

/**
 * The previously-recorded content hash for one file, or `null` if it's
 * never been synced - the exact shape `shouldReembedFile()`
 * (`drive/index.ts`, Milestone #7) expects for its "no prior record"
 * case.
 */
export async function getKnownContentHash(driveFileId: string): Promise<string | null> {
  const row = await prisma.driveFile.findUnique({ where: { driveFileId }, select: { contentHash: true } });
  return row?.contentHash ?? null;
}

export interface KnownSyncState {
  contentHash: string;
  chunkIds: string[];
}

/**
 * Like `getKnownContentHash`, but also returns the previously-stored
 * `chunkIds` - needed by the sync orchestration (`jobs/index.ts`) when a
 * file's content hash is unchanged: it still needs to re-persist the
 * record (refreshing `driveModifiedTime`/`lastSyncedAt` so `detectChanges`
 * stops re-flagging it as "updated" every future run) without touching
 * Pinecone, which means it needs the *existing* `chunkIds` rather than
 * recomputing them from a re-embed it's deliberately skipping.
 */
export async function getSyncStateRecord(driveFileId: string): Promise<KnownSyncState | null> {
  const row = await prisma.driveFile.findUnique({ where: { driveFileId }, select: { contentHash: true, chunkIds: true } });
  return row ? { contentHash: row.contentHash, chunkIds: row.chunkIds } : null;
}

/**
 * Records (or updates) a file's sync state after a successful
 * extract-chunk-embed-upsert pass. `lastSyncedAt` is only bumped
 * explicitly on update - a fresh row relies on the schema's own
 * `@default(now())` for its first value, so a newly-created record's
 * `lastSyncedAt` reflects the same moment as `createdAt` without this
 * function needing to duplicate that default.
 */
export async function upsertSyncState(record: SyncStateInput): Promise<void> {
  await prisma.driveFile.upsert({
    where: { driveFileId: record.driveFileId },
    create: {
      driveFileId: record.driveFileId,
      title: record.title,
      sourceUrl: record.sourceUrl,
      contentHash: record.contentHash,
      driveModifiedTime: new Date(record.driveModifiedTime),
      chunkIds: record.chunkIds,
    },
    update: {
      title: record.title,
      sourceUrl: record.sourceUrl,
      contentHash: record.contentHash,
      driveModifiedTime: new Date(record.driveModifiedTime),
      chunkIds: record.chunkIds,
      lastSyncedAt: new Date(),
    },
  });
}

/**
 * Removes a file's sync-state record once its Pinecone vectors have been
 * deleted (`deleteVectorsForFile`, Milestone #7) - called for every ID in
 * `detectChanges`'s `deletedFileIds`. A no-op (not an error) if the
 * record doesn't exist, since a caller retrying a partially-failed sync
 * shouldn't need to first check whether this step already ran.
 */
export async function deleteSyncState(driveFileId: string): Promise<void> {
  await prisma.driveFile.deleteMany({ where: { driveFileId } });
}

/** Scopes on-demand text fetching (routes/sync.ts's GET /document/:fileId) to files this deployment actually syncs, not arbitrary Drive files the service account happens to be able to read. */
export async function getKnownFile(driveFileId: string): Promise<{ title: string; sourceUrl: string } | null> {
  const row = await prisma.driveFile.findUnique({ where: { driveFileId }, select: { title: true, sourceUrl: true } });
  return row ?? null;
}

export interface AuditFileRecord {
  driveFileId: string;
  title: string;
  sourceUrl: string;
  chunkCount: number;
  lastSyncedAt: string;
  driveModifiedTime: string;
}

export async function listAllSyncState(): Promise<AuditFileRecord[]> {
  const rows = await prisma.driveFile.findMany({
    select: { driveFileId: true, title: true, sourceUrl: true, chunkIds: true, lastSyncedAt: true, driveModifiedTime: true },
    orderBy: { lastSyncedAt: "desc" },
  });
  return rows.map((row: { driveFileId: string; title: string; sourceUrl: string; chunkIds: string[]; lastSyncedAt: Date; driveModifiedTime: Date }) => ({
    driveFileId: row.driveFileId,
    title: row.title,
    sourceUrl: row.sourceUrl,
    chunkCount: row.chunkIds.length,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
    driveModifiedTime: row.driveModifiedTime.toISOString(),
  }));
}
