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
