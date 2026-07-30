# Testing Checklist — DriveSync & DishLens

DishLens is consumed by an iOS app — includes dedicated iOS-integration test coverage (HEIC, background upload, token refresh, cellular network conditions).

---

## DriveSync — Testing Checklist

**Unit tests**
- [x] Change detection: correctly identifies new/updated/deleted files given mock Drive API responses. `detectChanges()`, 5 cases (`07-implementation-log.md` Cycle 18), plus verified live against a real 7-file Drive folder covering all three branches.
- [x] Content hashing: same content → same hash; modified content → different hash. `computeContentHash()`/`shouldReembedFile()`, 7 cases (Cycle 23), plus verified live that two independent real extractions of the same real Drive doc hash identically.
- [x] Chunking: correct chunk sizes/overlap, metadata (fileId, title, chunk index) attached correctly. `chunkText()`, 9 cases (Cycle 20), plus verified live against all 7 real extracted Drive docs.
- [x] Dedup logic: unchanged files skipped, only diffs re-embedded. Covered by `shouldReembedFile()`'s tests above plus `run-sync-once.test.ts`'s "skips re-embedding on a second run where the file's real content is unchanged" (Cycle 25), verified live via a real second sync run doing zero redundant work.
- [x] Pinecone ID scheme: stable, collision-free IDs (`{fileId}-{chunkIndex}`), upserts don't duplicate. `vectorId()`, unit-tested and verified live via a real upsert/fetch round-trip (Cycle 22).

**Integration tests**
- [ ] Full sync run against a real (test) Drive folder — add/modify/delete a file, confirm Pinecone reflects it after sync. **Add/modify covered live** (Cycles 25-27: real new-file syncs, repeatedly, via the real BullMQ worker). **Delete not covered against a real Drive deletion** — `deleteVectorsForFile`'s deletion mechanism itself is real-verified (Cycle 23, fabricated file IDs) and `runSyncOnce` correctly handles `detectChanges`'s `deletedFileIds` output (unit-tested, Cycle 25), but no cycle has actually deleted one of the 7 real shared test-folder documents to observe a real end-to-end deletion sync, since that's a destructive action against shared test data outside this session's scope to take unprompted.
- [ ] Extraction across file types: Google Docs, Sheets, PDFs (including scanned/OCR), Slides. **Google Docs real** (all 7 test files, Cycle 19). **Sheets/Slides**: implemented and unit-tested (Cycle 19) but no real file of either type exists in the test folder. **PDF**: real parsing verified against a real generated PDF (Cycle 19, not a real Drive-hosted PDF). **Scanned/OCR PDF**: detected but not implemented (see Milestone #3's note) — deliberately out of scope pending a real fixture and a dedicated OCR cycle.
- [x] Pinecone upsert/delete/query round-trip with real API calls (staging index). No separate staging index exists — the real `drive-sync-dev` index has been used as the de facto test/staging index throughout (matches how DishLens's cycles used real dev credentials). Upsert (Cycle 22), delete (Cycle 23), and query (Cycle 26) each verified live against it, including full cleanup after each run.
- [x] Prisma migrations run cleanly against a fresh DB; `DriveFile` table reflects sync state accurately. The migration itself was applied and verified in Cycle 17; the `DriveFile` table has been read/written correctly across every Cycle 24-27 live verification (real rows created, updated, and deleted matching real sync outcomes).
- [x] Retrieval endpoint returns correct top-k chunks with accurate source attribution for a known query. Verified live through the real HTTP route: a real query for "How do I make banana pancakes?" correctly returned the real matching document as the top result with correct attribution (`07-implementation-log.md` Cycle 26).

**Failure & resilience tests**
- [ ] Drive API rate limit / 429 → retry with backoff, doesn't crash the sync job. **Not implemented** — `listDriveFiles`/`extractText` have no retry/backoff logic at all; only `generateEmbeddings` (OpenAI) has this. A real, standing gap, distinct from the embedding-retry item below.
- [x] Embedding API timeout/failure → job fails gracefully, doesn't leave partial/corrupt state, retriable on next run. `generateEmbeddings` retries transient failures internally (Cycle 21, unit-tested incl. exponential backoff); if it still fails, `syncOneFile` returns a failure without persisting sync state for that file (Cycle 25), so the file is naturally retried as "new"/"updated" on the next run - no corrupt partial state, confirmed via the real partial-failure live check in Cycle 27.
- [ ] Pinecone write failure mid-batch → no silent data loss, sync marked as failed/partial rather than "success". The "marked as failed, not silently successful" half is true and tested (`upsertChunkVectors` returning `ok: false` propagates to a per-file `failures` entry, Cycle 25/27). The "no data loss" half has a real, undocumented-until-now edge case: if an earlier batch within a multi-batch upsert for one file succeeds and a later batch fails, the earlier batch's vectors are already real and written, but no sync-state record gets persisted (since the whole `syncOneFile` call reports failure) - a full re-sync on the next run would call `deleteVectorsForFile` before re-upserting, which is self-healing, but this exact scenario has not been deliberately tested.
- [x] Malformed/corrupted file in the folder (e.g. empty doc, unsupported format) → skipped with a logged warning, doesn't halt the whole sync. `run-sync-once.test.ts`'s "records a per-file failure without aborting the rest of the run" (Cycle 25) plus a real live check with 7 real files all failing extraction simultaneously, each individually logged, the run still completing (Cycle 27).
- [x] Concurrent sync runs (e.g. scheduled job overlaps a manual trigger) → locking prevents duplicate/conflicting writes. `jobs/lock.ts`, unit-tested against real Redis (5 cases, Cycle 25) and verified live: a manually-held lock caused a real triggered job to skip rather than run concurrently.

**Scheduling & observability**
- [ ] Cron/queue trigger fires on schedule reliably. `scheduleSyncJob`'s repeatable-job *registration* is confirmed live against real Redis (doesn't throw, Cycles 25-27), but no cycle has actually waited out a real cron interval to observe the job self-firing on schedule - impractical to verify without waiting the full interval in real time.
- [x] Sync status endpoint reflects last run time, success/failure, files processed. Verified live across all three states - no sync yet, a real success, a real total failure, and a real partial failure - each via a real `GET /sync/status` call (`07-implementation-log.md` Cycle 27).
- [ ] Alerting fires on repeated sync failures. The log-based signal a real alerting layer would consume exists (`sync-run-had-failures`, Cycle 27), but there's no actual alert *delivery* (no PagerDuty/Sentry/etc. configured, per `06-toolchain-decisions.md`'s deferred list) and no "N consecutive failures" detection logic - only per-run failure logging.

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
- [x] JWT verification: valid token accepted and `userId` extracted correctly; missing/expired/wrong-secret/malformed(no-`sub`)/non-JWT tokens all rejected with the correct internal reason but an identical external `401` (`07-implementation-log.md` Cycle 9)
- [x] Vision label mapping: `analyzeImage()` correctly maps mocked label/SafeSearch annotations, requests both feature types in one call, and defaults sanely when Vision returns nothing (`07-implementation-log.md` Cycle 11, mocked client - no live network in the test suite)
- [x] Moderation: SafeSearch likelihood table (`LIKELY`/`VERY_LIKELY` blocks per category, `POSSIBLE` and medical/spoof never block) (`07-implementation-log.md` Cycle 11)
- [x] Dish classification heuristic: single dish accepted, two distinct dishes → multi-dish, raw ingredients → non-dish, empty plate/person/unrelated object → non-dish, generic-evidence-only → low-confidence, dish-with-garnish → still accepted (`07-implementation-log.md` Cycle 11) — against hand-built label arrays, not real Vision output
- [x] Recipe generation: well-formed JSON round-trips correctly, dish name/model passed through to the API call, non-JSON and incomplete-JSON responses both reject as `invalid-response` (`07-implementation-log.md` Cycle 12) — against a mocked Anthropic client
- [x] Nutrition lookup: sums per-ingredient nutrients correctly across multiple ingredients, unmatched ingredients contribute zero rather than breaking the sum, non-2xx responses reject as `lookup-failed`, zero-calorie/malformed responses reject as `no-nutrition-data` (`07-implementation-log.md` Cycle 13) — against a mocked `fetch` shaped to match the real (not documented) Edamam response

**Edge case tests (dedicated fixture images required)**
- [x] **Multi-dish photo** → correctly rejected with the right error message, not silently picking one dish. Logic implemented and unit-tested against synthetic label sets (`07-implementation-log.md` Cycle 11); no real multi-dish photo fixture exists yet to confirm real-world Vision output triggers it correctly.
- [x] **Blurred/pixelated photo** → rejected by blur check *before* Vision is called (confirm via logs/mocks that Vision API wasn't hit). Reconfirmed live in Cycle 11 with the real Vision call now present after the blur check - a flat synthetic image still short-circuits at `422 too-blurry`.
- [x] **Non-dish item photo** (raw egg, carrot, empty plate, random object) → rejected, not misidentified as a dish. Unit-tested for all four cases against synthetic label sets (`07-implementation-log.md` Cycle 11); a synthetic (non-photographic) checkerboard image was also confirmed live against the real Vision API to return `non-dish`. Real photos of an actual egg/carrot/empty plate still untested.
- [ ] Borderline cases: dish with garnish/side (single dish, should pass - unit-tested, Cycle 11), two similar items plated together (ambiguous — heuristic behavior is defined as `multi-dish`, but unconfirmed against a real photo of two similar dishes)
- [x] Vision low-confidence-but-not-blurry (e.g. poor lighting, odd angle) → rejected via confidence threshold, distinct error message from the blur rejection. Unit-tested (`07-implementation-log.md` Cycle 11) against synthetic label sets with food-category evidence but no specific label clearing the threshold; no real poor-lighting photo fixture yet.

**Integration tests**
- [ ] End-to-end: valid dish photo → recipe + nutrition returned with correct structure. `POST /upload`'s assembly logic (recipe → nutrition → session) is verified live end-to-end via a standalone script chaining the real APIs (`07-implementation-log.md` Cycle 14), but no real dish photo exists yet to drive this through the actual HTTP route and a real Vision classification.
- [ ] Vision API real call against fixture set (not mocked) at least in staging, to catch drift in label naming/confidence over time
- [x] Nutrition data matches expected ranges for known test dishes (sanity bounds, not exact match). Real live call for an 8-serving Margherita Pizza returned ~2175 total kcal (~272 kcal/serving) — a plausible sanity-bound result, spot-checked once (`07-implementation-log.md` Cycle 13), not across a broader known-dish test set.
- [ ] Recipe feasibility: no exotic equipment/ingredients in generated recipes (spot-check against a rubric). One real Claude-generated recipe (Margherita Pizza) was spot-checked live and held up - grocery-store ingredients, standard oven/baking-sheet equipment (`07-implementation-log.md` Cycle 12) - but this is a single manual sample, not a rubric applied across a real test set.
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
- [ ] Moderation pass catches inappropriate image content in a test set. `checkModeration()`'s likelihood-threshold logic is unit-tested (`07-implementation-log.md` Cycle 11), but there's no real inappropriate-image test set to confirm Vision's SafeSearch actually flags real content correctly end-to-end - deliberately not sourced in this project.

---

*Covers both APIs within the shared monorepo. Pair with `security-checklist.md` and `milestones-checklist.md` for full project coverage.*
