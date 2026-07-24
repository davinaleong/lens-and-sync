import type { ImageAnnotatorClient } from "@google-cloud/vision";

export interface VisionLabel {
  description: string;
  score: number;
}

export interface SafeSearchResult {
  adult: string;
  violence: string;
  racy: string;
  medical: string;
  spoof: string;
}

export interface VisionAnalysis {
  labels: VisionLabel[];
  safeSearch: SafeSearchResult;
}

// Only the one method callers actually need - keeps this testable against a
// hand-built fake instead of a full ImageAnnotatorClient mock.
export type VisionAnnotateClient = Pick<ImageAnnotatorClient, "annotateImage">;

const UNKNOWN_LIKELIHOOD = "UNKNOWN";

// Both features in one call: label detection (dish name candidates) and
// SafeSearch (moderation) share the same Vision request/cost, per
// `06-toolchain-decisions.md` - no separate NSFW provider.
export async function analyzeImage(client: VisionAnnotateClient, imageBuffer: Buffer): Promise<VisionAnalysis> {
  const [result] = await client.annotateImage({
    image: { content: imageBuffer },
    features: [
      { type: "LABEL_DETECTION", maxResults: 15 },
      { type: "SAFE_SEARCH_DETECTION" },
    ],
  });

  const labels: VisionLabel[] = (result.labelAnnotations ?? []).map((label) => ({
    description: label.description ?? "",
    score: label.score ?? 0,
  }));

  const annotation = result.safeSearchAnnotation;
  const safeSearch: SafeSearchResult = {
    adult: (annotation?.adult as string | undefined) ?? UNKNOWN_LIKELIHOOD,
    violence: (annotation?.violence as string | undefined) ?? UNKNOWN_LIKELIHOOD,
    racy: (annotation?.racy as string | undefined) ?? UNKNOWN_LIKELIHOOD,
    medical: (annotation?.medical as string | undefined) ?? UNKNOWN_LIKELIHOOD,
    spoof: (annotation?.spoof as string | undefined) ?? UNKNOWN_LIKELIHOOD,
  };

  return { labels, safeSearch };
}
