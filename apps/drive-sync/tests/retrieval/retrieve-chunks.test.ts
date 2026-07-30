import { describe, expect, it, vi } from "vitest";
import { retrieveChunks } from "../../src/retrieval/index.js";

function fakeEmbeddingClient(overrides: { create?: ReturnType<typeof vi.fn> } = {}) {
  const create = overrides.create ?? vi.fn().mockResolvedValue({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] });
  return { embeddings: { create } } as never;
}

function fakeVectorIndex(overrides: { query?: ReturnType<typeof vi.fn> } = {}) {
  return { query: overrides.query ?? vi.fn().mockResolvedValue({ matches: [] }) } as never;
}

describe("retrieveChunks", () => {
  it("embeds the query and passes the resulting vector to the index query", async () => {
    const create = vi.fn().mockResolvedValue({ data: [{ index: 0, embedding: [0.5, 0.6] }] });
    const query = vi.fn().mockResolvedValue({ matches: [] });

    await retrieveChunks(fakeEmbeddingClient({ create }), "text-embedding-3-small", fakeVectorIndex({ query }), "banana pancakes");

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ input: ["banana pancakes"] }));
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ vector: [0.5, 0.6], includeMetadata: true }));
  });

  it("defaults topK to 5 when not specified, and passes through a custom topK", async () => {
    const query = vi.fn().mockResolvedValue({ matches: [] });

    await retrieveChunks(fakeEmbeddingClient(), "text-embedding-3-small", fakeVectorIndex({ query }), "q");
    expect(query.mock.calls[0][0].topK).toBe(5);

    await retrieveChunks(fakeEmbeddingClient(), "text-embedding-3-small", fakeVectorIndex({ query }), "q", { topK: 3 });
    expect(query.mock.calls[1][0].topK).toBe(3);
  });

  it("maps matches to source-attribution fields only, never a raw text field", async () => {
    const query = vi.fn().mockResolvedValue({
      matches: [
        {
          id: "file-1-0",
          score: 0.91,
          metadata: { fileId: "file-1", title: "Banana Pancakes", chunkIndex: 0, sourceUrl: "https://drive/1", section: "Steps:" },
        },
      ],
    });

    const result = await retrieveChunks(fakeEmbeddingClient(), "text-embedding-3-small", fakeVectorIndex({ query }), "q");

    expect(result).toEqual({
      ok: true,
      chunks: [{ fileId: "file-1", title: "Banana Pancakes", chunkIndex: 0, sourceUrl: "https://drive/1", section: "Steps:", score: 0.91 }],
    });
    expect(Object.keys(result.ok ? result.chunks[0] : {})).not.toContain("text");
  });

  it("returns embedding-failed without ever calling the vector index if embedding the query fails", async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("bad request"), { status: 400 }));
    const query = vi.fn();

    const result = await retrieveChunks(fakeEmbeddingClient({ create }), "text-embedding-3-small", fakeVectorIndex({ query }), "q");

    expect(result).toEqual({ ok: false, reason: "embedding-failed" });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns query-failed rather than throwing when the vector index query rejects", async () => {
    const query = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await retrieveChunks(fakeEmbeddingClient(), "text-embedding-3-small", fakeVectorIndex({ query }), "q");

    expect(result).toEqual({ ok: false, reason: "query-failed" });
  });

  it("passes embeddingDimensions through to the embedding call", async () => {
    const create = vi.fn().mockResolvedValue({ data: [{ index: 0, embedding: [0.1] }] });

    await retrieveChunks(fakeEmbeddingClient({ create }), "text-embedding-3-small", fakeVectorIndex(), "q", { embeddingDimensions: 512 });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ dimensions: 512 }));
  });
});
