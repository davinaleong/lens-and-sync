import { fileTypeFromBuffer } from "file-type";

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

// TODO: multer/multipart wiring, pixel-dimension limits (needs a decoded
// image, not just the buffer), and pre-signed GCS upload URLs (random UUID
// object keys) once this is wired into a real route.
