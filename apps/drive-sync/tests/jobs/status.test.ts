import { Redis } from "ioredis";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { readSyncStatus, writeSyncStatus, type SyncStatus } from "../../src/jobs/status.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function sampleStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    startedAt: "2026-07-30T00:00:00.000Z",
    finishedAt: "2026-07-30T00:00:05.000Z",
    ok: true,
    result: { newFiles: 1, updatedFiles: 0, skippedUnchanged: 0, deletedFiles: 0, failures: [] },
    error: null,
    ...overrides,
  };
}

afterEach(async () => {
  await redis.del("drivesync:last-sync-status");
});

afterAll(async () => {
  await redis.quit();
});

describe("writeSyncStatus / readSyncStatus (real Redis)", () => {
  it("returns null before any status has ever been written", async () => {
    expect(await readSyncStatus(redis)).toBeNull();
  });

  it("round-trips a written status exactly", async () => {
    const status = sampleStatus();

    await writeSyncStatus(redis, status);

    expect(await readSyncStatus(redis)).toEqual(status);
  });

  it("overwrites the previous status rather than accumulating history", async () => {
    await writeSyncStatus(redis, sampleStatus({ ok: true, error: null }));
    await writeSyncStatus(redis, sampleStatus({ ok: false, result: null, error: "boom" }));

    const status = await readSyncStatus(redis);
    expect(status?.ok).toBe(false);
    expect(status?.error).toBe("boom");
  });

  it("round-trips a failure status with per-file failures included", async () => {
    const status = sampleStatus({
      result: { newFiles: 0, updatedFiles: 0, skippedUnchanged: 0, deletedFiles: 0, failures: [{ fileId: "f1", reason: "extraction-failed" }] },
    });

    await writeSyncStatus(redis, status);

    const read = await readSyncStatus(redis);
    expect(read?.result?.failures).toEqual([{ fileId: "f1", reason: "extraction-failed" }]);
  });
});
