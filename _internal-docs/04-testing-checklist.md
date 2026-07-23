# Testing Checklist — DriveSync & DishLens

DishLens is consumed by an iOS app — includes dedicated iOS-integration test coverage (HEIC, background upload, token refresh, cellular network conditions).

---

## DriveSync — Testing Checklist

**Unit tests**
- [ ] Change detection: correctly identifies new/updated/deleted files given mock Drive API responses
- [ ] Content hashing: same content → same hash; modified content → different hash
- [ ] Chunking: correct chunk sizes/overlap, metadata (fileId, title, chunk index) attached correctly
- [ ] Dedup logic: unchanged files skipped, only diffs re-embedded
- [ ] Pinecone ID scheme: stable, collision-free IDs (`{fileId}-{chunkIndex}`), upserts don't duplicate

**Integration tests**
- [ ] Full sync run against a real (test) Drive folder — add/modify/delete a file, confirm Pinecone reflects it after sync
- [ ] Extraction across file types: Google Docs, Sheets, PDFs (including scanned/OCR), Slides
- [ ] Pinecone upsert/delete/query round-trip with real API calls (staging index)
- [ ] Prisma migrations run cleanly against a fresh DB; `DriveFile` table reflects sync state accurately
- [ ] Retrieval endpoint returns correct top-k chunks with accurate source attribution for a known query

**Failure & resilience tests**
- [ ] Drive API rate limit / 429 → retry with backoff, doesn't crash the sync job
- [ ] Embedding API timeout/failure → job fails gracefully, doesn't leave partial/corrupt state, retriable on next run
- [ ] Pinecone write failure mid-batch → no silent data loss, sync marked as failed/partial rather than "success"
- [ ] Malformed/corrupted file in the folder (e.g. empty doc, unsupported format) → skipped with a logged warning, doesn't halt the whole sync
- [ ] Concurrent sync runs (e.g. scheduled job overlaps a manual trigger) → locking prevents duplicate/conflicting writes

**Scheduling & observability**
- [ ] Cron/queue trigger fires on schedule reliably
- [ ] Sync status endpoint reflects last run time, success/failure, files processed
- [ ] Alerting fires on repeated sync failures

---

## DishLens — Testing Checklist

**Unit tests**
- [x] File-type/magic-byte validation rejects mismatched extensions (`07-implementation-log.md` Cycle 4); composed end-to-end with dimension + blur checks and verified live on `POST /upload` (Cycle 5)
- [x] Laplacian variance blur check: correctly flags blurry test images below threshold, passes sharp ones (`07-implementation-log.md` Cycle 3, synthetic images); confirmed wired *before* any Vision call on the live route (Cycle 5)
- [x] Pixel-dimension limit rejects oversized decoded images, reports actual width/height (`07-implementation-log.md` Cycle 5) — real HEIC inputs still fail closed as unreadable pending HEIC→JPEG normalization
- [ ] Blur threshold calibration test set (mix of clear/blurry photos) — confirms no false positives on clearly sharp images. Still needs *real* photo fixtures — synthetic sharp/blurred pairs confirm the algorithm responds correctly but aren't real-world calibration.
- [x] EXIF stripping confirmed on output (no leaked GPS/device data), including proof orientation correction is applied *before* stripping (dimension swap on a 90°-tagged input) (`07-implementation-log.md` Cycle 6)
- [x] Session store: create/read/expire session state correctly (TTL behavior), including cross-user scoping and sliding-TTL-on-activity, verified against real Redis (`07-implementation-log.md` Cycle 7)
- [x] Save-chat: session data correctly snapshotted into immutable Postgres record, owner-scoped listing/view, verified against real Postgres (`07-implementation-log.md` Cycle 8). Snapshots from a `ChatMessage[]` directly, not yet from a live Redis session (no route wires the two together yet).

**Edge case tests (dedicated fixture images required)**
- [ ] **Multi-dish photo** → correctly rejected with the right error message, not silently picking one dish
- [ ] **Blurred/pixelated photo** → rejected by blur check *before* Vision is called (confirm via logs/mocks that Vision API wasn't hit)
- [ ] **Non-dish item photo** (raw egg, carrot, empty plate, random object) → rejected, not misidentified as a dish
- [ ] Borderline cases: dish with garnish/side (single dish, should pass), two similar items plated together (ambiguous — confirm expected behavior is defined)
- [ ] Vision low-confidence-but-not-blurry (e.g. poor lighting, odd angle) → rejected via confidence threshold, distinct error message from the blur rejection

**Integration tests**
- [ ] End-to-end: valid dish photo → recipe + nutrition returned with correct structure
- [ ] Vision API real call against fixture set (not mocked) at least in staging, to catch drift in label naming/confidence over time
- [ ] Nutrition data matches expected ranges for known test dishes (sanity bounds, not exact match)
- [ ] Recipe feasibility: no exotic equipment/ingredients in generated recipes (spot-check against a rubric)
- [ ] Save-chat → list-chats → view-chat flow returns correct, immutable data
- [ ] Attempting to POST a new message into a saved (archived) chat ID is rejected

**iOS-specific integration tests**
- [ ] **HEIC/HEIF images** (iOS camera default format) are accepted and correctly re-encoded
- [ ] Large photo uploads (10–20MB+ iPhone camera output) — size limits sized for real camera output, not just test fixtures
- [ ] Multipart upload from `URLSession` (including background upload tasks) completes correctly, including retry on interrupted connection
- [ ] Auth token refresh mid-session — app backgrounded, token expires, resumes — session isn't lost, request retried transparently or app gets a clear 401 to re-auth
- [ ] Poor network simulation (cellular/3G-like conditions, packet loss) — upload either completes or fails cleanly with a retryable error, no hung requests
- [ ] Image orientation from iOS (portrait photos with EXIF rotation) — confirm re-encoded image isn't sideways after EXIF stripping (orientation correction applied before stripping)
- [ ] App-backgrounded-mid-request behavior — confirm response arrives on resume rather than being lost

**Abuse/rate-limit tests**
- [ ] Per-user upload rate limit enforced correctly (test with rapid successive uploads)
- [ ] Moderation pass catches inappropriate image content in a test set

---

*Covers both APIs within the shared monorepo. Pair with `security-checklist.md` and `milestones-checklist.md` for full project coverage.*
