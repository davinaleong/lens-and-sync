import { z } from "zod";

export interface NutritionCredentials {
  appId: string;
  appKey: string;
}

export interface NutritionSummary {
  calories: number;
  totalWeightGrams: number;
  proteinGrams: number;
  fatGrams: number;
  carbsGrams: number;
}

export type NutritionLookupResult =
  | { ok: true; nutrition: NutritionSummary }
  | { ok: false; reason: "lookup-failed" | "no-nutrition-data" };

// Edamam's Nutrition Analysis API does not reliably return the top-level
// aggregate fields (`calories`, `totalWeight`, `totalNutrients`) documented
// for it - verified live, this account's responses omit them entirely.
// What it *does* always return is a per-ingredient breakdown, so this
// aggregates client-side from `ingredients[].parsed[].nutrients` instead of
// trusting a top-level total that may not be there.
const nutrientValueSchema = z.object({ quantity: z.number() }).partial();
const parsedIngredientSchema = z
  .object({
    weight: z.number(),
    nutrients: z
      .object({
        ENERC_KCAL: nutrientValueSchema.optional(),
        PROCNT: nutrientValueSchema.optional(),
        FAT: nutrientValueSchema.optional(),
        CHOCDF: nutrientValueSchema.optional(),
      })
      .partial()
      .optional(),
  })
  .partial();
const edamamResponseSchema = z.object({
  ingredients: z.array(
    z.object({
      text: z.string(),
      parsed: z.array(parsedIngredientSchema).optional(),
    }),
  ),
});

type ParsedIngredient = z.infer<typeof parsedIngredientSchema>;

function sumNutrient(ingredients: { parsed?: ParsedIngredient[] }[], key: "ENERC_KCAL" | "PROCNT" | "FAT" | "CHOCDF"): number {
  return ingredients.reduce((sum, ingredient) => {
    const matches = ingredient.parsed ?? [];
    return sum + matches.reduce((matchSum, match) => matchSum + (match.nutrients?.[key]?.quantity ?? 0), 0);
  }, 0);
}

function sumWeight(ingredients: { parsed?: ParsedIngredient[] }[]): number {
  return ingredients.reduce((sum, ingredient) => {
    const matches = ingredient.parsed ?? [];
    return sum + matches.reduce((matchSum, match) => matchSum + (match.weight ?? 0), 0);
  }, 0);
}

// Node's global `fetch` type, taken as a parameter (not imported directly)
// so tests can inject a fake without touching the network - same
// dependency-injection seam as `vision/index.ts`'s `VisionAnnotateClient`
// and `recipe/index.ts`'s `RecipeClient`.
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const EDAMAM_NUTRITION_URL = "https://api.edamam.com/api/nutrition-details";

export async function lookupNutrition(
  fetchFn: FetchLike,
  credentials: NutritionCredentials,
  dishName: string,
  ingredients: string[],
): Promise<NutritionLookupResult> {
  const url = `${EDAMAM_NUTRITION_URL}?app_id=${encodeURIComponent(credentials.appId)}&app_key=${encodeURIComponent(credentials.appKey)}`;

  const response = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: dishName, ingr: ingredients }),
  });

  if (!response.ok) {
    return { ok: false, reason: "lookup-failed" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "lookup-failed" };
  }

  const parsed = edamamResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, reason: "no-nutrition-data" };
  }

  const calories = sumNutrient(parsed.data.ingredients, "ENERC_KCAL");
  if (calories <= 0) {
    return { ok: false, reason: "no-nutrition-data" };
  }

  return {
    ok: true,
    nutrition: {
      calories,
      totalWeightGrams: sumWeight(parsed.data.ingredients),
      proteinGrams: sumNutrient(parsed.data.ingredients, "PROCNT"),
      fatGrams: sumNutrient(parsed.data.ingredients, "FAT"),
      carbsGrams: sumNutrient(parsed.data.ingredients, "CHOCDF"),
    },
  };
}
