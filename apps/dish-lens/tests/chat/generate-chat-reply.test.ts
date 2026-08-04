import { describe, expect, it, vi } from "vitest";
import type { ChatClient } from "../../src/chat/index.js";
import { generateChatReply } from "../../src/chat/index.js";
import type { DishContext } from "../../src/chat/dish-context.js";

const dish: DishContext = {
  dishName: "Margherita Pizza",
  recipe: {
    dishName: "Margherita Pizza",
    ingredients: ["pizza dough", "tomato sauce", "mozzarella", "basil"],
    steps: ["Preheat oven to 475F.", "Top dough with sauce, cheese, and basil.", "Bake 10-12 minutes."],
  },
};

function fakeClient(responseText: string): ChatClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: responseText }] }),
    },
  } as unknown as ChatClient;
}

describe("generateChatReply", () => {
  it("returns the model's reply text", async () => {
    const client = fakeClient("You could swap mozzarella for a dairy-free alternative.");

    const result = await generateChatReply(client, "claude-sonnet-5", dish, [], "Can I make this dairy-free?");

    expect(result).toEqual({ ok: true, reply: "You could swap mozzarella for a dairy-free alternative." });
  });

  it("sends prior real turns plus the new user message, excluding the JSON seed message entirely", async () => {
    const client = fakeClient("Sure!");
    const history = [
      { role: "user" as const, content: "Can I make this vegan?", createdAt: "2026-08-01T00:00:00.000Z" },
      { role: "assistant" as const, content: "Swap mozzarella for a plant-based cheese.", createdAt: "2026-08-01T00:00:01.000Z" },
    ];

    await generateChatReply(client, "claude-sonnet-5", dish, history, "What about the dough?");

    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5",
        messages: [
          { role: "user", content: "Can I make this vegan?" },
          { role: "assistant", content: "Swap mozzarella for a plant-based cheese." },
          { role: "user", content: "What about the dough?" },
        ],
      }),
    );
  });

  it("includes the dish name and recipe in the system prompt", async () => {
    const client = fakeClient("Sure!");

    await generateChatReply(client, "claude-sonnet-5", dish, [], "Tell me more");

    const call = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.system).toContain("Margherita Pizza");
    expect(call.system).toContain("mozzarella");
  });

  it("rejects as invalid-response when there is no text content block", async () => {
    const client: ChatClient = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "tool_use" }] }) },
    } as unknown as ChatClient;

    const result = await generateChatReply(client, "claude-sonnet-5", dish, [], "Hi");

    expect(result).toEqual({ ok: false, reason: "invalid-response" });
  });
});
