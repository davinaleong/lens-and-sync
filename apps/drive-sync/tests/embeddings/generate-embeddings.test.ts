import { describe, expect, it, vi } from "vitest";
import { generateEmbeddings, type EmbeddingClient } from "../../src/embeddings/index.js";

function fakeClient(create: ReturnType<typeof vi.fn>): EmbeddingClient {
  return { embeddings: { create } } as unknown as EmbeddingClient;
}

function apiError(status: number): Error {
  return Object.assign(new Error(`API error ${status}`), { status });
}

describe("generateEmbeddings", () => {
  it("returns an empty result for an empty input without calling the API", async () => {
    const create = vi.fn();
    const result = await generateEmbeddings(fakeClient(create), "text-embedding-3-small", []);

    expect(result).toEqual({ ok: true, embeddings: [] });
    expect(create).not.toHaveBeenCalled();
  });

  it("passes a configured dimensions value through to the API call", async () => {
    const create = vi.fn().mockResolvedValue({ data: [{ index: 0, embedding: [0.1] }] });

    await generateEmbeddings(fakeClient(create), "text-embedding-3-small", ["a"], { dimensions: 512 });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ dimensions: 512 }));
  });

  it("omits dimensions entirely from the API call when not configured", async () => {
    const create = vi.fn().mockResolvedValue({ data: [{ index: 0, embedding: [0.1] }] });

    await generateEmbeddings(fakeClient(create), "text-embedding-3-small", ["a"]);

    expect(create.mock.calls[0][0]).not.toHaveProperty("dimensions");
  });

  it("returns one embedding per input text, in input order, using the response's index field", async () => {
    // Response deliberately out of order - the reorder-by-index logic
    // must correct this, not just trust array position.
    const create = vi.fn().mockResolvedValue({
      data: [
        { index: 1, embedding: [0.2] },
        { index: 0, embedding: [0.1] },
      ],
    });

    const result = await generateEmbeddings(fakeClient(create), "text-embedding-3-small", ["a", "b"]);

    expect(result).toEqual({ ok: true, embeddings: [[0.1], [0.2]] });
  });

  it("splits input into multiple batches according to batchSize", async () => {
    const create = vi.fn().mockImplementation(async ({ input }: { input: string[] }) => ({
      data: input.map((_, i) => ({ index: i, embedding: [i] })),
    }));

    const texts = ["a", "b", "c", "d", "e"];
    const result = await generateEmbeddings(fakeClient(create), "text-embedding-3-small", texts, { batchSize: 2 });

    expect(create).toHaveBeenCalledTimes(3); // [a,b], [c,d], [e]
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.embeddings).toHaveLength(5);
    }
  });

  it("retries a rate-limited (429) batch and succeeds once the API recovers", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(apiError(429))
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [0.5] }] });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await generateEmbeddings(fakeClient(create), "text-embedding-3-small", ["a"], { sleep, maxRetries: 3 });

    expect(result).toEqual({ ok: true, embeddings: [[0.5]] });
    expect(create).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 500 the same way as a 429", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [0.5] }] });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await generateEmbeddings(fakeClient(create), "text-embedding-3-small", ["a"], { sleep });

    expect(result.ok).toBe(true);
  });

  it("uses exponential backoff delays between retries", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(apiError(429))
      .mockRejectedValueOnce(apiError(429))
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [0.1] }] });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await generateEmbeddings(fakeClient(create), "text-embedding-3-small", ["a"], { sleep, baseDelayMs: 100 });

    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });

  it("does not retry a non-retryable error (e.g. 400 bad request)", async () => {
    const create = vi.fn().mockRejectedValue(apiError(400));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await generateEmbeddings(fakeClient(create), "text-embedding-3-small", ["a"], { sleep });

    expect(result).toEqual({ ok: false, reason: "embedding-failed" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up and returns embedding-failed after exhausting maxRetries", async () => {
    const create = vi.fn().mockRejectedValue(apiError(429));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await generateEmbeddings(fakeClient(create), "text-embedding-3-small", ["a"], { sleep, maxRetries: 2 });

    expect(result).toEqual({ ok: false, reason: "embedding-failed" });
    expect(create).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("fails the whole call if any batch ultimately fails, rather than returning a partial result", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [0.1] }] })
      .mockRejectedValue(apiError(429));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await generateEmbeddings(fakeClient(create), "text-embedding-3-small", ["a", "b"], {
      batchSize: 1,
      sleep,
      maxRetries: 1,
    });

    expect(result).toEqual({ ok: false, reason: "embedding-failed" });
  });
});
