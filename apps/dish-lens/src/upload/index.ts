import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { isBlurry } from "../preprocessing/blur-detection.js";

// Allowlisted by real, sniffed magic bytes - never the client-supplied
// Content-Type or filename extension. HEIC/HEIF is accepted as input and
// converted downstream (see preprocessing/image-normalize.ts); everything
// else - including SVG, which is executable script - is rejected outright.
const ALLOWED_INPUT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export type UploadValidationResult =
  | { ok: true; mimeType: string; sizeBytes: number }
  | { ok: false; reason: "too-large"; sizeBytes: number; maxSizeBytes: number }
  | { ok: false; reason: "unrecognized-format" }
  | { ok: false; reason: "unsupported-format"; mimeType: string };

export async function validateUpload(
  buffer: Buffer,
  options: { maxSizeBytes: number },
): Promise<UploadValidationResult> {
  if (buffer.byteLength > options.maxSizeBytes) {
    return {
      ok: false,
      reason: "too-large",
      sizeBytes: buffer.byteLength,
      maxSizeBytes: options.maxSizeBytes,
    };
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    return { ok: false, reason: "unrecognized-format" };
  }

  if (!ALLOWED_INPUT_MIME_TYPES.has(detected.mime)) {
    return { ok: false, reason: "unsupported-format", mimeType: detected.mime };
  }

  return { ok: true, mimeType: detected.mime, sizeBytes: buffer.byteLength };
}

export type DimensionCheckResult =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: "unreadable-image" }
  | { ok: false; reason: "dimensions-too-large"; width: number; height: number; maxDimensionPx: number };

/**
 * Note: this environment's `sharp`/libvips build can only decode the AVIF
 * flavor of HEIF, not the HEVC-coded HEIC that iPhones actually produce
 * (HEVC decode is patent-encumbered and excluded from prebuilt libvips).
 * A real iPhone HEIC therefore fails closed here as "unreadable-image"
 * until `preprocessing/image-normalize.ts` converts it to JPEG/PNG first -
 * that conversion is still a TODO stub, so HEIC dimension-checking doesn't
 * fully work end-to-end yet even though the format is allowlisted.
 */
export async function checkImageDimensions(
  buffer: Buffer,
  options: { maxDimensionPx: number },
): Promise<DimensionCheckResult> {
  // No custom `limitInputPixels` here: tying it to `maxDimensionPx` squared
  // would reject the metadata read itself (by total area) for any image
  // that's oversized on just one side, before the friendlier per-side check
  // below gets a chance to run. Sharp's own default cap (~268M pixels,
  // comfortably above any real iPhone output) already guards against actual
  // decompression bombs; the per-side check is the real business rule.
  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ width, height } = await sharp(buffer).metadata());
  } catch {
    return { ok: false, reason: "unreadable-image" };
  }

  if (!width || !height) {
    return { ok: false, reason: "unreadable-image" };
  }

  if (width > options.maxDimensionPx || height > options.maxDimensionPx) {
    return { ok: false, reason: "dimensions-too-large", width, height, maxDimensionPx: options.maxDimensionPx };
  }

  return { ok: true, width, height };
}

export type UploadAssessment =
  | { ok: true; mimeType: string; sizeBytes: number; width: number; height: number }
  | { ok: false; reason: "too-large"; sizeBytes: number; maxSizeBytes: number }
  | { ok: false; reason: "unrecognized-format" }
  | { ok: false; reason: "unsupported-format"; mimeType: string }
  | { ok: false; reason: "unreadable-image" }
  | { ok: false; reason: "dimensions-too-large"; width: number; height: number; maxDimensionPx: number }
  | { ok: false; reason: "too-blurry"; varianceThreshold: number };

/**
 * Runs every upload check that doesn't need a live service, cheapest first:
 * magic-byte/size validation -> decoded pixel dimensions -> blur variance.
 * Short-circuits on the first failure so a garbage or oversized upload never
 * pays for a full decode + Laplacian convolution.
 */
export async function assessUpload(
  buffer: Buffer,
  options: { maxSizeBytes: number; maxDimensionPx: number; blurVarianceThreshold: number },
): Promise<UploadAssessment> {
  const validation = await validateUpload(buffer, { maxSizeBytes: options.maxSizeBytes });
  if (!validation.ok) {
    return validation;
  }

  const dimensions = await checkImageDimensions(buffer, { maxDimensionPx: options.maxDimensionPx });
  if (!dimensions.ok) {
    return dimensions;
  }

  if (await isBlurry(buffer, options.blurVarianceThreshold)) {
    return { ok: false, reason: "too-blurry", varianceThreshold: options.blurVarianceThreshold };
  }

  return {
    ok: true,
    mimeType: validation.mimeType,
    sizeBytes: validation.sizeBytes,
    width: dimensions.width,
    height: dimensions.height,
  };
}

// TODO: multer/multipart wiring is done (see routes/upload.ts) but
// pre-signed GCS upload URLs (random UUID object keys) are still not -
// this still routes the raw binary through the API server.
