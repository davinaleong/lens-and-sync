import { randomUUID } from "node:crypto";
import { prisma } from "@lens-and-sync/shared-db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getSavedChat, listSavedChats } from "../../src/history/list-chats.js";
import { saveChat } from "../../src/history/save-chat.js";

// Requires a real, reachable, migrated Postgres - same instance CI already
// runs as a service container (see .github/workflows/ci.yml) and that
// infra/docker-compose.yml provides for local dev. Ownership scoping and
// FK integrity aren't trustworthily verified against a mock.
describe("save-chat / list-chats", () => {
  let userAId: string;
  let userBId: string;
  const createdChatIds: string[] = [];

  beforeAll(async () => {
    const userA = await prisma.user.create({ data: { email: `test-a-${randomUUID()}@example.com` } });
    const userB = await prisma.user.create({ data: { email: `test-b-${randomUUID()}@example.com` } });
    userAId = userA.id;
    userBId = userB.id;
  });

  afterEach(async () => {
    if (createdChatIds.length > 0) {
      await prisma.savedChat.deleteMany({ where: { id: { in: createdChatIds } } });
      createdChatIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.$disconnect();
  });

  it("saves a chat as an immutable snapshot with the given messages", async () => {
    const messages = [{ role: "user" as const, content: "what dish is this?", createdAt: new Date().toISOString() }];
    const saved = await saveChat({ userId: userAId, dishName: "Pad Thai", messages });
    createdChatIds.push(saved.id);

    expect(saved.userId).toBe(userAId);
    expect(saved.dishName).toBe("Pad Thai");
    expect(saved.messages).toEqual(messages);
    expect(saved.createdAt).toBeInstanceOf(Date);
  });

  it("lists only the calling user's saved chats, not other users'", async () => {
    const savedA = await saveChat({ userId: userAId, dishName: "Ramen", messages: [] });
    const savedB = await saveChat({ userId: userBId, dishName: "Sushi", messages: [] });
    createdChatIds.push(savedA.id, savedB.id);

    const chatsForA = await listSavedChats(userAId);
    const idsForA = chatsForA.map((c) => c.id);

    expect(idsForA).toContain(savedA.id);
    expect(idsForA).not.toContain(savedB.id);
  });

  it("getSavedChat returns the chat for its owner but null for a different user", async () => {
    const saved = await saveChat({ userId: userAId, dishName: "Tacos", messages: [] });
    createdChatIds.push(saved.id);

    const asOwner = await getSavedChat(userAId, saved.id);
    const asOtherUser = await getSavedChat(userBId, saved.id);

    expect(asOwner?.id).toBe(saved.id);
    expect(asOtherUser).toBeNull();
  });

  it("getSavedChat returns null for a nonexistent chat instead of throwing", async () => {
    const result = await getSavedChat(userAId, randomUUID());
    expect(result).toBeNull();
  });
});
