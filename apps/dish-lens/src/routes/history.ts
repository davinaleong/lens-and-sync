import { requireAuth, type AuthenticatedRequest } from "@lens-and-sync/shared-auth";
import type { ErrorRequestHandler } from "express";
import { Router } from "express";
import { config } from "../config.js";
import { getSavedChat, listSavedChats } from "../history/list-chats.js";
import { logger } from "../logger.js";

export const historyRouter: Router = Router();

historyRouter.use(requireAuth(config.JWT_ACCESS_SECRET, logger));

historyRouter.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    // requireAuth has already run and called next() only on success, so
    // req.userId is guaranteed set here.
    const chats = await listSavedChats(req.userId as string);
    res.status(200).json({ chats });
  } catch (err) {
    next(err);
  }
});

historyRouter.get("/:chatId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const chatId = req.params.chatId;
    if (!chatId) {
      res.status(400).json({ error: { code: "invalid-request", message: "A chat ID is required." } });
      return;
    }

    const chat = await getSavedChat(req.userId as string, chatId);
    if (!chat) {
      res.status(404).json({ error: { code: "not-found", message: "Saved chat not found." } });
      return;
    }
    res.status(200).json({ chat });
  } catch (err) {
    next(err);
  }
});

const handleHistoryError: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  // Log server-side only - never leak internals (stack trace, Prisma error
  // text) into the client response (`01-security-checklist.md` §11), same
  // pattern as `routes/upload.ts`'s catch-all.
  logger.error({ err }, "Unhandled error in /chats");
  res.status(500).json({ error: { code: "internal-error", message: "An unexpected error occurred." } });
};

historyRouter.use(handleHistoryError);
