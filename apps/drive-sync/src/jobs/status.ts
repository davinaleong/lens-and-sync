import type { Redis } from "ioredis";
import type { SyncRunResult } from "./index.js";

const STATUS_KEY = "drivesync:last-sync-status";

export interface SyncStatus {
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  result: SyncRunResult | null;
  error: string | null;
}

/**
 * The last-sync-status endpoint's backing store (Milestone #11). A single
 * Redis key holding the most recent run's outcome - deliberately not a
 * new Postgres table/migration for what's just one small, frequently-
 * overwritten JSON blob, matching how this codebase already uses Redis
 * for other small coordination state (locks, rate limits, sessions)
 * rather than Postgres. Only the *latest* run is kept; this is a live
 * status check, not a sync history/audit log.
 */
export async function writeSyncStatus(redis: Redis, status: SyncStatus): Promise<void> {
  await redis.set(STATUS_KEY, JSON.stringify(status));
}

export async function readSyncStatus(redis: Redis): Promise<SyncStatus | null> {
  const raw = await redis.get(STATUS_KEY);
  return raw ? (JSON.parse(raw) as SyncStatus) : null;
}
