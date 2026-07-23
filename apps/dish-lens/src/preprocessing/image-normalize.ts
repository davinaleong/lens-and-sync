import sharp from "sharp";

export type NormalizeResult =
  | { ok: true; buffer: Buffer; mimeType: "image/jpeg" | "image/png"; width: number; height: number }
  | { ok: false; reason: "undecodable" };

/**
 * Re-encodes an already-validated upload: `.rotate()` (no args) reads the
 * EXIF Orientation tag and bakes the correct rotation into the pixel data
 * *before* metadata is dropped - doing it in the other order would leave
 * images sideways once the orientation tag they depended on is gone. All
 * other metadata (GPS, device info, ICC/XMP) is stripped by simply not
 * requesting it on output - sharp only carries metadata forward if
 * `.withMetadata()` is explicitly called. Images with an alpha channel are
 * re-encoded as PNG (JPEG has no transparency); everything else becomes
 * JPEG.
 *
 * Note: this environment's libvips can only decode the AVIF flavor of
 * HEIF, not the HEVC-coded HEIC real iPhones produce (see
 * `upload/index.ts`'s `checkImageDimensions` for the same caveat) - a real
 * HEIC buffer fails closed here as `undecodable` rather than throwing.
 */
export async function normalizeImage(buffer: Buffer): Promise<NormalizeResult> {
  try {
    const metadata = await sharp(buffer).metadata();
    const outputFormat = metadata.hasAlpha ? ("png" as const) : ("jpeg" as const);

    const pipeline = sharp(buffer).rotate();
    const { data, info } =
      outputFormat === "png"
        ? await pipeline.png().toBuffer({ resolveWithObject: true })
        : await pipeline.jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });

    return {
      ok: true,
      buffer: data,
      mimeType: outputFormat === "png" ? "image/png" : "image/jpeg",
      width: info.width,
      height: info.height,
    };
  } catch {
    return { ok: false, reason: "undecodable" };
  }
}
