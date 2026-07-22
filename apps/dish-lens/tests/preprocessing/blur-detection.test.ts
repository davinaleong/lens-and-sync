import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { isBlurry, laplacianVariance } from "../../src/preprocessing/blur-detection.js";

const SIZE = 64;
const CHANNELS = 3;

async function flatImage(): Promise<Buffer> {
  const raw = Buffer.alloc(SIZE * SIZE * CHANNELS, 128);
  return sharp(raw, { raw: { width: SIZE, height: SIZE, channels: CHANNELS } }).png().toBuffer();
}

async function checkerboardImage(): Promise<Buffer> {
  const raw = Buffer.alloc(SIZE * SIZE * CHANNELS);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const isWhite = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
      const value = isWhite ? 255 : 0;
      const idx = (y * SIZE + x) * CHANNELS;
      raw[idx] = value;
      raw[idx + 1] = value;
      raw[idx + 2] = value;
    }
  }
  return sharp(raw, { raw: { width: SIZE, height: SIZE, channels: CHANNELS } }).png().toBuffer();
}

describe("laplacianVariance", () => {
  it("is near zero for a uniform flat image (no edges)", async () => {
    const variance = await laplacianVariance(await flatImage());
    expect(variance).toBeLessThan(1);
  });

  it("is high for a high-frequency checkerboard (many edges)", async () => {
    const variance = await laplacianVariance(await checkerboardImage());
    expect(variance).toBeGreaterThan(1000);
  });

  it("drops after Gaussian blur is applied to the same sharp image", async () => {
    const sharpImage = await checkerboardImage();
    const blurredImage = await sharp(sharpImage).blur(8).toBuffer();

    const sharpVariance = await laplacianVariance(sharpImage);
    const blurredVariance = await laplacianVariance(blurredImage);

    expect(blurredVariance).toBeLessThan(sharpVariance);
  });
});

describe("isBlurry", () => {
  it("flags a flat image as blurry against a realistic threshold", async () => {
    await expect(isBlurry(await flatImage(), 100)).resolves.toBe(true);
  });

  it("does not flag a sharp checkerboard as blurry against a realistic threshold", async () => {
    await expect(isBlurry(await checkerboardImage(), 100)).resolves.toBe(false);
  });
});
