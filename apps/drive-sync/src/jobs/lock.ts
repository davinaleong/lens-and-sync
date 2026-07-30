import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

export interface SyncLock {
  key: string;
  token: string;
}

/**
 * Redis-backed mutex preventing overlapping sync runs
 * (`01-security-checklist.md` §4: "sync job locking prevents concurrent
 * runs from producing conflicting writes"). A BullMQ `Worker` with
 * `concurrency: 1` already serializes jobs pulled from its own queue, but
 * that alone doesn't stop a manually-triggered run from overlapping a
 * scheduled one, or (if this app is ever scaled to multiple instances)
 * two workers racing on the same logical sync. This lock is the actual
 * safety net.
 *
 * `SET key token PX ttlMs NX` - atomic acquire-if-absent. Returns `null`
 * (not an error) if another run already holds the lock, so a caller can
 * simply skip this run rather than treating contention as a failure.
 */
export async function acquireSyncLock(redis: Redis, key: string, ttlMs: number): Promise<SyncLock | null> {
  const token = randomUUID();
  const result = await redis.set(key, token, "PX", ttlMs, "NX");
  return result === "OK" ? { key, token } : null;
}

// Compare-and-delete, not a bare DEL - if this lock's TTL already expired
// and a *different* run acquired it in the meantime, a bare DEL would
// release someone else's lock instead of safely no-op'ing.
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export async function releaseSyncLock(redis: Redis, lock: SyncLock): Promise<void> {
  await redis.eval(RELEASE_LOCK_SCRIPT, 1, lock.key, lock.token);
}
