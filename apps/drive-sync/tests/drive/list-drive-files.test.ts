import { describe, expect, it, vi } from "vitest";
import { listDriveFiles } from "../../src/drive/index.js";

function fakeDrive(pages: Array<{ files: unknown[]; nextPageToken?: string }>) {
  const list = vi.fn();
  for (const page of pages) {
    list.mockResolvedValueOnce({ data: page });
  }
  return { files: { list } } as never;
}

describe("listDriveFiles", () => {
  it("maps Drive API file entries to DriveFileMetadata", async () => {
    const drive = fakeDrive([
      { files: [{ id: "1", name: "a.txt", mimeType: "text/plain", modifiedTime: "2026-07-01T00:00:00.000Z" }] },
    ]);

    const files = await listDriveFiles(drive, "folder-123");

    expect(files).toEqual([{ id: "1", name: "a.txt", mimeType: "text/plain", modifiedTime: "2026-07-01T00:00:00.000Z" }]);
  });

  it("skips entries missing a required field rather than including a partial record", async () => {
    const drive = fakeDrive([
      {
        files: [
          { id: "1", name: "a.txt", mimeType: "text/plain", modifiedTime: "2026-07-01T00:00:00.000Z" },
          { id: "2", name: "no-mtype" },
        ],
      },
    ]);

    const files = await listDriveFiles(drive, "folder-123");

    expect(files).toHaveLength(1);
    expect(files[0].id).toBe("1");
  });

  it("follows nextPageToken until pagination is exhausted, combining all pages", async () => {
    const drive = fakeDrive([
      { files: [{ id: "1", name: "a", mimeType: "text/plain", modifiedTime: "t1" }], nextPageToken: "page-2" },
      { files: [{ id: "2", name: "b", mimeType: "text/plain", modifiedTime: "t2" }] },
    ]);

    const files = await listDriveFiles(drive, "folder-123");

    expect(files.map((f) => f.id)).toEqual(["1", "2"]);
    expect(drive.files.list).toHaveBeenCalledTimes(2);
    expect(drive.files.list.mock.calls[1][0].pageToken).toBe("page-2");
  });

  it("scopes the query to the given folder and excludes trashed files", async () => {
    const drive = fakeDrive([{ files: [] }]);

    await listDriveFiles(drive, "folder-123");

    expect(drive.files.list.mock.calls[0][0].q).toBe("'folder-123' in parents and trashed = false");
  });

  it("escapes a single quote in the folder ID so it can't break out of the query string", async () => {
    const drive = fakeDrive([{ files: [] }]);

    await listDriveFiles(drive, "weird'folder");

    expect(drive.files.list.mock.calls[0][0].q).toBe("'weird\\'folder' in parents and trashed = false");
  });
});
