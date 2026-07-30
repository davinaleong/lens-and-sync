import { google } from "googleapis";
import type { JWT } from "google-auth-library";

/**
 * Service-account JWT client scoped to `drive.readonly` only - this app
 * only ever reads file content/metadata to sync into Pinecone, it never
 * creates, modifies, or deletes anything in Drive, so the broader
 * `drive` (read-write) scope would be an unnecessary privilege
 * (`01-security-checklist.md` §4's "scoped to only the target folder(s),
 * not full Drive access" - scope-level least privilege; folder-level
 * restriction is enforced separately by only ever querying the
 * configured `GOOGLE_DRIVE_FOLDER_IDS`, see `drive/index.ts`).
 */
export function createDriveAuthClient(credentials: Record<string, unknown>): JWT {
  return new google.auth.JWT({
    email: credentials.client_email as string,
    key: credentials.private_key as string,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}
