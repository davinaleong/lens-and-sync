import { requireAuth, type AuthenticatedRequest } from "@lens-and-sync/shared-auth";
import type { ErrorRequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import { extractDishContext } from "../chat/dish-context.js";
import { generateChatReply } from "../chat/index.js";
import { config } from "../config.js";
import { findPersonalRecipe, type PersonalRecipe } from "../drive-sync-client/index.js";
import { saveChat } from "../history/save-chat.js";
import { logger } from "../logger.js";
import { anthropicClient } from "../recipe/client.js";
import { redis } from "../session/redis-client.js";
import { createSessionStore } from "../session/session-store.js";

function bearerToken(authHeader: string | undefined): string | undefined {
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
}

/**
 * Best-effort - a drive-sync outage or missing config must never break
 * chat itself, so any failure here just means "no personal recipe found
 * this turn," not an error surfaced to the user.
 */
async function lookupPersonalRecipe(accessToken: string | undefined, query: string): Promise<PersonalRecipe | null> {
  if (!config.DRIVE_SYNC_BASE_URL || !accessToken) return null;
  try {
    const result = await findPersonalRecipe(config.DRIVE_SYNC_BASE_URL, accessToken, query);
    return result.ok ? result.recipe : null;
  } catch (err) {
    logger.error({ err }, "Personal recipe lookup failed - continuing without it.");
    return null;
  }
}

const sessionStore = createSessionStore(redis, config.REDIS_SESSION_TTL_SECONDS);

export const chatSessionRouter: Router = Router();

chatSessionRouter.use(requireAuth(config.JWT_ACCESS_SECRET, logger));

const sessionIdSchema = z.string().uuid();
const sendMessageSchema = z.object({ content: z.string().min(1).max(2000) });

/**
 * Creates a session with no dish seed at all - `session.messages` starts
 * empty (`createSession`'s own default), unlike an /upload-seeded
 * session whose first message is always the JSON dish-context blob. The
 * absence of a seed is exactly what `extractDishContext(undefined)`
 * already treats as "no dish" below, so no separate "session kind" flag
 * is needed anywhere - the seed's presence/absence *is* the flag.
 */
chatSessionRouter.post("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const session = await sessionStore.createSession(req.userId as string);
    res.status(201).json({ sessionId: session.sessionId });
  } catch (err) {
    next(err);
  }
});

chatSessionRouter.post("/:sessionId/messages", async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsedId = sessionIdSchema.safeParse(req.params.sessionId);
    if (!parsedId.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A valid session ID is required." } });
      return;
    }
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A non-empty message (max 2000 chars) is required." } });
      return;
    }

    const userId = req.userId as string;
    const session = await sessionStore.getSession(userId, parsedId.data);
    if (!session) {
      res.status(404).json({ error: { code: "not-found", message: "Chat session not found or expired." } });
      return;
    }

    // `null` here means either "no dish seed at all" (a general chat
    // session, POST /chats/session) or a malformed one - both are valid
    // to reply to, just without dish-specific context.
    const dish = extractDishContext(session.messages[0]);

    const afterUser = await sessionStore.appendMessage(userId, parsedId.data, {
      role: "user",
      content: parsed.data.content,
    });
    if (!afterUser) {
      res.status(404).json({ error: { code: "not-found", message: "Chat session not found or expired." } });
      return;
    }

    // Real conversational turns only. When there's a dish seed, message[0]
    // is the JSON blob (not natural language) and must be excluded; a
    // general session has no seed, so nothing to skip. The last entry is
    // the user message just appended, passed separately either way.
    const history = dish ? afterUser.messages.slice(1, -1) : afterUser.messages.slice(0, -1);

    const personalRecipe = await lookupPersonalRecipe(bearerToken(req.headers.authorization), parsed.data.content);

    const result = await generateChatReply(
      anthropicClient,
      config.ANTHROPIC_MODEL,
      dish,
      history,
      parsed.data.content,
      personalRecipe,
    );
    if (!result.ok) {
      res.status(502).json({
        error: { code: "reply-generation-failed", message: "Could not generate a reply. Please try again." },
      });
      return;
    }

    await sessionStore.appendMessage(userId, parsedId.data, { role: "assistant", content: result.reply });
    res.status(200).json({ reply: result.reply, sessionId: parsedId.data });
  } catch (err) {
    next(err);
  }
});

chatSessionRouter.post("/:sessionId/archive", async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsedId = sessionIdSchema.safeParse(req.params.sessionId);
    if (!parsedId.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A valid session ID is required." } });
      return;
    }

    const userId = req.userId as string;
    const session = await sessionStore.getSession(userId, parsedId.data);
    if (!session) {
      // Already archived or expired - nothing for the client to react to.
      res.status(204).send();
      return;
    }

    const hasRealExchange = session.messages.some((m) => m.role === "user");
    if (!hasRealExchange) {
      await sessionStore.deleteSession(userId, parsedId.data);
      res.status(204).send();
      return;
    }

    const dish = extractDishContext(session.messages[0]);
    // Drop the JSON seed message when one exists - SavedChat.messages
    // should read as an actual conversation, not a serialized upload
    // result. A general (no-dish) session has no seed to drop.
    const saved = await saveChat({
      userId,
      dishName: dish?.dishName ?? "General chat",
      messages: dish ? session.messages.slice(1) : session.messages,
    });
    await sessionStore.deleteSession(userId, parsedId.data);
    res.status(201).json({ chat: saved });
  } catch (err) {
    next(err);
  }
});

const handleChatSessionError: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  logger.error({ err }, "Unhandled error in /chats/session");
  res.status(500).json({ error: { code: "internal-error", message: "An unexpected error occurred." } });
};

chatSessionRouter.use(handleChatSessionError);
