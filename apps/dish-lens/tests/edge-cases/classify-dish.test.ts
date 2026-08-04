import { describe, expect, it } from "vitest";
import { classifyDish, type DishClassificationThresholds } from "../../src/edge-cases/index.js";
import type { VisionLabel } from "../../src/vision/index.js";

const thresholds: DishClassificationThresholds = {
  dishConfidenceThreshold: 0.6,
  foodEvidenceThreshold: 0.5,
};

function label(description: string, score: number): VisionLabel {
  return { description, score };
}

describe("classifyDish", () => {
  it("accepts a single clear dish alongside generic food category labels", () => {
    const labels = [label("Pizza", 0.92), label("Food", 0.88), label("Dish", 0.7)];
    expect(classifyDish(labels, thresholds)).toEqual({ ok: true, dishName: "Pizza", confidence: 0.92 });
  });

  it("rejects as multi-dish when two distinct specific labels both clear the threshold, carrying both as candidates", () => {
    const labels = [label("Pizza", 0.88), label("Salad", 0.75), label("Food", 0.9)];
    expect(classifyDish(labels, thresholds)).toEqual({
      ok: false,
      reason: "multi-dish",
      candidates: [
        { label: "Pizza", confidence: 0.88 },
        { label: "Salad", confidence: 0.75 },
      ],
    });
  });

  it("rejects a raw ingredient (egg) as non-dish, not as an unidentified dish", () => {
    const labels = [label("Egg", 0.95), label("Food", 0.6)];
    expect(classifyDish(labels, thresholds)).toEqual({ ok: false, reason: "non-dish" });
  });

  it("rejects a raw ingredient (carrot) as non-dish even with no category label present", () => {
    const labels = [label("Carrot", 0.9)];
    expect(classifyDish(labels, thresholds)).toEqual({ ok: false, reason: "non-dish" });
  });

  it("rejects an empty plate / place setting as non-dish", () => {
    const labels = [label("Plate", 0.93), label("Tableware", 0.85)];
    expect(classifyDish(labels, thresholds)).toEqual({ ok: false, reason: "non-dish" });
  });

  it("rejects a person photo as non-dish", () => {
    const labels = [label("Person", 0.97), label("Smile", 0.6)];
    expect(classifyDish(labels, thresholds)).toEqual({ ok: false, reason: "non-dish" });
  });

  it("rejects a completely unrelated photo as non-dish", () => {
    const labels = [label("Vehicle", 0.9), label("Car", 0.85)];
    expect(classifyDish(labels, thresholds)).toEqual({ ok: false, reason: "non-dish" });
  });

  it("rejects as low-confidence when food evidence exists but no specific label clears the bar, with no candidates to offer", () => {
    const labels = [label("Food", 0.55), label("Dish", 0.52)];
    expect(classifyDish(labels, thresholds)).toEqual({ ok: false, reason: "low-confidence", candidates: [] });
  });

  it("rejects as low-confidence when the only specific label falls just under the dish threshold, offering it as a candidate anyway", () => {
    const labels = [label("Food", 0.7), label("Pasta", 0.55)];
    expect(classifyDish(labels, thresholds)).toEqual({
      ok: false,
      reason: "low-confidence",
      candidates: [{ label: "Pasta", confidence: 0.55 }],
    });
  });

  it("accepts a dish with a garnish/side described only by generic labels (single specific candidate)", () => {
    const labels = [label("Steak", 0.85), label("Food", 0.9), label("Side dish", 0.6), label("Cuisine", 0.65)];
    expect(classifyDish(labels, thresholds)).toEqual({ ok: true, dishName: "Steak", confidence: 0.85 });
  });
});
