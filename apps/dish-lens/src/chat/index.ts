import type Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "../session/session-store.js";
import type { DishContext } from "./dish-context.js";

// Only the one method callers need - same DI seam as recipe/index.ts's
// RecipeClient, testable against a hand-built fake.
export type ChatClient = Pick<Anthropic, "messages">;

export type ChatReplyResult = { ok: true; reply: string } | { ok: false; reason: "invalid-response" };

function systemPrompt(dish: DishContext): string {
  return `You are a friendly cooking assistant helping a user who just scanned a photo of "${dish.dishName}" in the DishLens app.

Here is the recipe they were shown:
Ingredients: ${dish.recipe.ingredients.join(", ")}
Steps: ${dish.recipe.steps.join(" ")}

Answer their questions about this dish - nutrition, ingredient substitutions, dietary adjustments, cooking technique, and similar. Keep answers concise and practical for a home cook. Stay focused on this dish and closely related cooking topics.`;
}

function extractText(message: Anthropic.Message): string | undefined {
  const block = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return block?.text;
}

export async function generateChatReply(
  client: ChatClient,
  model: string,
  dish: DishContext,
  history: ChatMessage[],
  userMessage: string,
): Promise<ChatReplyResult> {
  const message = await client.messages.create({
    model,
    max_tokens: 512,
    system: systemPrompt(dish),
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userMessage },
    ],
  });

  const text = extractText(message);
  if (!text) return { ok: false, reason: "invalid-response" };
  return { ok: true, reply: text };
}
