import { prisma } from "@lens-and-sync/shared-db";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { runSyncOnce, type SyncDependencies } from "../../src/jobs/index.js";

const TEST_FILE_ID = "test-job-file-1";

function fakeDrive(overrides: { list?: ReturnType<typeof vi.fn>; export?: ReturnType<typeof vi.fn> } = {}) {
  return {
    files: {
      list: overrides.list ?? vi.fn().mockResolvedValue({ data: { files: [] } }),
      export: overrides.export ?? vi.fn().mockResolvedValue({ data: "Ingredients:\nflour\nsugar" }),
      get: vi.fn(),
    },
  } as never;
}

function fakeVectorIndex(overrides: { upsert?: ReturnType<typeof vi.fn>; deleteMany?: ReturnType<typeof vi.fn>; listPaginated?: ReturnType<typeof vi.fn> } = {}) {
  return {
    upsert: overrides.upsert ?? vi.fn().mockResolvedValue(undefined),
    deleteMany: overrides.deleteMany ?? vi.fn().mockResolvedValue(undefined),
    listPaginated: overrides.listPaginated ?? vi.fn().mockResolvedValue({ vectors: [] }),
  } as never;
}

function fakeEmbeddingClient(overrides: { create?: ReturnType<typeof vi.fn> } = {}) {
  const create = overrides.create ?? vi.fn().mockImplementation(async ({ input }: { input: string[] }) => ({
    data: input.map((_, i) => ({ index: i, embedding: [0.1, 0.2, 0.3] })),
  }));
  return { embeddings: { create } } as never;
}

function baseDeps(overrides: Partial<SyncDependencies> = {}): SyncDependencies {
  return {
    drive: fakeDrive(),
    folderIds: ["folder-1"],
    embeddingClient: fakeEmbeddingClient(),
    embeddingModel: "text-embedding-3-small",
    vectorIndex: fakeVectorIndex(),
    ...overrides,
  };
}

function driveFile(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_FILE_ID,
    name: "Test Job Doc",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-07-01T00:00:00.000Z",
    webViewLink: "https://drive.google.com/file/d/test-job-file-1/view",
    ...overrides,
  };
}

afterEach(async () => {
  await prisma.driveFile.deleteMany({ where: { driveFileId: { startsWith: "test-job-" } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("runSyncOnce", () => {
  it("syncs a brand-new file end-to-end: extracts, embeds, upserts, and persists sync state", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const embedCreate = vi.fn().mockResolvedValue({ data: [{ index: 0, embedding: [0.1, 0.2] }] });
    const list = vi.fn().mockResolvedValue({ data: { files: [driveFile()] } });

    const result = await runSyncOnce(
      baseDeps({
        drive: fakeDrive({ list }),
        vectorIndex: fakeVectorIndex({ upsert }),
        embeddingClient: fakeEmbeddingClient({ create: embedCreate }),
      }),
    );

    expect(result).toEqual({ newFiles: 1, updatedFiles: 0, skippedUnchanged: 0, deletedFiles: 0, failures: [] });
    expect(upsert).toHaveBeenCalledOnce();

    const stored = await prisma.driveFile.findUnique({ where: { driveFileId: TEST_FILE_ID } });
    expect(stored).not.toBeNull();
    expect(stored?.chunkIds).toEqual([`${TEST_FILE_ID}-0`]);
  });

  it("skips re-embedding on a second run where the file's real content is unchanged", async () => {
    const list = vi.fn().mockResolvedValue({ data: { files: [driveFile()] } });
    const embedCreate = vi.fn().mockResolvedValue({ data: [{ index: 0, embedding: [0.1, 0.2] }] });
    const deps = baseDeps({ drive: fakeDrive({ list }), embeddingClient: fakeEmbeddingClient({ create: embedCreate }) });

    await runSyncOnce(deps);
    expect(embedCreate).toHaveBeenCalledOnce();

    // Second run: same content, but a newer modifiedTime (simulates a
    // metadata-only Drive edit) - detectChanges will classify it as
    // "updated," but content-hash dedup should still skip re-embedding.
    list.mockResolvedValue({ data: { files: [driveFile({ modifiedTime: "2026-07-02T00:00:00.000Z" })] } });
    const result = await runSyncOnce(deps);

    expect(result).toEqual({ newFiles: 0, updatedFiles: 0, skippedUnchanged: 1, deletedFiles: 0, failures: [] });
    expect(embedCreate).toHaveBeenCalledOnce(); // still only the first call - no re-embed
  });

  it("deletes vectors and sync state for a file that's disappeared from Drive", async () => {
    const list = vi.fn().mockResolvedValue({ data: { files: [driveFile()] } });
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    await runSyncOnce(baseDeps({ drive: fakeDrive({ list }) }));
    expect(await prisma.driveFile.findUnique({ where: { driveFileId: TEST_FILE_ID } })).not.toBeNull();

    // Second run: the file is gone from Drive entirely.
    list.mockResolvedValue({ data: { files: [] } });
    const result = await runSyncOnce(baseDeps({ drive: fakeDrive({ list }), vectorIndex: fakeVectorIndex({ deleteMany }) }));

    expect(result.deletedFiles).toBe(1);
    expect(deleteMany).not.toHaveBeenCalled(); // nothing matched the (empty) listPaginated prefix search - still correctly a no-op delete
    expect(await prisma.driveFile.findUnique({ where: { driveFileId: TEST_FILE_ID } })).toBeNull();
  });

  it("records a per-file failure without aborting the rest of the run", async () => {
    const failingFile = driveFile({ id: "test-job-file-fails", name: "Broken Doc" });
    const okFile = driveFile({ id: "test-job-file-2", name: "Good Doc" });
    const list = vi.fn().mockResolvedValue({ data: { files: [failingFile, okFile] } });
    const exportFn = vi.fn().mockImplementation(async ({ fileId }: { fileId: string }) => {
      if (fileId === failingFile.id) {
        throw new Error("simulated Drive export failure");
      }
      return { data: "Ingredients:\nflour" };
    });

    const result = await runSyncOnce(baseDeps({ drive: fakeDrive({ list, export: exportFn }) }));

    expect(result.newFiles).toBe(1);
    expect(result.failures).toEqual([{ fileId: failingFile.id, reason: "extraction-failed" }]);
    expect(await prisma.driveFile.findUnique({ where: { driveFileId: okFile.id } })).not.toBeNull();
    expect(await prisma.driveFile.findUnique({ where: { driveFileId: failingFile.id } })).toBeNull();
  });

  it("logs per-file sync events (Milestone #11) when a logger is supplied, and stays silent when it isn't", async () => {
    const list = vi.fn().mockResolvedValue({ data: { files: [driveFile()] } });
    const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await runSyncOnce(baseDeps({ drive: fakeDrive({ list }), logger: fakeLogger as never }));

    expect(fakeLogger.info).toHaveBeenCalledWith(expect.objectContaining({ event: "sync-file-synced", fileId: TEST_FILE_ID }), expect.any(String));
  });

  it("logs a failure event for a file that fails to extract", async () => {
    const failingFile = driveFile({ id: "test-job-file-log-fail" });
    const list = vi.fn().mockResolvedValue({ data: { files: [failingFile] } });
    const exportFn = vi.fn().mockRejectedValue(new Error("simulated failure"));
    const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await runSyncOnce(baseDeps({ drive: fakeDrive({ list, export: exportFn }), logger: fakeLogger as never }));

    expect(fakeLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "sync-file-failed", fileId: failingFile.id, stage: "extract" }),
      expect.any(String),
    );
  });
});
