import { describe, expect, it } from "vitest";
import { extractDishContext } from "../../src/chat/dish-context.js";
import type { ChatMessage } from "../../src/session/session-store.js";

function seedMessage(content: string): ChatMessage {
  return { role: "assistant", content, createdAt: "2026-08-01T00:00:00.000Z" };
}

describe("extractDishContext", () => {
  it("parses the JSON blob POST /upload seeds a session with", () => {
    const message = seedMessage(
      JSON.stringify({
        dishName: "Margherita Pizza",
        confidence: 0.92,
        recipe: { dishName: "Margherita Pizza", ingredients: ["dough"], steps: ["Bake."] },
        nutrition: null,
        imageObjectKey: null,
      }),
    );

    expect(extractDishContext(message)).toEqual({
      dishName: "Margherita Pizza",
      recipe: { dishName: "Margherita Pizza", ingredients: ["dough"], steps: ["Bake."] },
    });
  });

  it("returns null for a message that isn't JSON", () => {
    expect(extractDishContext(seedMessage("Hi there!"))).toBeNull();
  });

  it("returns null for JSON missing the expected shape", () => {
    expect(extractDishContext(seedMessage(JSON.stringify({ foo: "bar" })))).toBeNull();
  });

  it("returns null when there is no seed message at all", () => {
    expect(extractDishContext(undefined)).toBeNull();
  });
});
