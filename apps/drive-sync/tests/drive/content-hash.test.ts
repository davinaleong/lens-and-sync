import { describe, expect, it } from "vitest";
import { computeContentHash, shouldReembedFile } from "../../src/drive/index.js";

describe("computeContentHash", () => {
  it("produces the same hash for identical text", () => {
    expect(computeContentHash("Ingredients: flour, sugar")).toBe(computeContentHash("Ingredients: flour, sugar"));
  });

  it("produces a different hash when the text differs", () => {
    expect(computeContentHash("Ingredients: flour, sugar")).not.toBe(computeContentHash("Ingredients: flour, sugar, eggs"));
  });

  it("is sensitive to whitespace-only differences (exact text hash, not a semantic hash)", () => {
    expect(computeContentHash("a\nb")).not.toBe(computeContentHash("a\n\nb"));
  });

  it("produces a hex-encoded sha256 (64 hex characters)", () => {
    expect(computeContentHash("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("shouldReembedFile", () => {
  it("returns true when there is no known prior hash (new file, or synced before hashing existed)", () => {
    expect(shouldReembedFile("hash-a", null)).toBe(true);
  });

  it("returns true when the new hash differs from the known one", () => {
    expect(shouldReembedFile("hash-b", "hash-a")).toBe(true);
  });

  it("returns false when the new hash matches the known one - real content is unchanged", () => {
    expect(shouldReembedFile("hash-a", "hash-a")).toBe(false);
  });
});
