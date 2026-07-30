import { Prisma, prisma } from "@lens-and-sync/shared-db";
import type { ChatMessage } from "../session/session-store.js";

export interface SavedChatSummary {
  id: string;
  userId: string;
  dishName: string;
  messages: ChatMessage[];
  createdAt: Date;
}

/**
 * Snapshots a finished Redis session into an immutable Postgres record.
 * There is no update path anywhere in this codebase for `SavedChat` - the
 * write-once guarantee (`01-security-checklist.md` §7) is enforced by that
 * absence, not by a runtime check inside this function. Once a real
 * "continue this chat" endpoint exists, it's that endpoint's job to check
 * a chat isn't already archived before accepting a write - there's no such
 * endpoint yet (see `07-implementation-log.md` Cycle 8), so there's
 * currently no code path that could even attempt one.
 */
export async function saveChat(params: {
  userId: string;
  dishName: string;
  messages: ChatMessage[];
}): Promise<SavedChatSummary> {
  const record = await prisma.savedChat.create({
    data: {
      userId: params.userId,
      dishName: params.dishName,
      messages: params.messages as unknown as Prisma.SavedChatCreateInput['messages'],
    },
  });

  return {
    id: record.id,
    userId: record.userId,
    dishName: record.dishName,
    messages: record.messages as unknown as ChatMessage[],
    createdAt: record.createdAt,
  };
}
