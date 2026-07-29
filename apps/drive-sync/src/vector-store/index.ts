import type { Index, RecordMetadata } from "@pinecone-database/pinecone";

export interface ChunkVectorMetadata extends RecordMetadata {
  fileId: string;
  title: string;
  chunkIndex: number;
  sourceUrl: string;
  section: string;
}

export interface ChunkVector {
  fileId: string;
  chunkIndex: number;
  title: string;
  sourceUrl: string;
  section: string | null;
  embedding: number[];
}

/**
 * Stable vector ID scheme (Milestone #6): `{fileId}-{chunkIndex}`.
 * Deterministic from the chunk's own identity, not a random ID - re-syncing
 * an unchanged or updated file re-derives the exact same IDs for its
 * chunks, so an upsert naturally overwrites the prior version in place
 * rather than creating a duplicate/orphaned vector alongside it.
 */
export function vectorId(fileId: string, chunkIndex: number): string {
  return `${fileId}-${chunkIndex}`;
}

export type UpsertResult = { ok: true; count: number } | { ok: false; reason: "upsert-failed" };

const DEFAULT_BATCH_SIZE = 100;

/**
 * Writes chunk embeddings to Pinecone (Milestone #6). Metadata is
 * deliberately limited to `fileId`/`title`/`chunkIndex`/`sourceUrl`/
 * `section` - retrieval-relevant identifiers only, never the chunk's raw
 * text or any other extracted content (`01-security-checklist.md` §4:
 * "Pinecone metadata never includes sensitive raw content - only IDs,
 * titles, and retrieval-relevant fields"). `section` is stored as `""`
 * rather than `null`/omitted, since Pinecone metadata values must be
 * string/number/boolean/string-array - there's no null.
 *
 * Batches upserts (default 100 per call, Pinecone's own recommended
 * batch size) and takes the `Index` client as a parameter (same
 * dependency-injection shape as every external-service call in this
 * codebase), so this is unit-testable against a hand-built fake index.
 */
export async function upsertChunkVectors(index: Index, vectors: ChunkVector[], options: { batchSize?: number } = {}): Promise<UpsertResult> {
  if (vectors.length === 0) {
    return { ok: true, count: 0 };
  }

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  try {
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await index.upsert(
        batch.map((vector) => ({
          id: vectorId(vector.fileId, vector.chunkIndex),
          values: vector.embedding,
          metadata: {
            fileId: vector.fileId,
            title: vector.title,
            chunkIndex: vector.chunkIndex,
            sourceUrl: vector.sourceUrl,
            section: vector.section ?? "",
          } satisfies ChunkVectorMetadata,
        })),
      );
    }
    return { ok: true, count: vectors.length };
  } catch {
    return { ok: false, reason: "upsert-failed" };
  }
}

export type DeleteResult = { ok: true; deletedCount: number } | { ok: false; reason: "delete-failed" };

/**
 * Deletes every vector belonging to a Drive file that's been deleted (or
 * moved out of the tracked folder) - Milestone #7's "delete stale
 * Pinecone vectors on file deletion" and `01-security-checklist.md` §4's
 * "stale vectors are a data leakage risk in retrieval results."
 *
 * Deliberately does NOT delete by metadata filter (`index.deleteMany({
 * fileId: { $eq } })`) even though the SDK's types allow it - Pinecone's
 * serverless indexes (what this project actually uses, confirmed live in
 * Cycle 22) don't support delete-by-metadata-filter, only pod-based
 * indexes do. Instead, `listPaginated({ prefix })` finds every vector ID
 * matching `{fileId}-` (safe because `vectorId()`'s scheme guarantees
 * every one of a file's chunk IDs shares that exact prefix and no other
 * file's IDs can), then deletes that explicit ID list - `listPaginated`
 * is documented as serverless-only, the opposite constraint, so this is
 * the one approach that works on the index this project actually has.
 *
 * Theoretical caveat: a prefix match is only unambiguous if no Drive file
 * ID is itself a prefix of another file's ID followed by `-` (e.g. file
 * `abc` vs. file `abc-xyz`, whose own chunk `0` would be ID `abc-xyz-0`,
 * matching the prefix `abc-`). Real Drive file IDs are long (~33-44 char),
 * effectively-random base64url strings, so this isn't a realistic risk in
 * practice - documented rather than engineered around, since the
 * `{fileId}-{chunkIndex}` scheme itself is specified by the milestone and
 * changing the delimiter wouldn't fully eliminate the theoretical
 * possibility anyway (Drive IDs may contain both `-` and `_`).
 */
export async function deleteVectorsForFile(index: Index, fileId: string): Promise<DeleteResult> {
  try {
    const ids: string[] = [];
    let paginationToken: string | undefined;

    do {
      const page = await index.listPaginated({ prefix: `${fileId}-`, paginationToken });
      for (const item of page.vectors ?? []) {
        if (item.id) {
          ids.push(item.id);
        }
      }
      paginationToken = page.pagination?.next;
    } while (paginationToken);

    if (ids.length === 0) {
      return { ok: true, deletedCount: 0 };
    }

    await index.deleteMany(ids);
    return { ok: true, deletedCount: ids.length };
  } catch {
    return { ok: false, reason: "delete-failed" };
  }
}
