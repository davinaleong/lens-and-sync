import { describe, expect, it } from "vitest";
import { detectChanges, type DriveFileMetadata, type KnownFileRecord } from "../../src/drive/index.js";

function file(overrides: Partial<DriveFileMetadata>): DriveFileMetadata {
  return { id: "file-1", name: "doc.txt", mimeType: "text/plain", modifiedTime: "2026-07-01T00:00:00.000Z", ...overrides };
}

function known(overrides: Partial<KnownFileRecord>): KnownFileRecord {
  return { driveFileId: "file-1", driveModifiedTime: "2026-07-01T00:00:00.000Z", ...overrides };
}

describe("detectChanges", () => {
  it("classifies a file with no matching known record as new", () => {
    const result = detectChanges([file({ id: "file-1" })], []);

    expect(result.newFiles).toHaveLength(1);
    expect(result.newFiles[0].id).toBe("file-1");
    expect(result.updatedFiles).toHaveLength(0);
    expect(result.deletedFileIds).toHaveLength(0);
  });

  it("classifies a file with a strictly newer modifiedTime than the known record as updated", () => {
    const result = detectChanges(
      [file({ id: "file-1", modifiedTime: "2026-07-15T00:00:00.000Z" })],
      [known({ driveFileId: "file-1", driveModifiedTime: "2026-07-01T00:00:00.000Z" })],
    );

    expect(result.updatedFiles).toHaveLength(1);
    expect(result.newFiles).toHaveLength(0);
    expect(result.deletedFileIds).toHaveLength(0);
  });

  it("treats an identical modifiedTime as unchanged - not new, not updated", () => {
    const result = detectChanges(
      [file({ id: "file-1", modifiedTime: "2026-07-01T00:00:00.000Z" })],
      [known({ driveFileId: "file-1", driveModifiedTime: "2026-07-01T00:00:00.000Z" })],
    );

    expect(result.newFiles).toHaveLength(0);
    expect(result.updatedFiles).toHaveLength(0);
    expect(result.deletedFileIds).toHaveLength(0);
  });

  it("classifies a known file no longer present in the current listing as deleted", () => {
    const result = detectChanges([], [known({ driveFileId: "file-1" })]);

    expect(result.deletedFileIds).toEqual(["file-1"]);
    expect(result.newFiles).toHaveLength(0);
    expect(result.updatedFiles).toHaveLength(0);
  });

  it("handles a realistic mixed batch: one new, one updated, one unchanged, one deleted", () => {
    const currentFiles = [
      file({ id: "new-file", modifiedTime: "2026-07-20T00:00:00.000Z" }),
      file({ id: "updated-file", modifiedTime: "2026-07-20T00:00:00.000Z" }),
      file({ id: "unchanged-file", modifiedTime: "2026-07-01T00:00:00.000Z" }),
    ];
    const knownFiles = [
      known({ driveFileId: "updated-file", driveModifiedTime: "2026-07-01T00:00:00.000Z" }),
      known({ driveFileId: "unchanged-file", driveModifiedTime: "2026-07-01T00:00:00.000Z" }),
      known({ driveFileId: "deleted-file", driveModifiedTime: "2026-07-01T00:00:00.000Z" }),
    ];

    const result = detectChanges(currentFiles, knownFiles);

    expect(result.newFiles.map((f) => f.id)).toEqual(["new-file"]);
    expect(result.updatedFiles.map((f) => f.id)).toEqual(["updated-file"]);
    expect(result.deletedFileIds).toEqual(["deleted-file"]);
  });
});
