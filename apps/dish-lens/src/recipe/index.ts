import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const recipeSchema = z.object({
  dishName: z.string().min(1),
  ingredients: z.array(z.string().min(1)).min(1),
  steps: z.array(z.string().min(1)).min(1),
});

export type Recipe = z.infer<typeof recipeSchema>;

export type RecipeGenerationResult = { ok: true; recipe: Recipe } | { ok: false; reason: "invalid-response" };

// Only the one method callers need - same DI seam as `vision/index.ts`'s
// `VisionAnnotateClient`, so this is testable against a hand-built fake.
export type RecipeClient = Pick<Anthropic, "messages">;

const SYSTEM_PROMPT = `You are a home cooking assistant. Given a dish name, generate a realistic recipe for it.

Constraints:
- Only ingredients available at a typical grocery store - no specialty/hard-to-find items.
- Only common home kitchen equipment (stove, oven, standard pots/pans/knives/baking dishes) - no sous-vide, smokers, tempering machines, or other specialty equipment.
- Steps must be clear, sequential, and actionable for a home cook.

Respond with ONLY a JSON object in exactly this shape, no markdown code fences, no commentary before or after:
{"dishName": string, "ingredients": string[], "steps": string[]}`;

function extractText(message: Anthropic.Message): string | undefined {
  const textBlock = message.content.find((block): block is Anthropic.TextBlock => block.type === "text");
  return textBlock?.text;
}

export async function generateRecipe(client: RecipeClient, model: string, dishName: string): Promise<RecipeGenerationResult> {
  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Dish: ${dishName}` }],
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

  const result = recipeSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: "invalid-response" };
  }

  return { ok: true, recipe: result.data };
}
