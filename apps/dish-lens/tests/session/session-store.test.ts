import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSessionStore } from "../../src/session/session-store.js";

// Requires a real, reachable Redis - same instance CI already runs as a
// service container (see .github/workflows/ci.yml) and that
// infra/docker-compose.yml provides for local dev. TTL/expiry behavior
// can't be trustworthily verified against a mock.
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const USER_A = "test-user-a";
const USER_B = "test-user-b";

describe("session-store", () => {
  let redis: Redis;
  const createdKeys: string[] = [];

  beforeAll(() => {
    redis = new Redis(REDIS_URL);
  });

  afterEach(async () => {
    if (createdKeys.length > 0) {
      await redis.del(...createdKeys);
      createdKeys.length = 0;
    }
  });

  afterAll(() => {
    redis.disconnect();
  });

  function track(userId: string, sessionId: string): void {
    createdKeys.push(`dishlens:session:${userId}:${sessionId}`);
  }

  it("creates a session with an empty message list and an issued session ID", async () => {
    const store = createSessionStore(redis, 60);
    const session = await store.createSession(USER_A);
    track(USER_A, session.sessionId);

    expect(session.userId).toBe(USER_A);
    expect(session.messages).toEqual([]);
    expect(session.sessionId).toBeTruthy();
  });

  it("reads back a created session unchanged", async () => {
    const store = createSessionStore(redis, 60);
    const created = await store.createSession(USER_A);
    track(USER_A, created.sessionId);

    const fetched = await store.getSession(USER_A, created.sessionId);
    expect(fetched).toEqual(created);
  });

  it("appends messages in order and stamps each with a timestamp", async () => {
    const store = createSessionStore(redis, 60);
    const created = await store.createSession(USER_A);
    track(USER_A, created.sessionId);

    await store.appendMessage(USER_A, created.sessionId, { role: "user", content: "first" });
    const updated = await store.appendMessage(USER_A, created.sessionId, { role: "assistant", content: "second" });

    expect(updated?.messages.map((m) => m.content)).toEqual(["first", "second"]);
    expect(updated?.messages.every((m) => typeof m.createdAt === "string")).toBe(true);
  });

  it("scopes sessions per user - a different user ID cannot read another user's session", async () => {
    const store = createSessionStore(redis, 60);
    const created = await store.createSession(USER_A);
    track(USER_A, created.sessionId);

    const fetchedByOtherUser = await store.getSession(USER_B, created.sessionId);
    expect(fetchedByOtherUser).toBeNull();
  });

  it("returns null for a nonexistent session instead of throwing", async () => {
    const store = createSessionStore(redis, 60);
    const result = await store.getSession(USER_A, "nonexistent-session-id");
    expect(result).toBeNull();
  });

  it("returns null when appending to a nonexistent session", async () => {
    const store = createSessionStore(redis, 60);
    const result = await store.appendMessage(USER_A, "nonexistent-session-id", { role: "user", content: "hi" });
    expect(result).toBeNull();
  });

  it("expires a session after its TTL elapses with no activity", async () => {
    const store = createSessionStore(redis, 1);
    const created = await store.createSession(USER_A);
    track(USER_A, created.sessionId);

    await new Promise((resolve) => setTimeout(resolve, 1300));

    const expired = await store.getSession(USER_A, created.sessionId);
    expect(expired).toBeNull();
  }, 3000);

  it("slides the TTL forward on activity instead of expiring on a fixed clock from creation", async () => {
    const store = createSessionStore(redis, 1);
    const created = await store.createSession(USER_A);
    track(USER_A, created.sessionId);

    await new Promise((resolve) => setTimeout(resolve, 600));
    await store.appendMessage(USER_A, created.sessionId, { role: "user", content: "keep me alive" });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const stillAlive = await store.getSession(USER_A, created.sessionId);
    expect(stillAlive).not.toBeNull();
  }, 3000);

  it("deleteSession removes the session immediately", async () => {
    const store = createSessionStore(redis, 60);
    const created = await store.createSession(USER_A);

    await store.deleteSession(USER_A, created.sessionId);
    const result = await store.getSession(USER_A, created.sessionId);
    expect(result).toBeNull();
  });
});
