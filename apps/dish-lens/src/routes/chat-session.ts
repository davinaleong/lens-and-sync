import { requireAuth, type AuthenticatedRequest } from "@lens-and-sync/shared-auth";
import type { ErrorRequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import { extractDishContext } from "../chat/dish-context.js";
import { generateChatReply } from "../chat/index.js";
import { config } from "../config.js";
import { saveChat } from "../history/save-chat.js";
import { logger } from "../logger.js";
import { anthropicClient } from "../recipe/client.js";
import { redis } from "../session/redis-client.js";
import { createSessionStore } from "../session/session-store.js";

const sessionStore = createSessionStore(redis, config.REDIS_SESSION_TTL_SECONDS);

export const chatSessionRouter: Router = Router();

chatSessionRouter.use(requireAuth(config.JWT_ACCESS_SECRET, logger));

const sessionIdSchema = z.string().uuid();
const sendMessageSchema = z.object({ content: z.string().min(1).max(2000) });

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

    const dish = extractDishContext(session.messages[0]);
    if (!dish) {
      res.status(409).json({ error: { code: "invalid-session", message: "This session isn't tied to a scanned dish." } });
      return;
    }

    const afterUser = await sessionStore.appendMessage(userId, parsedId.data, {
      role: "user",
      content: parsed.data.content,
    });
    if (!afterUser) {
      res.status(404).json({ error: { code: "not-found", message: "Chat session not found or expired." } });
      return;
    }

    // Real conversational turns only - message[0] is the JSON seed blob,
    // not natural language, and would confuse the model as a prior turn.
    // The last entry is the user message just appended, passed separately.
    const history = afterUser.messages.slice(1, -1);

    const result = await generateChatReply(anthropicClient, config.ANTHROPIC_MODEL, dish, history, parsed.data.content);
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
    // Drop the JSON seed message - SavedChat.messages should read as an
    // actual conversation, not a serialized upload result.
    const saved = await saveChat({
      userId,
      dishName: dish?.dishName ?? "Chat",
      messages: session.messages.slice(1),
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
