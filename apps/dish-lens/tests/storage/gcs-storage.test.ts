import { describe, expect, it, vi } from "vitest";
import { getSignedReadUrl, uploadNormalizedImage } from "../../src/storage/index.js";

function fakeBucket(overrides: { save?: ReturnType<typeof vi.fn>; getSignedUrl?: ReturnType<typeof vi.fn> } = {}) {
  const save = overrides.save ?? vi.fn().mockResolvedValue(undefined);
  const getSignedUrl = overrides.getSignedUrl ?? vi.fn().mockResolvedValue(["https://signed.example/object"]);
  const file = vi.fn().mockReturnValue({ save, getSignedUrl });
  return { file, save, getSignedUrl } as unknown as {
    file: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    getSignedUrl: ReturnType<typeof vi.fn>;
  };
}

describe("uploadNormalizedImage", () => {
  it("uploads under a random UUID key with the correct extension and content type", async () => {
    const bucket = fakeBucket();
    const buffer = Buffer.from("fake-jpeg-bytes");

    const result = await uploadNormalizedImage(bucket as never, buffer, "image/jpeg");

    expect(result.objectKey).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(bucket.file).toHaveBeenCalledWith(result.objectKey);
    expect(bucket.save).toHaveBeenCalledWith(
      buffer,
      expect.objectContaining({ contentType: "image/jpeg", resumable: false }),
    );
  });

  it("uses a .png extension for PNG output and never reuses a filename across calls", async () => {
    const bucket = fakeBucket();

    const first = await uploadNormalizedImage(bucket as never, Buffer.from("a"), "image/png");
    const second = await uploadNormalizedImage(bucket as never, Buffer.from("b"), "image/png");

    expect(first.objectKey).toMatch(/\.png$/);
    expect(second.objectKey).toMatch(/\.png$/);
    expect(first.objectKey).not.toBe(second.objectKey);
  });

  it("never sets public/ACL options - objects stay private by default", async () => {
    const bucket = fakeBucket();

    await uploadNormalizedImage(bucket as never, Buffer.from("x"), "image/jpeg");

    const saveOptions = bucket.save.mock.calls[0][1];
    expect(saveOptions).not.toHaveProperty("public");
    expect(saveOptions).not.toHaveProperty("predefinedAcl");
  });
});

describe("getSignedReadUrl", () => {
  it("requests a v4 read-scoped signed URL with an expiry in the future", async () => {
    const bucket = fakeBucket();
    const before = Date.now();

    const url = await getSignedReadUrl(bucket as never, "some-object.jpg", 3600);

    expect(url).toBe("https://signed.example/object");
    expect(bucket.file).toHaveBeenCalledWith("some-object.jpg");
    const options = bucket.getSignedUrl.mock.calls[0][0];
    expect(options.action).toBe("read");
    expect(options.version).toBe("v4");
    expect(options.expires).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });
});
