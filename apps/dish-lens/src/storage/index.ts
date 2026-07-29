import { randomUUID } from "node:crypto";
import type { Bucket } from "@google-cloud/storage";

export type NormalizedMimeType = "image/jpeg" | "image/png";

const EXTENSION_BY_MIME_TYPE: Record<NormalizedMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

export interface StoredImage {
  objectKey: string;
}

/**
 * Uploads an already-normalized (re-encoded, EXIF-stripped) image buffer
 * under a random UUID object key - never the client-supplied filename, and
 * never derived from dish/user data, so keys are non-guessable and carry no
 * PII themselves. No `public: true` / ACL grant is set on the object - the
 * bucket has no public access, so a key alone doesn't grant a read; the
 * only read path is `getSignedReadUrl` below.
 *
 * Takes `bucket` as a parameter (same dependency-injection shape as
 * `vision/index.ts`'s client and `session/session-store.ts`'s `redis`) so
 * this is unit-testable against a hand-built fake bucket, no real GCS
 * credentials or network needed for tests.
 */
export async function uploadNormalizedImage(
  bucket: Bucket,
  buffer: Buffer,
  mimeType: NormalizedMimeType,
): Promise<StoredImage> {
  const objectKey = `${randomUUID()}.${EXTENSION_BY_MIME_TYPE[mimeType]}`;
  const file = bucket.file(objectKey);
  await file.save(buffer, {
    contentType: mimeType,
    resumable: false,
    metadata: { cacheControl: "no-store" },
  });
  return { objectKey };
}

/**
 * Signed, time-limited read URL - stored images are never served from a
 * public bucket/object (`01-security-checklist.md` §5: "keep any stored
 * images private by default; signed, expiring URLs only").
 */
export async function getSignedReadUrl(bucket: Bucket, objectKey: string, expirySeconds: number): Promise<string> {
  const [url] = await bucket.file(objectKey).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expirySeconds * 1000,
  });
  return url;
}
