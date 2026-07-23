import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { assessUpload, checkImageDimensions } from "../../src/upload/index.js";

const DEFAULT_OPTIONS = {
  maxSizeBytes: 20 * 1024 * 1024,
  maxDimensionPx: 8192,
  blurVarianceThreshold: 100,
};

async function sharpJpeg(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isWhite = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
      const value = isWhite ? 255 : 0;
      const idx = (y * width + x) * 3;
      raw[idx] = value;
      raw[idx + 1] = value;
      raw[idx + 2] = value;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

async function flatPng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } } })
    .png()
    .toBuffer();
}

describe("checkImageDimensions", () => {
  it("accepts an image within the max dimension", async () => {
    const result = await checkImageDimensions(await flatPng(32, 32), { maxDimensionPx: 8192 });
    expect(result).toEqual({ ok: true, width: 32, height: 32 });
  });

  it("rejects an image wider or taller than the max dimension", async () => {
    const result = await checkImageDimensions(await flatPng(100, 50), { maxDimensionPx: 64 });
    expect(result).toEqual({
      ok: false,
      reason: "dimensions-too-large",
      width: 100,
      height: 50,
      maxDimensionPx: 64,
    });
  });

  it("rejects an undecodable buffer as unreadable rather than throwing", async () => {
    const result = await checkImageDimensions(Buffer.from("not an image"), { maxDimensionPx: 8192 });
    expect(result).toEqual({ ok: false, reason: "unreadable-image" });
  });
});

describe("assessUpload", () => {
  it("accepts a sharp, correctly-sized, allowlisted image", async () => {
    const result = await assessUpload(await sharpJpeg(64, 64), DEFAULT_OPTIONS);
    expect(result).toEqual({
      ok: true,
      mimeType: "image/jpeg",
      sizeBytes: expect.any(Number),
      width: 64,
      height: 64,
    });
  });

  it("short-circuits on format rejection before touching dimensions/blur", async () => {
    const result = await assessUpload(Buffer.from("plain text"), DEFAULT_OPTIONS);
    expect(result).toEqual({ ok: false, reason: "unrecognized-format" });
  });

  it("rejects an oversized-dimension image after it passes format/size checks", async () => {
    const result = await assessUpload(await flatPng(200, 200), { ...DEFAULT_OPTIONS, maxDimensionPx: 100 });
    expect(result).toEqual({
      ok: false,
      reason: "dimensions-too-large",
      width: 200,
      height: 200,
      maxDimensionPx: 100,
    });
  });

  it("rejects a blurry image that passes format and dimension checks", async () => {
    const result = await assessUpload(await flatPng(64, 64), DEFAULT_OPTIONS);
    expect(result).toEqual({ ok: false, reason: "too-blurry", varianceThreshold: 100 });
  });
});
