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
// "Lunch"/"Delicacy" etc. are the same kind of non-specific label under a
// different guise - confirmed against real photo fixtures
// (`_internal-docs/11-test-image-mapping.md`), where Vision returned "Lunch"
// and "Delicacy" alongside genuine rice labels for a chicken rice photo.
const CATEGORY_LABELS = new Set([
  "food", "dish", "cuisine", "recipe", "ingredient", "cooking", "meal",
  "comfort food", "baked goods", "dessert", "fast food", "staple food",
  "side dish", "finger food", "superfood", "whole food", "natural foods",
  "meal preparation", "lunch", "delicacy",
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
// photo slip past the "non-dish" gate. "Garnish" joined this list after a
// real chicken rice photo (`_internal-docs/11-test-image-mapping.md`) got a
// false "multi-dish" rejection: Vision labelled the garnish alongside the
// dish itself, and nothing in the label text ties it back to that dish.
const IGNORED_LABELS = new Set([
  "plate", "tableware", "person", "dishware", "cutlery", "table",
  "restaurant", "kitchen", "cookware and bakeware", "garnish",
]);

function normalize(description: string): string {
  return description.trim().toLowerCase();
}

function wordsOf(label: string): Set<string> {
  return new Set(label.split(/\s+/).filter(Boolean));
}

// Vision often returns several labels for one composite dish - a proper
// noun for the dish itself ("Hainanese chicken rice") plus labels for its
// visible components ("Cooked rice", "White cut chicken") - rather than one
// label per photo. Those component labels share a word with the top
// candidate; a genuinely separate second dish on the same plate does not.
// Confirmed against real photo fixtures
// (`_internal-docs/11-test-image-mapping.md`): a single-dish chicken rice
// photo was previously misclassified as "multi-dish" because counting any
// two above-threshold labels (regardless of overlap) was too blunt.
function sharesWordWith(anchor: string, other: string): boolean {
  const anchorWords = wordsOf(anchor);
  for (const word of wordsOf(other)) {
    if (anchorWords.has(word)) return true;
  }
  return false;
}

// Heuristic, not a business rule handed down from a spec - Vision has no
// built-in "is this one prepared dish" signal, so this composes what it does
// return (generic category labels, raw-ingredient labels, everything else)
// into the four outcomes the milestone/security checklists require. Verified
// against real photo fixtures in `_internal-docs/11-test-image-mapping.md`.
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

  const [topCandidate, ...otherCandidates] = dishCandidates;
  const distinctOtherCandidates = topCandidate
    ? otherCandidates.filter((c) => !sharesWordWith(topCandidate.key, c.key))
    : [];

  if (topCandidate && distinctOtherCandidates.length > 0) {
    return {
      ok: false,
      reason: "multi-dish",
      candidates: dishCandidates.slice(0, 5).map((c) => ({ label: c.description, confidence: c.score })),
    };
  }

  if (topCandidate) {
    return { ok: true, dishName: topCandidate.description, confidence: topCandidate.score };
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
