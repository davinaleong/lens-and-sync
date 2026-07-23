import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeImage } from "../../src/preprocessing/image-normalize.js";

async function jpegWithExif(
  width: number,
  height: number,
  exif: { orientation?: number; gps?: boolean },
): Promise<Buffer> {
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).jpeg();

  if (exif.orientation !== undefined) {
    pipeline = pipeline.withMetadata({ orientation: exif.orientation });
  } else if (exif.gps) {
    pipeline = pipeline.withMetadata();
  }

  return pipeline.toBuffer();
}

async function transparentPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
}

describe("normalizeImage", () => {
  it("re-encodes an opaque image as JPEG and strips EXIF metadata", async () => {
    const input = await jpegWithExif(40, 20, { gps: true });
    const result = await normalizeImage(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBe(40);
    expect(result.height).toBe(20);

    const outputMetadata = await sharp(result.buffer).metadata();
    expect(outputMetadata.exif).toBeUndefined();
  });

  it("re-encodes an image with an alpha channel as PNG instead of JPEG", async () => {
    const input = await transparentPng(30, 30);
    const result = await normalizeImage(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe("image/png");
  });

  it("applies EXIF orientation correction before dropping the tag, swapping dimensions for a 90-degree rotation", async () => {
    // Orientation 6 = rotate 90deg CW. A 40x20 source should become 20x40
    // once the rotation is baked into the pixels.
    const input = await jpegWithExif(40, 20, { orientation: 6 });
    const result = await normalizeImage(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.width).toBe(20);
    expect(result.height).toBe(40);

    const outputMetadata = await sharp(result.buffer).metadata();
    expect(outputMetadata.orientation ?? 1).toBe(1);
  });

  it("fails closed as undecodable rather than throwing on garbage input", async () => {
    const result = await normalizeImage(Buffer.from("not an image"));
    expect(result).toEqual({ ok: false, reason: "undecodable" });
  });
});
