# Milestone Checklists — DriveSync & DishLens

Toolchain: pnpm + Turborepo (proposed default) · Pinecone · Redis · Postgres + Prisma · Google Vision + Laplacian blur detection · iOS-consumed.

---

## DriveSync — Google Drive → Pinecone Vector Sync API

- [ ] **1. Auth & access** — Google service account/OAuth setup scoped to target folder(s); Pinecone API key setup
- [ ] **2. Change detection** — list folder contents, track file IDs + modification timestamps, detect new/updated/deleted files
- [ ] **3. Extraction pipeline** — convert Docs/Sheets/PDFs/Slides to plain text; OCR for scanned PDFs if needed
- [ ] **4. Chunking strategy** — split text into retrieval-sized chunks with overlap; preserve source metadata (file ID, title, section)
- [ ] **5. Embedding generation** — OpenAI `text-embedding-3-small`, batch requests, handle rate limits/retries (see `06-toolchain-decisions.md`)
- [ ] **6. Pinecone index writes** — define index name, dimension (matching embedding model output), metadata schema (file ID, title, chunk index, source URL); stable vector ID scheme (`{fileId}-{chunkIndex}`) for clean upserts
- [ ] **7. Dedup & versioning** — skip unchanged files via content hash comparison; re-embed only diffs; delete stale Pinecone vectors on file deletion
- [ ] **8. Sync state persistence (Postgres/Prisma)** — `DriveFile` model tracking `driveFileId`, `contentHash`, `driveModifiedTime`, `chunkIds`, `lastSyncedAt`
- [ ] **9. Scheduling** — BullMQ + Redis queue, periodic sync with job locking to prevent overlapping runs (see `06-toolchain-decisions.md`)
- [ ] **10. Retrieval endpoint** — query API taking a prompt, returning top-k relevant chunks with source attribution
- [ ] **11. Observability** — sync logs, failure alerts, last-sync-status endpoint
- [ ] **12. Testing & deploy** — unit tests (chunking/dedup), integration tests against test Drive folder + staging Pinecone index, CI/CD

---

## DishLens — Dish Photo → Recipe + Nutrition API (iOS)

- [x] **1. Upload endpoint** — image intake (multipart/base64), file-type validation, size/dimension limits sized for real iPhone camera output (HEIC, 10–20MB+). Live `POST /upload` route (multer multipart intake, file-type + size + pixel-dimension validation, all unit-tested and verified live) — see `07-implementation-log.md` Cycle 5. Now also gated by real JWT auth + per-user rate limiting (Cycle 10). Still missing: GCS pre-signed URLs (tracked in `01-security-checklist.md` §5).
- [ ] **2. Preprocessing** — `sharp` re-encode, EXIF strip (after orientation correction), format normalization from HEIC. `normalizeImage()` implemented + unit-tested (`07-implementation-log.md` Cycle 6) — orientation-correct re-encode with EXIF stripped, JPEG/PNG output by content. Not yet wired into the route (no storage target yet); real iPhone HEIC still undecodable in this environment (Cycle 5/6 libvips/HEVC note).
- [x] **3. Blur detection** — Laplacian variance check run *before* Vision call; reject unusable images early to save API cost. Wired live into `POST /upload`, running before any Vision call (which doesn't exist yet) — see `07-implementation-log.md` Cycles 3 & 5.
- [x] **4. Dish detection (Google Vision)** — label/object detection, extract candidate dish name + confidence score. `analyzeImage()` implemented + unit-tested against a mocked Vision client (`07-implementation-log.md` Cycle 11), wired live into `POST /upload` and verified against the real Vision API (real credentials landed after Cycle 10).
- [x] **5. Edge case: multi-dish rejection** — multiple distinct food labels above confidence threshold → reject with clear message. `classifyDish()` rejects as `multi-dish` when more than one specific (non-category, non-raw-ingredient) label clears the confidence threshold (`07-implementation-log.md` Cycle 11). Verified via unit tests only — no real multi-dish photo fixture exists yet.
- [x] **6. Edge case: non-dish rejection** — raw-ingredient/non-food labels (egg, carrot, plate, person) → reject with clear message. `classifyDish()` rejects as `non-dish` for zero food-related labels *and* for raw-ingredient-only labels (egg/carrot are food-related but not a finished dish) (`07-implementation-log.md` Cycle 11).
- [x] **7. Edge case: low Vision-confidence rejection** — distinct from blur rejection (covers poor lighting/odd angle cases that pass the blur check but Vision still can't confidently identify). `classifyDish()` returns `low-confidence` when generic food evidence is present but no specific label clears `DISH_CONFIDENCE_THRESHOLD` (`07-implementation-log.md` Cycle 11).
- [x] **8. Recipe generation** — Anthropic Claude call using identified dish, ingredient list + steps, home-kitchen feasibility constraints (see `06-toolchain-decisions.md`). `generateRecipe()` implemented + unit-tested against a mocked client, and verified live against the real Claude API (`07-implementation-log.md` Cycle 12). Not yet wired into `POST /upload` — deferred until nutrition lookup (#9) can be assembled into the same response (#11) in one pass.
- [ ] **9. Nutrition info** — Edamam lookup matched to generated ingredients
- [x] **10. Session management (Redis)** — session creation/expiry (TTL-based), session-scoped message state, session ID issuance. `createSessionStore()` implemented + unit-tested against real Redis, including live TTL/sliding-expiration behavior (`07-implementation-log.md` Cycle 7). Not yet wired into a route — no Vision integration exists yet to start a real session.
- [ ] **11. Response assembly** — structured chat response appended to Redis session; consistent error schema across all rejection paths
- [x] **12. Save-chat flow (Postgres/Prisma)** — snapshot Redis session → immutable `SavedChat` record (JSONB messages); reject any write attempt to an already-saved chat. `saveChat()` implemented + unit-tested against real Postgres (`07-implementation-log.md` Cycle 8) — write-once enforced by having no update path at all. `saveChat()` itself still has no route (no session→save trigger exists — that needs Vision/recipe generation first); no endpoint exists yet that could attempt a post-archive write.
- [x] **13. History listing** — list user's saved chats + read-only view-saved-chat endpoint. `listSavedChats()`/`getSavedChat()` implemented + unit-tested against real Postgres, owner-scoped (`07-implementation-log.md` Cycle 8) — **and now live**: `GET /chats` + `GET /chats/:chatId`, gated by real JWT verification (`shared-auth`'s `requireAuth`), verified end-to-end with real tokens/users/data (`07-implementation-log.md` Cycle 9).
- [x] **14. Abuse/rate limiting & moderation** — per-user upload limits (Redis-backed), NSFW/inappropriate content moderation pass. Per-user upload rate limiting live on `POST /upload`, verified live including cross-user isolation (`07-implementation-log.md` Cycle 10). Moderation (`checkModeration()`, reading the same Vision call's SafeSearch annotation) now implemented, unit-tested, and wired live ahead of dish classification (`07-implementation-log.md` Cycle 11).
- [ ] **15. Testing** — full edge case fixture set (multi-dish, blurry, non-dish, borderline cases), blur threshold calibration, iOS-specific integration tests (HEIC, background upload, token refresh, poor network)
- [ ] **16. Deploy** — staging environment with real Vision + Pinecone-adjacent services before prod cutover

---

*Both APIs share `packages/shared-db` (Prisma schema/client) and the broader monorepo tooling. See `monorepo-structure.md` for the folder layout.*
