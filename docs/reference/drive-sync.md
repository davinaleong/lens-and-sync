# drive-sync API

Base URL: `https://drive-sync-production.up.railway.app`

All routes except `/health` require a JWT access token issued by **dish-lens** — the two services share the same `JWT_ACCESS_SECRET`.

```
Authorization: Bearer <accessToken>
```

---

## Sync

### `POST /sync/query` 🔒

Semantic search over indexed Drive content using RAG retrieval.

**Body**

```json
{
  "query": "What is our refund policy?",
  "topK": 5
}
```

`topK` defaults to 5, max 20.

**200 OK**

```json
{
  "chunks": [
    {
      "fileId": "1abc...",
      "title": "Refund Policy v2",
      "sourceUrl": "https://drive.google.com/file/d/1abc...",
      "section": "Section 3",
      "score": 0.91
    }
  ]
}
```

::: info
Chunk text is intentionally not returned — only source attribution metadata. The caller fetches the source document via `sourceUrl` if they need the full content.
:::

**502 Bad Gateway** — retrieval pipeline error

---

### `GET /sync/status` 🔒

Last sync run outcome from Redis.

**200 OK**

```json
{
  "status": {
    "startedAt": "2026-07-31T03:00:00.000Z",
    "finishedAt": "2026-07-31T03:00:42.831Z",
    "ok": true,
    "result": {
      "newFiles": 2,
      "updatedFiles": 1,
      "skippedUnchanged": 14,
      "deletedFiles": 0,
      "failures": []
    },
    "error": null
  }
}
```

`status` is `null` if no sync has run yet.

---

### `GET /sync/audit` 🔒

Full index snapshot — last sync result plus every tracked file with chunk counts.

**200 OK**

```json
{
  "generatedAt": "2026-07-31T12:00:00.000Z",
  "lastSync": { ... },
  "index": {
    "totalFiles": 17,
    "totalChunks": 312,
    "files": [
      {
        "driveFileId": "1abc...",
        "title": "Q2 Report",
        "sourceUrl": "https://drive.google.com/...",
        "chunkCount": 22,
        "lastSyncedAt": "2026-07-31T03:00:42.000Z",
        "driveModifiedTime": "2026-07-30T18:00:00.000Z"
      }
    ]
  }
}
```

---

## Health

### `GET /health`

**200 OK** — `{ "status": "ok" }`

---

## Sync worker

The sync worker runs as a BullMQ job on the cron schedule defined by `SYNC_CRON_SCHEDULE`. It is not triggered via HTTP — it starts automatically when the service starts.

A Redis-backed distributed lock (`drivesync:<queue>:lock`) prevents overlapping runs. If a sync is already running when the next cron fires, the new run is **skipped** (not queued) and a warning is logged.

### Sync algorithm

```
for each folder in GOOGLE_DRIVE_FOLDER_IDS:
  list current files (id + modifiedTime)

compare against Postgres DriveFile rows (detectChanges):
  → newFiles:      files not in Postgres
  → updatedFiles:  files where driveModifiedTime changed
  → deletedFiles:  files in Postgres but not in Drive

for each new/updated file:
  extract text  (Google Drive export API)
  compute SHA-256 content hash
  if hash unchanged from stored value:
    update driveModifiedTime only (skip re-embedding)
  else:
    chunk text → embed chunks (OpenAI) → delete old vectors → upsert new vectors (Pinecone)
    persist new sync state (Postgres)

for each deleted file:
  delete vectors from Pinecone
  delete DriveFile row from Postgres
```
