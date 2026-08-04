export interface RetrievedChunk {
  fileId: string;
  title: string;
  chunkIndex: number;
  sourceUrl: string;
  section: string;
  score: number;
}

export interface PersonalRecipe {
  fileId: string;
  title: string;
  sourceUrl: string;
  text: string;
}

export type PersonalRecipeLookupResult =
  // `recipe: null` means the query succeeded but found nothing relevant -
  // not an error, just "no personal recipe applies here."
  | { ok: true; recipe: PersonalRecipe | null }
  | { ok: false; reason: "query-failed" | "document-fetch-failed" };

/**
 * Best-effort lookup used by chat replies (chat/index.ts) to surface the
 * user's own synced Drive recipes alongside Claude-generated content.
 * Forwards the caller's own access token to drive-sync rather than using
 * a separate service credential - both services share JWT_ACCESS_SECRET
 * (shared-auth), so the same token that authenticated this request here
 * is already valid there.
 */
export async function findPersonalRecipe(
  baseUrl: string,
  accessToken: string,
  query: string,
): Promise<PersonalRecipeLookupResult> {
  let queryRes: Response;
  try {
    queryRes = await fetch(`${baseUrl}/sync/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ query, topK: 1 }),
    });
  } catch {
    return { ok: false, reason: "query-failed" };
  }
  if (!queryRes.ok) {
    return { ok: false, reason: "query-failed" };
  }

  let queryBody: { chunks?: RetrievedChunk[] };
  try {
    queryBody = (await queryRes.json()) as { chunks?: RetrievedChunk[] };
  } catch {
    return { ok: false, reason: "query-failed" };
  }

  const top = queryBody.chunks?.[0];
  if (!top) {
    return { ok: true, recipe: null };
  }

  let docRes: Response;
  try {
    docRes = await fetch(`${baseUrl}/sync/document/${encodeURIComponent(top.fileId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return { ok: false, reason: "document-fetch-failed" };
  }
  if (!docRes.ok) {
    return { ok: false, reason: "document-fetch-failed" };
  }

  let docBody: PersonalRecipe;
  try {
    docBody = (await docRes.json()) as PersonalRecipe;
  } catch {
    return { ok: false, reason: "document-fetch-failed" };
  }

  return { ok: true, recipe: docBody };
}
