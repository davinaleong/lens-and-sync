import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

export type ChatMessageRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
  createdAt: string;
}

export interface SessionState {
  sessionId: string;
  userId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionStore {
  createSession(userId: string): Promise<SessionState>;
  getSession(userId: string, sessionId: string): Promise<SessionState | null>;
  appendMessage(
    userId: string,
    sessionId: string,
    message: Omit<ChatMessage, "createdAt">,
  ): Promise<SessionState | null>;
  deleteSession(userId: string, sessionId: string): Promise<void>;
}

function sessionKey(userId: string, sessionId: string): string {
  return `dishlens:session:${userId}:${sessionId}`;
}

/**
 * Session state lives entirely in Redis, keyed by `{userId}:{sessionId}` so
 * a session ID alone is never enough to read someone else's session - IDOR
 * defense-in-depth beneath whatever auth check calls this. Every write
 * refreshes the TTL (sliding expiration) so an active conversation doesn't
 * expire mid-use on a fixed clock from creation, while a genuinely
 * abandoned session still auto-expires after `ttlSeconds`.
 *
 * Takes a connected `Redis` client and TTL as parameters rather than
 * importing the app's singleton client/config directly, so it stays
 * testable against a real (test) Redis without needing the full env
 * schema loaded - same reasoning as `preprocessing/blur-detection.ts` and
 * `upload/index.ts` staying parameter-driven rather than reading config
 * internally.
 *
 * Callers MUST source `userId` from verified auth, never from
 * client-supplied input - this store only enforces key-level scoping once
 * identity is established, it doesn't authenticate anyone itself.
 */
export function createSessionStore(redis: Redis, ttlSeconds: number): SessionStore {
  async function persist(session: SessionState): Promise<void> {
    await redis.set(sessionKey(session.userId, session.sessionId), JSON.stringify(session), "EX", ttlSeconds);
  }

  async function getSession(userId: string, sessionId: string): Promise<SessionState | null> {
    const raw = await redis.get(sessionKey(userId, sessionId));
    return raw ? (JSON.parse(raw) as SessionState) : null;
  }

  async function createSession(userId: string): Promise<SessionState> {
    const now = new Date().toISOString();
    const session: SessionState = {
      sessionId: randomUUID(),
      userId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    await persist(session);
    return session;
  }

  async function appendMessage(
    userId: string,
    sessionId: string,
    message: Omit<ChatMessage, "createdAt">,
  ): Promise<SessionState | null> {
    const session = await getSession(userId, sessionId);
    if (!session) {
      return null;
    }

    session.messages.push({ ...message, createdAt: new Date().toISOString() });
    session.updatedAt = new Date().toISOString();
    await persist(session);
    return session;
  }

  async function deleteSession(userId: string, sessionId: string): Promise<void> {
    await redis.del(sessionKey(userId, sessionId));
  }

  return { createSession, getSession, appendMessage, deleteSession };
}
