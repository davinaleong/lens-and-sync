import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { extractText } from "../recipe/extract-text.js";
import type { DishCandidate } from "./index.js";

// Only the one method callers need - same DI seam as recipe/index.ts's
// RecipeClient, testable against a hand-built fake.
export type AdjudicationClient = Pick<Anthropic, "messages">;

// Claude's image input only accepts these four - narrower than the set of
// formats this app accepts on upload (which also allows heic/heif).
// Callers with an unsupported format should skip adjudication entirely
// rather than call this with an image Claude can't read.
export type AdjudicationImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface AdjudicationImage {
  buffer: Buffer;
  mediaType: AdjudicationImageMediaType;
}

export type MultiDishAdjudicationResult =
  | { ok: true; isSingleDish: true; dishName: string }
  | { ok: true; isSingleDish: false }
  | { ok: false; reason: "invalid-response" };

const SYSTEM_PROMPT = `You are a food photo classifier. You'll be shown a food photo, along with a list of labels an image-recognition model separately detected in it. Those labels can be incomplete or imprecise (e.g. generic terms like "Bowl" or "Serveware", or lexically different names for the same dish) - treat them as a hint, not the primary evidence. Judge from the photo itself.

Decide whether the photo shows ONE finished, servable dish (even if it has multiple visible components plated together, like a meat, a starch, a sauce, and a garnish) or GENUINELY MULTIPLE separate dishes (e.g. a spread of several different dishes side by side, each independently servable).

Respond with ONLY a JSON object in exactly this shape, no markdown code fences, no commentary before or after:
{"isSingleDish": boolean, "dishName": string | null}

If isSingleDish is true, dishName must be your best real-world name for the dish - prefer a specific, natural dish name over reusing a generic label verbatim. If isSingleDish is false, dishName must be null.`;

const adjudicationSchema = z.object({
  isSingleDish: z.boolean(),
  dishName: z.string().min(1).nullable(),
});

// A second opinion for the ambiguous case classifyDish's own word-overlap
// heuristic can't resolve - Vision often returns lexically unrelated labels
// for one composite dish (e.g. "Pasta", "Bolognese sauce", "Spaghetti" for a
// single plate of spaghetti bolognese), which no plain string-matching rule
// can tell apart from a photo of genuinely separate dishes. Sends the actual
// photo, not just the label list - an earlier text-only version of this
// wrongly accepted a real multi-dish spread ("Bowl", "Serveware", "Kitchen
// utensil" gave it almost nothing to go on) as a single "mixed vegetable
// bowl". Only called for the specific case classifyDish flags as ambiguous,
// not every upload, to keep the common case fast and cheap.
export async function adjudicateMultiDish(
  client: AdjudicationClient,
  model: string,
  image: AdjudicationImage,
  candidates: DishCandidate[],
): Promise<MultiDishAdjudicationResult> {
  const labelList = candidates.map((c) => `- ${c.label} (confidence ${c.confidence.toFixed(2)})`).join("\n");

  const message = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.buffer.toString("base64") },
          },
          { type: "text", text: `Detected labels:\n${labelList}` },
        ],
      },
    ],
  });

  const text = extractText(message);
  if (!text) {
    return { ok: false, reason: "invalid-response" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-response" };
  }

  const result = adjudicationSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: "invalid-response" };
  }

  if (!result.data.isSingleDish) {
    return { ok: true, isSingleDish: false };
  }
  if (!result.data.dishName) {
    return { ok: false, reason: "invalid-response" };
  }
  return { ok: true, isSingleDish: true, dishName: result.data.dishName };
}
