import { z } from "zod";
import type { ChatMessage } from "../session/session-store.js";

// Matches the JSON blob POST /upload appends as a session's first
// (assistant) message - see routes/upload.ts. Not real conversational
// content, just the recipe/nutrition result the session was seeded from.
export const dishContextSchema = z.object({
  dishName: z.string(),
  recipe: z.object({
    dishName: z.string(),
    ingredients: z.array(z.string()),
    steps: z.array(z.string()),
  }),
});

export type DishContext = z.infer<typeof dishContextSchema>;

export function extractDishContext(seedMessage: ChatMessage | undefined): DishContext | null {
  if (!seedMessage) return null;
  try {
    const parsed = dishContextSchema.safeParse(JSON.parse(seedMessage.content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
