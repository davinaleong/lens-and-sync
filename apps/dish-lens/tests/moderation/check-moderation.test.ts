import { describe, expect, it } from "vitest";
import { checkModeration } from "../../src/moderation/index.js";
import type { SafeSearchResult } from "../../src/vision/index.js";

function safeSearch(overrides: Partial<SafeSearchResult> = {}): SafeSearchResult {
  return {
    adult: "VERY_UNLIKELY",
    violence: "VERY_UNLIKELY",
    racy: "VERY_UNLIKELY",
    medical: "VERY_UNLIKELY",
    spoof: "VERY_UNLIKELY",
    ...overrides,
  };
}

describe("checkModeration", () => {
  it("allows a clean image through", () => {
    expect(checkModeration(safeSearch())).toEqual({ ok: true });
  });

  it("allows POSSIBLE likelihoods through - too common on ordinary food photos to block on", () => {
    expect(checkModeration(safeSearch({ racy: "POSSIBLE", violence: "POSSIBLE" }))).toEqual({ ok: true });
  });

  it.each(["LIKELY", "VERY_LIKELY"] as const)("blocks on adult=%s", (likelihood) => {
    expect(checkModeration(safeSearch({ adult: likelihood }))).toEqual({
      ok: false,
      reason: "inappropriate-content",
    });
  });

  it.each(["LIKELY", "VERY_LIKELY"] as const)("blocks on violence=%s", (likelihood) => {
    expect(checkModeration(safeSearch({ violence: likelihood }))).toEqual({
      ok: false,
      reason: "inappropriate-content",
    });
  });

  it.each(["LIKELY", "VERY_LIKELY"] as const)("blocks on racy=%s", (likelihood) => {
    expect(checkModeration(safeSearch({ racy: likelihood }))).toEqual({
      ok: false,
      reason: "inappropriate-content",
    });
  });

  it("never blocks on medical or spoof likelihoods, however high", () => {
    expect(checkModeration(safeSearch({ medical: "VERY_LIKELY", spoof: "VERY_LIKELY" }))).toEqual({ ok: true });
  });
});
