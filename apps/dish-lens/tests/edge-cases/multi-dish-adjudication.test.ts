import { describe, expect, it, vi } from "vitest";
import type { AdjudicationClient, AdjudicationImage } from "../../src/edge-cases/multi-dish-adjudication.js";
import { adjudicateMultiDish } from "../../src/edge-cases/multi-dish-adjudication.js";

function fakeClient(responseText: string): AdjudicationClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: responseText }] }),
    },
  } as unknown as AdjudicationClient;
}

const CANDIDATES = [
  { label: "Pasta", confidence: 0.94 },
  { label: "Bolognese sauce", confidence: 0.84 },
  { label: "Spaghetti", confidence: 0.79 },
];

const IMAGE: AdjudicationImage = { buffer: Buffer.from("fake-jpeg-bytes"), mediaType: "image/jpeg" };

describe("adjudicateMultiDish", () => {
  it("overrides to a single dish when the model says the photo shows one dish", async () => {
    const client = fakeClient(JSON.stringify({ isSingleDish: true, dishName: "Spaghetti Bolognese" }));

    const result = await adjudicateMultiDish(client, "claude-sonnet-5", IMAGE, CANDIDATES);

    expect(result).toEqual({ ok: true, isSingleDish: true, dishName: "Spaghetti Bolognese" });
  });

  it("keeps the multi-dish verdict when the model agrees the photo shows separate dishes", async () => {
    const client = fakeClient(JSON.stringify({ isSingleDish: false, dishName: null }));

    const result = await adjudicateMultiDish(client, "claude-sonnet-5", IMAGE, CANDIDATES);

    expect(result).toEqual({ ok: true, isSingleDish: false });
  });

  it("sends the image and candidate labels through to the API call", async () => {
    const client = fakeClient(JSON.stringify({ isSingleDish: false, dishName: null }));

    await adjudicateMultiDish(client, "claude-sonnet-5", IMAGE, CANDIDATES);

    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: IMAGE.buffer.toString("base64") },
              },
              {
                type: "text",
                text: "Detected labels:\n- Pasta (confidence 0.94)\n- Bolognese sauce (confidence 0.84)\n- Spaghetti (confidence 0.79)",
              },
            ],
          },
        ],
      }),
    );
  });

  it("rejects as invalid-response when isSingleDish is true but dishName is missing", async () => {
    const client = fakeClient(JSON.stringify({ isSingleDish: true, dishName: null }));

    const result = await adjudicateMultiDish(client, "claude-sonnet-5", IMAGE, CANDIDATES);

    expect(result).toEqual({ ok: false, reason: "invalid-response" });
  });

  it("rejects as invalid-response when the reply isn't JSON", async () => {
    const client = fakeClient("Sure, let me take a look at that photo...");

    const result = await adjudicateMultiDish(client, "claude-sonnet-5", IMAGE, CANDIDATES);

    expect(result).toEqual({ ok: false, reason: "invalid-response" });
  });

  it("rejects as invalid-response when there is no text content block at all", async () => {
    const client: AdjudicationClient = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "tool_use" }] }) },
    } as unknown as AdjudicationClient;

    const result = await adjudicateMultiDish(client, "claude-sonnet-5", IMAGE, CANDIDATES);

    expect(result).toEqual({ ok: false, reason: "invalid-response" });
  });
});
