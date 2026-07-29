import type OpenAI from "openai";

export type EmbeddingClient = Pick<OpenAI, "embeddings">;

export type EmbeddingResult = { ok: true; embeddings: number[][] } | { ok: false; reason: "embedding-failed" };

export interface EmbeddingOptions {
  // OpenAI caps a single request at 2048 input items and 300,000 tokens
  // summed across all inputs - 100 chunks per batch stays comfortably
  // under both for chunks sized per `chunking/index.ts`'s defaults
  // (~400-460 tokens each).
  batchSize?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  // `text-embedding-3-small` supports shortening its output via
  // Matryoshka representation learning - pass this to match whatever
  // dimension the target Pinecone index was actually provisioned with
  // (Milestone #6's "dimension matching embedding model output" cuts both
  // ways: the index must match the embeddings, not just the reverse).
  // Omitted entirely means the model's own default (1536).
  dimensions?: number;
  // Injectable so tests never actually wait out a real backoff delay -
  // same reasoning as every other external-dependency parameter in this
  // codebase (`redis`, `bucket`, `drive` client, etc.).
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

function isRetryableStatus(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

async function embedBatchWithRetry(
  client: EmbeddingClient,
  model: string,
  batch: string[],
  dimensions: number | undefined,
  maxRetries: number,
  baseDelayMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<number[][] | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.embeddings.create({ model, input: batch, ...(dimensions ? { dimensions } : {}) });
      // Reorder by the API's own `index` rather than trusting array
      // order - defensive, since a caller pairing these embeddings back
      // up with `chunkText`'s output by position would silently
      // mismatch chunks and vectors if that assumption were ever wrong.
      return [...response.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
    } catch (err) {
      if (!isRetryableStatus(err) || attempt === maxRetries) {
        return null;
      }
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  return null;
}

/**
 * Generates embeddings for a list of texts (Milestone #5), batching
 * requests to stay within OpenAI's per-request limits and retrying
 * rate-limited (`429`) or transient server (`5xx`) failures with
 * exponential backoff. Batches are processed sequentially, not in
 * parallel - deliberately: firing every batch at once would be more
 * likely to *trigger* rate limiting, not avoid it. A batch that's still
 * failing after `maxRetries` fails the whole call rather than returning a
 * partial result with silent gaps that a caller might not notice - an
 * embedding is either complete for every chunk of a file or the sync
 * for that file didn't happen, never partially/inconsistently vectorized.
 */
export async function generateEmbeddings(
  client: EmbeddingClient,
  model: string,
  texts: string[],
  options: EmbeddingOptions = {},
): Promise<EmbeddingResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  if (texts.length === 0) {
    return { ok: true, embeddings: [] };
  }

  const embeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const result = await embedBatchWithRetry(client, model, batch, options.dimensions, maxRetries, baseDelayMs, sleep);
    if (!result) {
      return { ok: false, reason: "embedding-failed" };
    }
    embeddings.push(...result);
  }

  return { ok: true, embeddings };
}
