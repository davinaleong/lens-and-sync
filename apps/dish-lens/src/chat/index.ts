import type Anthropic from "@anthropic-ai/sdk";
import type { PersonalRecipe } from "../drive-sync-client/index.js";
import type { ChatMessage } from "../session/session-store.js";
import type { DishContext } from "./dish-context.js";

// Only the one method callers need - same DI seam as recipe/index.ts's
// RecipeClient, testable against a hand-built fake.
export type ChatClient = Pick<Anthropic, "messages">;

export type ChatReplyResult = { ok: true; reply: string } | { ok: false; reason: "invalid-response" };

// Recipe text from a synced Google Doc can be long - capped so one
// personal recipe can't crowd out the actual conversation in the prompt.
const MAX_PERSONAL_RECIPE_CHARS = 4000;

function systemPrompt(dish: DishContext | null, personalRecipe: PersonalRecipe | null): string {
  const personalRecipeSection = personalRecipe
    ? `\n\nThe user also has their own saved recipe that may be relevant, titled "${personalRecipe.title}":\n${personalRecipe.text.slice(0, MAX_PERSONAL_RECIPE_CHARS)}\n\nPrefer this over inventing a generic version when it's actually relevant to what they're asking - mention it's from their own saved recipes when you use it.`
    : "";

  if (!dish) {
    return `You are a friendly cooking assistant in the DishLens app. This conversation isn't tied to any specific scanned dish - the user is asking general recipe, cooking, or nutrition questions.${personalRecipeSection}

Answer their questions about recipes, ingredient substitutions, dietary adjustments, cooking technique, meal planning, and nutrition. Keep answers concise and practical for a home cook.`;
  }

  return `You are a friendly cooking assistant helping a user who just scanned a photo of "${dish.dishName}" in the DishLens app.

Here is the recipe they were shown:
Ingredients: ${dish.recipe.ingredients.join(", ")}
Steps: ${dish.recipe.steps.join(" ")}
${personalRecipeSection}

Answer their questions about this dish - nutrition, ingredient substitutions, dietary adjustments, cooking technique, and similar. Keep answers concise and practical for a home cook. Stay focused on this dish and closely related cooking topics.`;
}

function extractText(message: Anthropic.Message): string | undefined {
  const block = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return block?.text;
}

export async function generateChatReply(
  client: ChatClient,
  model: string,
  dish: DishContext | null,
  history: ChatMessage[],
  userMessage: string,
  personalRecipe: PersonalRecipe | null = null,
): Promise<ChatReplyResult> {
  const message = await client.messages.create({
    model,
    max_tokens: 512,
    system: systemPrompt(dish, personalRecipe),
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userMessage },
    ],
  });

  const text = extractText(message);
  if (!text) return { ok: false, reason: "invalid-response" };
  return { ok: true, reply: text };
}
