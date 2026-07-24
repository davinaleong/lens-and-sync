import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../src/nutrition/index.js";
import { lookupNutrition } from "../../src/nutrition/index.js";

const credentials = { appId: "test-app-id", appKey: "test-app-key" };

function fakeFetch(status: number, body: unknown): FetchLike {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as FetchLike;
}

// Mirrors the real (live-verified) Edamam Nutrition Analysis response shape:
// per-ingredient `parsed` entries, no top-level aggregate fields.
function nutrients(kcal: number, protein: number, fat: number, carbs: number) {
  return {
    ENERC_KCAL: { quantity: kcal, unit: "kcal" },
    PROCNT: { quantity: protein, unit: "g" },
    FAT: { quantity: fat, unit: "g" },
    CHOCDF: { quantity: carbs, unit: "g" },
  };
}

describe("lookupNutrition", () => {
  it("sums per-ingredient nutrients into an overall summary", async () => {
    const fetchFn = fakeFetch(200, {
      ingredients: [
        { text: "pizza dough", parsed: [{ weight: 453.6, nutrients: nutrients(1174.8, 43.0, 12.4, 218.2) }] },
        { text: "mozzarella cheese", parsed: [{ weight: 226.8, nutrients: nutrients(720.5, 50.1, 55.3, 6.8) }] },
      ],
    });

    const result = await lookupNutrition(fetchFn, credentials, "Margherita Pizza", ["pizza dough", "mozzarella cheese"]);

    expect(result).toEqual({
      ok: true,
      nutrition: {
        calories: 1174.8 + 720.5,
        totalWeightGrams: 453.6 + 226.8,
        proteinGrams: 43.0 + 50.1,
        fatGrams: 12.4 + 55.3,
        carbsGrams: 218.2 + 6.8,
      },
    });
  });

  it("sends the dish title and ingredient list as the request body", async () => {
    const fetchFn = fakeFetch(200, { ingredients: [] });

    await lookupNutrition(fetchFn, credentials, "Tacos", ["tortilla", "beef"]);

    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("api.edamam.com/api/nutrition-details"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Tacos", ingr: ["tortilla", "beef"] }),
      }),
    );
  });

  it("treats an unmatched ingredient (empty parsed array) as contributing zero", async () => {
    const fetchFn = fakeFetch(200, {
      ingredients: [
        { text: "tortilla", parsed: [{ weight: 30, nutrients: nutrients(90, 2, 1, 15) }] },
        { text: "some unrecognized garnish", parsed: [] },
      ],
    });

    const result = await lookupNutrition(fetchFn, credentials, "Tacos", ["tortilla", "some unrecognized garnish"]);

    expect(result).toEqual({
      ok: true,
      nutrition: { calories: 90, totalWeightGrams: 30, proteinGrams: 2, fatGrams: 1, carbsGrams: 15 },
    });
  });

  it("rejects as lookup-failed on a non-2xx response", async () => {
    const fetchFn = fakeFetch(401, { error: "Unauthorized" });

    const result = await lookupNutrition(fetchFn, credentials, "Tacos", ["tortilla"]);

    expect(result).toEqual({ ok: false, reason: "lookup-failed" });
  });

  it("rejects as no-nutrition-data when no ingredient matched (zero total calories)", async () => {
    const fetchFn = fakeFetch(200, { ingredients: [{ text: "tortilla", parsed: [] }] });

    const result = await lookupNutrition(fetchFn, credentials, "Tacos", ["tortilla"]);

    expect(result).toEqual({ ok: false, reason: "no-nutrition-data" });
  });

  it("rejects as no-nutrition-data when the response shape doesn't match at all", async () => {
    const fetchFn = fakeFetch(200, { unexpected: "shape" });

    const result = await lookupNutrition(fetchFn, credentials, "Tacos", ["tortilla"]);

    expect(result).toEqual({ ok: false, reason: "no-nutrition-data" });
  });
});
