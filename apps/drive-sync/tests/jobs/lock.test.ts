import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { acquireSyncLock, releaseSyncLock } from "../../src/jobs/lock.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const TEST_KEY = "test:drive-sync:lock";

beforeEach(async () => {
  await redis.del(TEST_KEY);
});

afterAll(async () => {
  await redis.del(TEST_KEY);
  await redis.quit();
});

describe("acquireSyncLock / releaseSyncLock (real Redis)", () => {
  it("acquires a lock when none is held", async () => {
    const lock = await acquireSyncLock(redis, TEST_KEY, 5000);

    expect(lock).not.toBeNull();
    expect(lock?.key).toBe(TEST_KEY);
  });

  it("fails to acquire while another lock is held (returns null, not an error)", async () => {
    const first = await acquireSyncLock(redis, TEST_KEY, 5000);
    expect(first).not.toBeNull();

    const second = await acquireSyncLock(redis, TEST_KEY, 5000);

    expect(second).toBeNull();
  });

  it("allows a new acquire after the holder releases it", async () => {
    const first = await acquireSyncLock(redis, TEST_KEY, 5000);
    await releaseSyncLock(redis, first!);

    const second = await acquireSyncLock(redis, TEST_KEY, 5000);

    expect(second).not.toBeNull();
  });

  it("expires on its own after the TTL elapses, without an explicit release", async () => {
    await acquireSyncLock(redis, TEST_KEY, 200);

    await new Promise((resolve) => setTimeout(resolve, 350));

    const second = await acquireSyncLock(redis, TEST_KEY, 5000);
    expect(second).not.toBeNull();
  });

  it("does not release a lock it doesn't own (compare-and-delete safety)", async () => {
    const real = await acquireSyncLock(redis, TEST_KEY, 5000);
    const forged = { key: TEST_KEY, token: "not-the-real-token" };

    await releaseSyncLock(redis, forged);

    // The real lock should still be held - a second real acquire attempt fails.
    const attempt = await acquireSyncLock(redis, TEST_KEY, 5000);
    expect(attempt).toBeNull();
    expect(real).not.toBeNull();
  });
});
