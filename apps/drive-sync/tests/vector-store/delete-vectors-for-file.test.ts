import { describe, expect, it, vi } from "vitest";
import { deleteVectorsForFile } from "../../src/vector-store/index.js";

function fakeIndex(overrides: { listPaginated?: ReturnType<typeof vi.fn>; deleteMany?: ReturnType<typeof vi.fn> } = {}) {
  return {
    listPaginated: overrides.listPaginated ?? vi.fn().mockResolvedValue({ vectors: [] }),
    deleteMany: overrides.deleteMany ?? vi.fn().mockResolvedValue(undefined),
  } as never;
}

describe("deleteVectorsForFile", () => {
  it("returns ok with deletedCount 0 and never calls deleteMany when no vectors match the file's prefix", async () => {
    const deleteMany = vi.fn();
    const index = fakeIndex({ listPaginated: vi.fn().mockResolvedValue({ vectors: [] }), deleteMany });

    const result = await deleteVectorsForFile(index, "file-1");

    expect(result).toEqual({ ok: true, deletedCount: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("queries listPaginated with the file's ID as a prefix", async () => {
    const listPaginated = vi.fn().mockResolvedValue({ vectors: [] });
    const index = fakeIndex({ listPaginated });

    await deleteVectorsForFile(index, "file-1");

    expect(listPaginated).toHaveBeenCalledWith(expect.objectContaining({ prefix: "file-1-" }));
  });

  it("deletes every matching vector ID found via listPaginated", async () => {
    const listPaginated = vi.fn().mockResolvedValue({ vectors: [{ id: "file-1-0" }, { id: "file-1-1" }] });
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    const index = fakeIndex({ listPaginated, deleteMany });

    const result = await deleteVectorsForFile(index, "file-1");

    expect(deleteMany).toHaveBeenCalledWith(["file-1-0", "file-1-1"]);
    expect(result).toEqual({ ok: true, deletedCount: 2 });
  });

  it("follows pagination until exhausted, combining IDs across pages before deleting", async () => {
    const listPaginated = vi
      .fn()
      .mockResolvedValueOnce({ vectors: [{ id: "file-1-0" }], pagination: { next: "token-2" } })
      .mockResolvedValueOnce({ vectors: [{ id: "file-1-1" }] });
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    const index = fakeIndex({ listPaginated, deleteMany });

    const result = await deleteVectorsForFile(index, "file-1");

    expect(listPaginated).toHaveBeenCalledTimes(2);
    expect(listPaginated.mock.calls[1][0].paginationToken).toBe("token-2");
    expect(deleteMany).toHaveBeenCalledWith(["file-1-0", "file-1-1"]);
    expect(result).toEqual({ ok: true, deletedCount: 2 });
  });

  it("returns delete-failed rather than throwing when the API call rejects", async () => {
    const listPaginated = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await deleteVectorsForFile(fakeIndex({ listPaginated }), "file-1");

    expect(result).toEqual({ ok: false, reason: "delete-failed" });
  });
});
