import { describe, expect, it, vi } from "vitest";
import type { RecipeClient } from "../../src/recipe/index.js";
import { generateRecipe } from "../../src/recipe/index.js";

function fakeClient(responseText: string): RecipeClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: responseText }] }),
    },
  } as unknown as RecipeClient;
}

describe("generateRecipe", () => {
  it("parses a well-formed JSON recipe response", async () => {
    const client = fakeClient(
      JSON.stringify({
        dishName: "Margherita Pizza",
        ingredients: ["pizza dough", "tomato sauce", "mozzarella", "basil"],
        steps: ["Preheat oven to 475F.", "Top dough with sauce, cheese, and basil.", "Bake 10-12 minutes."],
      }),
    );

    const result = await generateRecipe(client, "claude-sonnet-5", "Margherita Pizza");

    expect(result).toEqual({
      ok: true,
      recipe: {
        dishName: "Margherita Pizza",
        ingredients: ["pizza dough", "tomato sauce", "mozzarella", "basil"],
        steps: ["Preheat oven to 475F.", "Top dough with sauce, cheese, and basil.", "Bake 10-12 minutes."],
      },
    });
  });

  it("sends the dish name and model through to the API call", async () => {
    const client = fakeClient(
      JSON.stringify({ dishName: "Tacos", ingredients: ["tortilla"], steps: ["Assemble."] }),
    );

    await generateRecipe(client, "claude-sonnet-5", "Tacos");

    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5",
        messages: [{ role: "user", content: "Dish: Tacos" }],
      }),
    );
  });

  it("rejects as invalid-response when the reply isn't JSON", async () => {
    const client = fakeClient("Sure! Here's a great recipe for that:\n\nIngredients: ...");

    const result = await generateRecipe(client, "claude-sonnet-5", "Tacos");

    expect(result).toEqual({ ok: false, reason: "invalid-response" });
  });

  it("rejects as invalid-response when JSON is well-formed but missing required fields", async () => {
    const client = fakeClient(JSON.stringify({ dishName: "Tacos" }));

    const result = await generateRecipe(client, "claude-sonnet-5", "Tacos");

    expect(result).toEqual({ ok: false, reason: "invalid-response" });
  });

  it("rejects as invalid-response when there is no text content block at all", async () => {
    const client: RecipeClient = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "tool_use" }] }) },
    } as unknown as RecipeClient;

    const result = await generateRecipe(client, "claude-sonnet-5", "Tacos");

    expect(result).toEqual({ ok: false, reason: "invalid-response" });
  });
});
