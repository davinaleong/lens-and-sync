import type { SafeSearchResult } from "../vision/index.js";

export type ModerationResult = { ok: true } | { ok: false; reason: "inappropriate-content" };

// Vision's Likelihood enum: UNKNOWN, VERY_UNLIKELY, UNLIKELY, POSSIBLE, LIKELY,
// VERY_LIKELY. POSSIBLE is deliberately allowed through - it fires on plenty
// of ordinary food photos (e.g. "racy: POSSIBLE" on a photo of ribs) and
// blocking on it would reject too much legitimate content; LIKELY/VERY_LIKELY
// is the line the checklist's "before processing" gate sits on.
const BLOCKED_LIKELIHOODS = new Set(["LIKELY", "VERY_LIKELY"]);

// medical/spoof are deliberately excluded - neither indicates inappropriate
// content, just "this looks like a medical image" or "this is a meme/joke
// image", which aren't moderation concerns for a dish photo upload.
export function checkModeration(safeSearch: SafeSearchResult): ModerationResult {
  const blocked =
    BLOCKED_LIKELIHOODS.has(safeSearch.adult) ||
    BLOCKED_LIKELIHOODS.has(safeSearch.violence) ||
    BLOCKED_LIKELIHOODS.has(safeSearch.racy);

  return blocked ? { ok: false, reason: "inappropriate-content" } : { ok: true };
}
