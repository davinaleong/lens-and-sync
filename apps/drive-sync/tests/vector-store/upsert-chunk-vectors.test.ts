import { describe, expect, it, vi } from "vitest";
import { upsertChunkVectors, vectorId, type ChunkVector } from "../../src/vector-store/index.js";

function fakeIndex(upsert: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined)) {
  return { upsert } as never;
}

function chunkVector(overrides: Partial<ChunkVector> = {}): ChunkVector {
  return {
    fileId: "file-1",
    chunkIndex: 0,
    title: "Test Recipe",
    sourceUrl: "https://drive.google.com/file/d/file-1/view",
    section: "Ingredients:",
    embedding: [0.1, 0.2, 0.3],
    ...overrides,
  };
}

describe("vectorId", () => {
  it("is a deterministic {fileId}-{chunkIndex} scheme", () => {
    expect(vectorId("abc123", 0)).toBe("abc123-0");
    expect(vectorId("abc123", 7)).toBe("abc123-7");
  });

  it("produces the same ID for the same file/chunkIndex across calls - stable across re-syncs", () => {
    expect(vectorId("abc123", 3)).toBe(vectorId("abc123", 3));
  });
});

describe("upsertChunkVectors", () => {
  it("returns ok with count 0 for an empty vector list, without calling the API", async () => {
    const upsert = vi.fn();
    const result = await upsertChunkVectors(fakeIndex(upsert), []);

    expect(result).toEqual({ ok: true, count: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upserts each vector with the stable {fileId}-{chunkIndex} ID and full metadata", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const vector = chunkVector();

    await upsertChunkVectors(fakeIndex(upsert), [vector]);

    expect(upsert).toHaveBeenCalledWith([
      {
        id: "file-1-0",
        values: [0.1, 0.2, 0.3],
        metadata: {
          fileId: "file-1",
          title: "Test Recipe",
          chunkIndex: 0,
          sourceUrl: "https://drive.google.com/file/d/file-1/view",
          section: "Ingredients:",
        },
      },
    ]);
  });

  it("stores a null section as an empty string, never null (Pinecone metadata has no null type)", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);

    await upsertChunkVectors(fakeIndex(upsert), [chunkVector({ section: null })]);

    expect(upsert.mock.calls[0][0][0].metadata.section).toBe("");
  });

  it("never includes the chunk's raw text in metadata - only IDs/titles/retrieval fields", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);

    await upsertChunkVectors(fakeIndex(upsert), [chunkVector()]);

    const metadata = upsert.mock.calls[0][0][0].metadata;
    expect(Object.keys(metadata).sort()).toEqual(["chunkIndex", "fileId", "section", "sourceUrl", "title"]);
  });

  it("splits a large vector list into multiple batched upsert calls", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const vectors = Array.from({ length: 5 }, (_, i) => chunkVector({ chunkIndex: i }));

    const result = await upsertChunkVectors(fakeIndex(upsert), vectors, { batchSize: 2 });

    expect(upsert).toHaveBeenCalledTimes(3); // [0,1], [2,3], [4]
    expect(result).toEqual({ ok: true, count: 5 });
  });

  it("returns upsert-failed rather than throwing when the API call rejects", async () => {
    const upsert = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await upsertChunkVectors(fakeIndex(upsert), [chunkVector()]);

    expect(result).toEqual({ ok: false, reason: "upsert-failed" });
  });
});
