import { describe, expect, it, vi } from "vitest";
import type { VisionAnnotateClient } from "../../src/vision/index.js";
import { analyzeImage } from "../../src/vision/index.js";

function fakeClient(response: object): VisionAnnotateClient {
  return { annotateImage: vi.fn().mockResolvedValue([response]) } as unknown as VisionAnnotateClient;
}

describe("analyzeImage", () => {
  it("maps label annotations to description/score pairs", async () => {
    const client = fakeClient({
      labelAnnotations: [
        { description: "Pizza", score: 0.92 },
        { description: "Food", score: 0.88 },
      ],
      safeSearchAnnotation: {
        adult: "VERY_UNLIKELY",
        violence: "VERY_UNLIKELY",
        racy: "UNLIKELY",
        medical: "UNLIKELY",
        spoof: "UNLIKELY",
      },
    });

    const result = await analyzeImage(client, Buffer.from("fake-image-bytes"));

    expect(result.labels).toEqual([
      { description: "Pizza", score: 0.92 },
      { description: "Food", score: 0.88 },
    ]);
    expect(result.safeSearch).toEqual({
      adult: "VERY_UNLIKELY",
      violence: "VERY_UNLIKELY",
      racy: "UNLIKELY",
      medical: "UNLIKELY",
      spoof: "UNLIKELY",
    });
  });

  it("sends both LABEL_DETECTION and SAFE_SEARCH_DETECTION in a single request", async () => {
    const client = fakeClient({ labelAnnotations: [], safeSearchAnnotation: {} });

    await analyzeImage(client, Buffer.from("fake-image-bytes"));

    expect(client.annotateImage).toHaveBeenCalledTimes(1);
    const request = vi.mocked(client.annotateImage).mock.calls[0][0] as {
      features: { type: string }[];
    };
    const featureTypes = request.features.map((f) => f.type);
    expect(featureTypes).toContain("LABEL_DETECTION");
    expect(featureTypes).toContain("SAFE_SEARCH_DETECTION");
  });

  it("defaults to empty labels and UNKNOWN likelihoods when Vision returns nothing", async () => {
    const client = fakeClient({});

    const result = await analyzeImage(client, Buffer.from("fake-image-bytes"));

    expect(result.labels).toEqual([]);
    expect(result.safeSearch).toEqual({
      adult: "UNKNOWN",
      violence: "UNKNOWN",
      racy: "UNKNOWN",
      medical: "UNKNOWN",
      spoof: "UNKNOWN",
    });
  });
});
