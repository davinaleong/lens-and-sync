import { prisma } from "@lens-and-sync/shared-db";
import type { ChatMessage } from "../session/session-store.js";
import type { SavedChatSummary } from "./save-chat.js";

function toSummary(record: {
  id: string;
  userId: string;
  dishName: string;
  messages: unknown;
  createdAt: Date;
}): SavedChatSummary {
  return {
    id: record.id,
    userId: record.userId,
    dishName: record.dishName,
    messages: record.messages as ChatMessage[],
    createdAt: record.createdAt,
  };
}

/** Owner-scoped: only ever returns chats belonging to `userId`. */
export async function listSavedChats(userId: string): Promise<SavedChatSummary[]> {
  const records = await prisma.savedChat.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return records.map(toSummary);
}

/**
 * Read-only view of a single saved chat. Returns `null` both when the
 * chat doesn't exist and when it belongs to a different user, so callers
 * can't distinguish "not found" from "not yours" - same non-leaking
 * pattern as `session-store.ts`'s `getSession`.
 */
export async function getSavedChat(userId: string, chatId: string): Promise<SavedChatSummary | null> {
  const record = await prisma.savedChat.findUnique({ where: { id: chatId } });
  if (!record || record.userId !== userId) {
    return null;
  }

  return toSummary(record);
}
