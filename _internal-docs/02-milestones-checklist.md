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

- [ ] **1. Upload endpoint** — image intake (multipart/base64), file-type validation, size/dimension limits sized for real iPhone camera output (HEIC, 10–20MB+). File-type + size validation implemented + unit-tested (`07-implementation-log.md` Cycle 4) — no route/multipart handling or pixel-dimension limit yet.
- [ ] **2. Preprocessing** — `sharp` re-encode, EXIF strip (after orientation correction), format normalization from HEIC
- [ ] **3. Blur detection** — Laplacian variance check run *before* Vision call; reject unusable images early to save API cost. Algorithm implemented and unit-tested (`07-implementation-log.md` Cycle 3) — not yet wired before a Vision call, since there's no upload endpoint/Vision integration yet.
- [ ] **4. Dish detection (Google Vision)** — label/object detection, extract candidate dish name + confidence score
- [ ] **5. Edge case: multi-dish rejection** — multiple distinct food labels above confidence threshold → reject with clear message
- [ ] **6. Edge case: non-dish rejection** — raw-ingredient/non-food labels (egg, carrot, plate, person) → reject with clear message
- [ ] **7. Edge case: low Vision-confidence rejection** — distinct from blur rejection (covers poor lighting/odd angle cases that pass the blur check but Vision still can't confidently identify)
- [ ] **8. Recipe generation** — Anthropic Claude call using identified dish, ingredient list + steps, home-kitchen feasibility constraints (see `06-toolchain-decisions.md`)
- [ ] **9. Nutrition info** — Edamam lookup matched to generated ingredients
- [ ] **10. Session management (Redis)** — session creation/expiry (TTL-based), session-scoped message state, session ID issuance
- [ ] **11. Response assembly** — structured chat response appended to Redis session; consistent error schema across all rejection paths
- [ ] **12. Save-chat flow (Postgres/Prisma)** — snapshot Redis session → immutable `SavedChat` record (JSONB messages); reject any write attempt to an already-saved chat
- [ ] **13. History listing** — list user's saved chats + read-only view-saved-chat endpoint
- [ ] **14. Abuse/rate limiting & moderation** — per-user upload limits (Redis-backed), NSFW/inappropriate content moderation pass
- [ ] **15. Testing** — full edge case fixture set (multi-dish, blurry, non-dish, borderline cases), blur threshold calibration, iOS-specific integration tests (HEIC, background upload, token refresh, poor network)
- [ ] **16. Deploy** — staging environment with real Vision + Pinecone-adjacent services before prod cutover

---

*Both APIs share `packages/shared-db` (Prisma schema/client) and the broader monorepo tooling. See `monorepo-structure.md` for the folder layout.*
