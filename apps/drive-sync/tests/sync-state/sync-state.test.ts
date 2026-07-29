import { prisma } from "@lens-and-sync/shared-db";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { deleteSyncState, getKnownContentHash, listKnownFiles, upsertSyncState } from "../../src/sync-state/index.js";

const createdIds: string[] = [];

function testInput(overrides: Partial<Parameters<typeof upsertSyncState>[0]> = {}) {
  const driveFileId = overrides.driveFileId ?? `test-file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  createdIds.push(driveFileId);
  return {
    driveFileId,
    title: "Test Recipe",
    sourceUrl: "https://drive.google.com/file/d/test/view",
    contentHash: "hash-a",
    driveModifiedTime: "2026-07-01T00:00:00.000Z",
    chunkIds: ["chunk-0", "chunk-1"],
    ...overrides,
  };
}

afterEach(async () => {
  await prisma.driveFile.deleteMany({ where: { driveFileId: { in: createdIds } } });
  createdIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("upsertSyncState / listKnownFiles / getKnownContentHash", () => {
  it("creates a new DriveFile record readable via listKnownFiles", async () => {
    const input = testInput();

    await upsertSyncState(input);

    const known = await listKnownFiles();
    const record = known.find((f) => f.driveFileId === input.driveFileId);
    expect(record).toBeDefined();
    expect(record?.driveModifiedTime).toBe(input.driveModifiedTime);
  });

  it("makes the content hash readable via getKnownContentHash after creation", async () => {
    const input = testInput({ contentHash: "hash-xyz" });

    await upsertSyncState(input);

    expect(await getKnownContentHash(input.driveFileId)).toBe("hash-xyz");
  });

  it("returns null from getKnownContentHash for a file that's never been synced", async () => {
    expect(await getKnownContentHash("never-synced-file-id")).toBeNull();
  });

  it("updates an existing record in place on a second upsert, rather than creating a duplicate", async () => {
    const input = testInput({ contentHash: "hash-v1" });
    await upsertSyncState(input);

    await upsertSyncState({ ...input, contentHash: "hash-v2", title: "Updated Title" });

    const rows = await prisma.driveFile.findMany({ where: { driveFileId: input.driveFileId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].contentHash).toBe("hash-v2");
    expect(rows[0].title).toBe("Updated Title");
  });

  it("bumps lastSyncedAt on update", async () => {
    const input = testInput();
    await upsertSyncState(input);
    const first = await prisma.driveFile.findUniqueOrThrow({ where: { driveFileId: input.driveFileId } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    await upsertSyncState({ ...input, contentHash: "hash-changed" });
    const second = await prisma.driveFile.findUniqueOrThrow({ where: { driveFileId: input.driveFileId } });

    expect(second.lastSyncedAt.getTime()).toBeGreaterThan(first.lastSyncedAt.getTime());
  });

  it("persists chunkIds as a real array, round-tripping correctly", async () => {
    const input = testInput({ chunkIds: ["a-0", "a-1", "a-2"] });

    await upsertSyncState(input);

    const row = await prisma.driveFile.findUniqueOrThrow({ where: { driveFileId: input.driveFileId } });
    expect(row.chunkIds).toEqual(["a-0", "a-1", "a-2"]);
  });
});

describe("deleteSyncState", () => {
  it("removes the record so it no longer appears in listKnownFiles", async () => {
    const input = testInput();
    await upsertSyncState(input);
    expect((await listKnownFiles()).some((f) => f.driveFileId === input.driveFileId)).toBe(true);

    await deleteSyncState(input.driveFileId);

    expect((await listKnownFiles()).some((f) => f.driveFileId === input.driveFileId)).toBe(false);
  });

  it("is a no-op, not an error, for a file that was never synced", async () => {
    await expect(deleteSyncState("never-existed-file-id")).resolves.toBeUndefined();
  });
});
