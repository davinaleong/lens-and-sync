import { describe, expect, it } from "vitest";
import { chunkText } from "../../src/chunking/index.js";

const SOURCE = { fileId: "file-1", title: "Test Recipe" };

describe("chunkText", () => {
  it("returns a single chunk for text well under the token budget", () => {
    const chunks = chunkText("A short recipe.\nJust a few lines.", SOURCE, { chunkSizeTokens: 400, overlapTokens: 60 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].fileId).toBe("file-1");
    expect(chunks[0].title).toBe("Test Recipe");
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it("returns no chunks for empty or whitespace-only text", () => {
    expect(chunkText("", SOURCE, {})).toEqual([]);
    expect(chunkText("   \n\n  ", SOURCE, {})).toEqual([]);
  });

  it("splits into multiple chunks once the text exceeds chunkSizeTokens", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `This is line number ${i} with a bit of extra padding text.`);
    const chunks = chunkText(lines.join("\n"), SOURCE, { chunkSizeTokens: 100, overlapTokens: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(100 + 20); // budget + one line's worth of slack
    }
  });

  it("assigns sequential, zero-based chunkIndex values", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i} of padding text to force multiple chunks here.`);
    const chunks = chunkText(lines.join("\n"), SOURCE, { chunkSizeTokens: 80, overlapTokens: 10 });

    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("carries overlapping content into the start of the next chunk", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Distinct line marker ${i}.`);
    const chunks = chunkText(lines.join("\n"), SOURCE, { chunkSizeTokens: 60, overlapTokens: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    // The end of chunk 0 and the start of chunk 1 should share at least
    // one line, since overlapTokens > 0.
    const endOfFirst = chunks[0].text.split("\n").at(-1);
    expect(chunks[1].text).toContain(endOfFirst as string);
  });

  it("produces no overlap when overlapTokens is 0", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Distinct line marker ${i}.`);
    const chunks = chunkText(lines.join("\n"), SOURCE, { chunkSizeTokens: 60, overlapTokens: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    const endOfFirst = chunks[0].text.split("\n").at(-1);
    expect(chunks[1].text).not.toContain(endOfFirst as string);
  });

  it("tracks the most recent heading-like line (bare trailing colon) as each chunk's section", () => {
    const text = ["Ingredients:", "flour", "sugar", "eggs", "Instructions:", "mix", "bake", "cool"].join("\n");

    const chunks = chunkText(text, SOURCE, { chunkSizeTokens: 5, overlapTokens: 0 });

    const sections = chunks.map((c) => c.section);
    expect(sections[0]).toBe("Ingredients:");
    expect(sections.at(-1)).toBe("Instructions:");
  });

  it("does not treat a Key: value metadata line as a section heading", () => {
    const text = ["Category: Main Course", "Cuisine: Western", "Ingredients:", "flour"].join("\n");

    // Small chunkSizeTokens so "flour" lands in a chunk that starts right
    // after "Ingredients:" - if "Category:"/"Cuisine:" were misdetected as
    // headings, this chunk's section would reflect one of those instead.
    const chunks = chunkText(text, SOURCE, { chunkSizeTokens: 3, overlapTokens: 0 });

    expect(chunks.at(-1)?.section).toBe("Ingredients:");
  });

  it("keeps an oversized single line as its own chunk rather than dropping or truncating it", () => {
    const longLine = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(`short line\n${longLine}\nanother short line`, SOURCE, { chunkSizeTokens: 20, overlapTokens: 5 });

    const longChunk = chunks.find((c) => c.text === longLine);
    expect(longChunk).toBeDefined();
    expect(longChunk?.tokenCount).toBeGreaterThan(20);
  });
});
