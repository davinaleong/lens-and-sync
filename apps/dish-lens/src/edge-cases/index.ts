import type { VisionLabel } from "../vision/index.js";

export interface DishCandidate {
  label: string;
  confidence: number;
}

export type DishClassification =
  | { ok: true; dishName: string; confidence: number }
  | { ok: false; reason: "non-dish" }
  | { ok: false; reason: "low-confidence" | "multi-dish"; candidates: DishCandidate[] };

export interface DishClassificationThresholds {
  dishConfidenceThreshold: number;
  foodEvidenceThreshold: number;
}

// Vision's label detection returns category-level labels ("Food", "Dish",
// "Cuisine") alongside specific ones ("Pizza", "Sushi"). A category label
// proves the photo is food-related but can never *name* the dish.
const CATEGORY_LABELS = new Set([
  "food", "dish", "cuisine", "recipe", "ingredient", "cooking", "meal",
  "comfort food", "baked goods", "dessert", "fast food", "staple food",
  "side dish", "finger food", "superfood", "whole food", "natural foods",
  "meal preparation",
]);

// Raw ingredients are food-related but not a *finished dish* - milestone #6
// explicitly calls out egg/carrot as "non-dish", not "unidentifiable dish".
const RAW_INGREDIENT_LABELS = new Set([
  "egg", "eggs", "carrot", "tomato", "onion", "garlic", "potato", "lettuce",
  "meat", "chicken", "beef", "pork", "fish", "rice", "bread", "cheese",
  "fruit", "vegetable", "spinach", "broccoli", "pepper", "mushroom", "herb",
  "spice", "milk", "butter", "flour", "seafood", "poultry",
]);

// Present on almost every plated-food photo but never food evidence or a
// dish name themselves - counting them either way would let an empty-plate
// photo slip past the "non-dish" gate.
const IGNORED_LABELS = new Set([
  "plate", "tableware", "person", "dishware", "cutlery", "table",
  "restaurant", "kitchen", "cookware and bakeware",
]);

function normalize(description: string): string {
  return description.trim().toLowerCase();
}

// Heuristic, not a business rule handed down from a spec - Vision has no
// built-in "is this one prepared dish" signal, so this composes what it does
// return (generic category labels, raw-ingredient labels, everything else)
// into the four outcomes the milestone/security checklists require. Real
// photo fixtures (still absent - see `04-testing-checklist.md`) will be
// needed to calibrate the threshold defaults; this has only been verified
// against mocked label sets modeled on Vision's documented behavior.
export function classifyDish(labels: VisionLabel[], thresholds: DishClassificationThresholds): DishClassification {
  const normalized = labels.map((label) => ({ ...label, key: normalize(label.description) }));

  const hasFoodEvidence = normalized.some(
    (label) => CATEGORY_LABELS.has(label.key) && label.score >= thresholds.foodEvidenceThreshold,
  );
  const hasRawIngredientEvidence = normalized.some(
    (label) => RAW_INGREDIENT_LABELS.has(label.key) && label.score >= thresholds.dishConfidenceThreshold,
  );

  if (!hasFoodEvidence && !hasRawIngredientEvidence) {
    return { ok: false, reason: "non-dish" };
  }

  const specificLabels = normalized
    .filter(
      (label) =>
        !CATEGORY_LABELS.has(label.key) &&
        !RAW_INGREDIENT_LABELS.has(label.key) &&
        !IGNORED_LABELS.has(label.key),
    )
    .sort((a, b) => b.score - a.score);

  const dishCandidates = specificLabels.filter((label) => label.score >= thresholds.dishConfidenceThreshold);

  if (dishCandidates.length > 1) {
    return {
      ok: false,
      reason: "multi-dish",
      candidates: dishCandidates.slice(0, 5).map((c) => ({ label: c.description, confidence: c.score })),
    };
  }

  if (dishCandidates.length === 1) {
    const top = dishCandidates[0]!;
    return { ok: true, dishName: top.description, confidence: top.score };
  }

  // Food-related evidence exists, but nothing specific enough cleared the
  // dish-confidence bar.
  if (hasRawIngredientEvidence) {
    return { ok: false, reason: "non-dish" };
  }
  // Below-threshold specific labels (if any) still make reasonable relabel
  // suggestions even though none were confident enough to auto-accept.
  return {
    ok: false,
    reason: "low-confidence",
    candidates: specificLabels.slice(0, 5).map((c) => ({ label: c.description, confidence: c.score })),
  };
}
