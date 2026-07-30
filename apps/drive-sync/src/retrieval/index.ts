import type { Index } from "@pinecone-database/pinecone";
import type { EmbeddingClient } from "../embeddings/index.js";
import { generateEmbeddings } from "../embeddings/index.js";

export interface RetrievedChunk {
  fileId: string;
  title: string;
  chunkIndex: number;
  sourceUrl: string;
  section: string;
  score: number;
}

export type RetrievalResult = { ok: true; chunks: RetrievedChunk[] } | { ok: false; reason: "embedding-failed" | "query-failed" };

export interface RetrievalOptions {
  topK?: number;
  embeddingDimensions?: number;
}

const DEFAULT_TOP_K = 5;

/**
 * Milestone #10: embeds a plain-language prompt and returns the top-k
 * most similar chunks with source attribution. Deliberately returns only
 * `fileId`/`title`/`chunkIndex`/`sourceUrl`/`section`/`score` - never the
 * chunk's actual text, because that text was never stored in Pinecone to
 * begin with (`upsertChunkVectors`, Milestone #6, `01-security-checklist.md`
 * §4: "Pinecone metadata never includes sensitive raw content"). This
 * endpoint answers "where is the relevant content," not "here is the
 * relevant content" - a caller that needs the actual passage text follows
 * `sourceUrl` to the real Drive document (through whatever access control
 * governs that document), rather than this service ever holding a copy of
 * the raw text outside of the sync pipeline's own transient processing.
 *
 * Reuses `generateEmbeddings` (Milestone #5) for the query itself - a
 * single-item batch - so the query is embedded with the exact same
 * model/dimension configuration as every document chunk, which is
 * required for the similarity comparison to mean anything.
 */
export async function retrieveChunks(
  embeddingClient: EmbeddingClient,
  embeddingModel: string,
  vectorIndex: Index,
  query: string,
  options: RetrievalOptions = {},
): Promise<RetrievalResult> {
  const embeddingResult = await generateEmbeddings(embeddingClient, embeddingModel, [query], {
    dimensions: options.embeddingDimensions,
  });
  if (!embeddingResult.ok) {
    return { ok: false, reason: "embedding-failed" };
  }

  try {
    const queryResponse = await vectorIndex.query({
      vector: embeddingResult.embeddings[0] as number[],
      topK: options.topK ?? DEFAULT_TOP_K,
      includeMetadata: true,
    });

    const chunks: RetrievedChunk[] = queryResponse.matches.map((match) => ({
      fileId: String(match.metadata?.fileId ?? ""),
      title: String(match.metadata?.title ?? ""),
      chunkIndex: Number(match.metadata?.chunkIndex ?? 0),
      sourceUrl: String(match.metadata?.sourceUrl ?? ""),
      section: String(match.metadata?.section ?? ""),
      score: match.score ?? 0,
    }));

    return { ok: true, chunks };
  } catch {
    return { ok: false, reason: "query-failed" };
  }
}
