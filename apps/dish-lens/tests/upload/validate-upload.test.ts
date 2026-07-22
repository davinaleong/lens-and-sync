import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { validateUpload } from "../../src/upload/index.js";

const SIZE = 16;

async function pngBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: SIZE, height: SIZE, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

async function jpegBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: SIZE, height: SIZE, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .jpeg()
    .toBuffer();
}

async function tiffBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: SIZE, height: SIZE, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .tiff()
    .toBuffer();
}

const DEFAULT_MAX_SIZE = 20 * 1024 * 1024;

describe("validateUpload", () => {
  it("accepts a real PNG by its magic bytes", async () => {
    const result = await validateUpload(await pngBuffer(), { maxSizeBytes: DEFAULT_MAX_SIZE });
    expect(result).toEqual({ ok: true, mimeType: "image/png", sizeBytes: expect.any(Number) });
  });

  it("accepts a real JPEG by its magic bytes", async () => {
    const result = await validateUpload(await jpegBuffer(), { maxSizeBytes: DEFAULT_MAX_SIZE });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mimeType).toBe("image/jpeg");
    }
  });

  it("rejects a renamed non-image file even with a plausible extension", async () => {
    const fakeImage = Buffer.from("this is plain text pretending to be a photo");
    const result = await validateUpload(fakeImage, { maxSizeBytes: DEFAULT_MAX_SIZE });
    expect(result).toEqual({ ok: false, reason: "unrecognized-format" });
  });

  it("never accepts SVG, since it's executable script rather than an image", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const result = await validateUpload(svg, { maxSizeBytes: DEFAULT_MAX_SIZE });
    expect(result.ok).toBe(false);
  });

  it("rejects a recognized-but-not-allowlisted format (TIFF)", async () => {
    const result = await validateUpload(await tiffBuffer(), { maxSizeBytes: DEFAULT_MAX_SIZE });
    expect(result).toEqual({ ok: false, reason: "unsupported-format", mimeType: "image/tiff" });
  });

  it("rejects a file that exceeds the size limit, even a valid PNG", async () => {
    const buffer = await pngBuffer();
    const result = await validateUpload(buffer, { maxSizeBytes: buffer.byteLength - 1 });
    expect(result).toEqual({
      ok: false,
      reason: "too-large",
      sizeBytes: buffer.byteLength,
      maxSizeBytes: buffer.byteLength - 1,
    });
  });
});
