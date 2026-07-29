import { createHash } from "node:crypto";
import { google, type drive_v3 } from "googleapis";
import type { JWT } from "google-auth-library";

export function createDriveClient(auth: JWT): drive_v3.Drive {
  return google.drive({ version: "v3", auth });
}

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  // Drive's own canonical "open this file" URL - used as-is for the
  // "source URL" field in Pinecone metadata (`vector-store/index.ts`)
  // rather than hand-constructing a per-mime-type URL, which would need
  // to track Drive's URL scheme for every file type separately and could
  // drift from what Drive actually serves.
  webViewLink: string;
}

// The Drive API's `q` query language delimits string literals with single
// quotes and expects a literal quote inside one to be backslash-escaped
// (per Drive's own docs) - defensive even though `folderId` only ever
// comes from admin-configured `GOOGLE_DRIVE_FOLDER_IDS`, never client
// input.
function escapeForDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Lists every non-trashed file directly inside `folderId`, paginating
 * through Drive's `nextPageToken` until exhausted. Takes an already-
 * constructed `drive_v3.Drive` client as a parameter (same
 * dependency-injection shape as every DishLens external-service call -
 * `vision/index.ts`'s client, `recipe/index.ts`'s client) so this is
 * unit-testable against a hand-built fake client, no live credentials or
 * network needed.
 */
export async function listDriveFiles(drive: drive_v3.Drive, folderId: string): Promise<DriveFileMetadata[]> {
  const files: DriveFileMetadata[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${escapeForDriveQuery(folderId)}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)",
      pageSize: 1000,
      pageToken,
    });

    for (const f of res.data.files ?? []) {
      if (f.id && f.name && f.mimeType && f.modifiedTime && f.webViewLink) {
        files.push({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, webViewLink: f.webViewLink });
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return files;
}

// The subset of a `DriveFile` Prisma record that change detection needs -
// deliberately not the full model, so this stays decoupled from the ORM
// shape and easy to unit-test with plain objects.
export interface KnownFileRecord {
  driveFileId: string;
  driveModifiedTime: string;
}

export interface ChangeSet {
  newFiles: DriveFileMetadata[];
  updatedFiles: DriveFileMetadata[];
  deletedFileIds: string[];
}

/**
 * Pure comparison between the current live folder listing and the
 * previously-synced state (Milestone #2). A file is "new" if its ID isn't
 * in `knownFiles` at all, "updated" if Drive's `modifiedTime` is strictly
 * newer than what was last recorded, and "deleted" if a previously-known
 * ID no longer appears in the current listing - covers Drive-side moves
 * out of the folder the same as an actual deletion, which is the correct
 * behavior here since this app only ever tracks files *inside* the
 * configured folder(s).
 */
export function detectChanges(currentFiles: DriveFileMetadata[], knownFiles: KnownFileRecord[]): ChangeSet {
  const knownById = new Map(knownFiles.map((file) => [file.driveFileId, file]));
  const currentIds = new Set(currentFiles.map((file) => file.id));

  const newFiles: DriveFileMetadata[] = [];
  const updatedFiles: DriveFileMetadata[] = [];

  for (const file of currentFiles) {
    const known = knownById.get(file.id);
    if (!known) {
      newFiles.push(file);
    } else if (new Date(file.modifiedTime).getTime() > new Date(known.driveModifiedTime).getTime()) {
      updatedFiles.push(file);
    }
  }

  const deletedFileIds = knownFiles.filter((known) => !currentIds.has(known.driveFileId)).map((known) => known.driveFileId);

  return { newFiles, updatedFiles, deletedFileIds };
}

/**
 * Content-level change detection (Milestone #7), a second, more precise
 * layer beneath `detectChanges`'s Drive `modifiedTime` check: Drive can
 * report a `modifiedTime` change for a metadata-only edit (renamed,
 * moved, permissions touched) with no actual change to the extracted
 * text. Hashing the *extracted* text (not the raw file bytes - two
 * different Docs exports of literally-unchanged content are byte-for-byte
 * consistent for our purposes) and comparing against what was last stored
 * lets a caller skip the OpenAI/Pinecone cost of re-embedding a file
 * whose real content didn't change, even though `detectChanges` already
 * flagged it as "updated."
 */
export function computeContentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * `knownContentHash` is `null` for a file with no prior recorded hash
 * (new file, or one synced before this feature existed) - always
 * re-embed in that case, since there's nothing to compare against.
 */
export function shouldReembedFile(newContentHash: string, knownContentHash: string | null): boolean {
  return knownContentHash === null || knownContentHash !== newContentHash;
}
