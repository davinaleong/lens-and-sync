# Security Checklist — DriveSync & DishLens

Updated for the finalized toolchain: Pinecone (vector store), Redis (session state), Postgres + Prisma (persistent storage), Google Vision + Laplacian blur detection (DishLens), iOS client.

---

## 1. Authentication & Authorization

- [ ] Use short-lived JWTs (15–30 min) with refresh token rotation, or server-side sessions. **Verification** side implemented (`shared-auth`'s `verifyAccessToken`/`requireAuth`, `07-implementation-log.md` Cycle 9) — no login/token-issuance endpoint or refresh-rotation exists yet, so there's still no way for a real client to obtain a token.
- [ ] Store refresh tokens hashed in the DB; revoke on logout or breach detection. `RefreshToken` Prisma model exists but nothing writes to it yet — blocked on the same token-issuance work as above.
- [x] Never trust client-supplied user/role IDs — derive identity from the verified token only. Enforced live on `GET /chats`/`GET /chats/:chatId` — `req.userId` comes only from `requireAuth`'s verified JWT `sub` claim (`07-implementation-log.md` Cycle 9).
- [ ] Enforce RBAC/ABAC checks on every endpoint, not just at the route level
- [x] Guard against IDOR — e.g. a user can only list/view *their own* saved chats (DishLens), and DriveSync retrieval respects folder-level access scoping. DishLens half verified live: a second user's token against another user's chat ID returns the identical `404` as a nonexistent ID — no cross-user existence leak (`07-implementation-log.md` Cycle 9). DriveSync half not started.
- [ ] Reject any attempt to POST/modify a saved (archived) DishLens chat — enforce immutability server-side, not just in the client. `saveChat()` has no update path at all (`07-implementation-log.md` Cycle 8), but that's not yet an *enforced rejection* — no continue-chat endpoint exists yet that could even attempt a post-archive write, so there's nothing to assert against.
- [x] Handle iOS token refresh gracefully across app backgrounding — expired token returns a clean 401, not a hang or silent failure. Verified live: expired/malformed/invalid/missing tokens all return the identical `401 { error: { code: "unauthorized", ... } }`, never a hang or a differently-shaped error (`07-implementation-log.md` Cycle 9). The client-side *refresh* flow itself still doesn't exist (no issuance endpoint).

## 2. Transport & Headers

- [ ] Enforce HTTPS everywhere; enable HSTS
- [x] Use `helmet` for security headers (CSP, X-Content-Type-Options, X-Frame-Options, etc.) — defaults only so far, no custom CSP yet (see `07-implementation-log.md` Cycle 2)
- [x] Set `Access-Control-Allow-Origin` to an explicit allowlist, not `*` (see `07-implementation-log.md` Cycle 2)
- [x] Disable framework fingerprinting (`app.disable('x-powered-by')`)

## 3. Input Handling

- [ ] Validate/sanitize all input with a schema library (`zod`, `joi`, `yup`)
- [ ] Validate body, query params, AND headers
- [ ] Use Prisma's parameterized queries — never raw string-concatenated SQL, even via `$queryRaw`
- [ ] Enforce request size limits appropriate to real iOS camera output (10–20MB+ HEIC files), not just small test fixtures
- [ ] Validate `Content-Type` strictly; reject unexpected MIME types
- [ ] Sanitize/escape any user-supplied text (chat titles, etc.) before storage and on render

## 4. DriveSync-Specific

- [ ] Google service account credentials scoped to only the target folder(s), not full Drive access
- [ ] Pinecone API key stored via secrets manager, not env files committed to the repo
- [ ] Pinecone metadata never includes sensitive raw content — only IDs, titles, and retrieval-relevant fields
- [ ] Namespace isolation in Pinecone if multiple folders/tenants are ever supported — prevent cross-tenant retrieval leakage
- [ ] Stable vector ID scheme (`{fileId}-{chunkIndex}`) prevents duplicate/orphaned vectors on re-sync
- [ ] Deleted Drive files trigger actual Pinecone vector deletion, not just a DB flag — stale vectors are a data leakage risk in retrieval results
- [ ] Sync job locking prevents concurrent runs from producing conflicting writes (BullMQ + Redis, see `06-toolchain-decisions.md`)

## 5. DishLens-Specific — Image Upload Security

- [x] Verify actual file signature (magic bytes) via `file-type` — never trust client MIME type/extension, including iOS-supplied HEIC headers. Enforced live on `POST /upload` (`07-implementation-log.md` Cycle 5).
- [ ] Re-encode every uploaded image server-side (`sharp`) rather than storing the raw upload. `normalizeImage()` implemented + unit-tested (`07-implementation-log.md` Cycle 6) — not yet called on the live route, since there's no storage target for the output yet.
- [x] Apply Laplacian variance blur check *before* calling Google Vision — rejects unusable images without incurring Vision API cost. Wired live on `POST /upload`, ahead of any Vision call (`07-implementation-log.md` Cycle 5).
- [x] Strip EXIF metadata on re-encode (GPS, device info) — but apply orientation correction *before* stripping, so images aren't left sideways. `normalizeImage()` applies `.rotate()` (orientation correction) before re-encoding without `.withMetadata()` (which is what drops EXIF/GPS) — unit-tested including the dimension-swap proof that rotation is actually baked into pixels (`07-implementation-log.md` Cycle 6). Not yet called on the live route.
- [x] Enforce file size AND pixel dimension limits sized for real iPhone camera output. Both enforced live on `POST /upload` (`MAX_UPLOAD_SIZE_MB`, `MAX_IMAGE_DIMENSION_PX`) — see `07-implementation-log.md` Cycle 5. Note: real HEIC dimension-checking doesn't work yet — this environment's libvips can't decode HEVC-coded HEIC, so it fails closed as `unreadable-image` until HEIC→JPEG normalization exists.
- [x] Allowlist formats strictly (HEIC/HEIF input accepted and converted, JPEG/PNG/WEBP as processed output); reject everything else. Enforced live on `POST /upload` (`07-implementation-log.md` Cycle 5).
- [x] Treat SVG as executable script if ever accepted anywhere in the stack — sanitize or disallow entirely (`validateUpload` never accepts SVG regardless of route wiring — see `07-implementation-log.md` Cycle 4)
- [ ] Upload to object storage (Google Cloud Storage) via pre-signed URLs rather than routing raw binary through the API server where avoidable (see `06-toolchain-decisions.md`)
- [ ] Use random, non-guessable object keys (UUID) — never the user-supplied filename
- [ ] Keep any stored images private by default; signed, expiring URLs only

## 6. DishLens-Specific — Edge Case Enforcement

- [x] Multi-dish photos are rejected with a clear, distinct error — never silently pick one dish. `classifyDish()` rejects `multi-dish` when more than one specific candidate label clears the confidence threshold; unit-tested (`07-implementation-log.md` Cycle 11) — not yet verified against a real multi-dish photo fixture.
- [x] Blurred/pixelated photos are rejected by the local blur check *before* Vision is invoked (verify via logs/mocks that Vision wasn't called). Confirmed live in Cycle 5 and reconfirmed in Cycle 11 with the Vision stage now added after it — a flat-color synthetic image still gets `422 too-blurry` without ever reaching the Vision call.
- [x] Non-dish items (raw ingredients, empty plates, unrelated objects) are rejected, not misidentified. `classifyDish()` treats raw-ingredient labels (egg, carrot, ...) and zero-food-evidence labels (plate, person, unrelated objects) both as `non-dish`; unit-tested (`07-implementation-log.md` Cycle 11).
- [x] Each rejection path returns a distinct, non-leaky error message (no internal confidence scores or model details exposed to the client). `POST /upload`'s `DISH_REJECTION_RESPONSES`/moderation responses return fixed messages per reason code, never echoing label names or Vision scores (`07-implementation-log.md` Cycle 11).
- [ ] Borderline cases (dish + garnish/side, ambiguous plating) have explicitly defined expected behavior, not undefined/inconsistent behavior. "Dish + garnish" is covered (a garnish typically surfaces only as a generic/category label, so the single specific dish label still wins) and unit-tested, but genuinely ambiguous plating (two visually-similar dishes) is untested against real photos — heuristic only, no real fixture set exists yet.

## 7. Session & Chat History (Redis + Postgres)

- [x] Redis session state is scoped per user/session ID — no cross-session data leakage. Enforced by the key scheme itself (`dishlens:session:{userId}:{sessionId}`) — a session ID alone can't read another user's session; unit-tested (`07-implementation-log.md` Cycle 7).
- [x] Session TTL enforced (auto-expire inactive sessions) rather than growing Redis memory unbounded. Sliding TTL — every write refreshes `EX ttlSeconds`; verified live against real Redis expiry, not a mock (`07-implementation-log.md` Cycle 7).
- [x] Saved chats in Postgres are write-once — no update path exists once a chat is archived. `saveChat()` only ever creates; there is no update function anywhere in the codebase for `SavedChat` (`07-implementation-log.md` Cycle 8).
- [x] `SavedChat` records are only readable by their owning user (authorization check on every list/view call). `listSavedChats`/`getSavedChat` are owner-scoped and unit-tested against real Postgres with a second user (`07-implementation-log.md` Cycle 8) — **and now live** on `GET /chats`/`GET /chats/:chatId` behind real JWT auth (`07-implementation-log.md` Cycle 9).
- [ ] Redis connection uses auth (password/ACL) and TLS if hosted externally, not an open unauthenticated instance

## 8. Abuse Prevention & Moderation

- [x] Rate-limit API requests per IP/user/API key (`express-rate-limit` + `rate-limit-redis`, live on both apps — see `07-implementation-log.md` Cycle 2)
- [ ] Rate-limit image uploads per user (count and bandwidth) — iOS clients may retry aggressively on poor cellular connections, so limits need to tolerate legitimate retries without allowing abuse. Count-based limiting live on `POST /upload`, Redis-backed, keyed on verified `userId` (not IP), verified live including cross-user isolation (`07-implementation-log.md` Cycle 10). Bandwidth-based limiting not done.
- [x] Run uploaded images through a moderation pipeline (NSFW/inappropriate content detection) before processing — reuses the Google Vision SafeSearch annotation, no separate provider (see `06-toolchain-decisions.md`). `checkModeration()` implemented, unit-tested, and wired live ahead of dish classification on `POST /upload` (`07-implementation-log.md` Cycle 11).
- [ ] Provide report/block/delete mechanisms for saved chats and images

## 9. Secrets & Configuration

- [ ] No hardcoded secrets — env variables + secrets manager (Vault, AWS Secrets Manager, Doppler)
- [ ] Separate Pinecone index, Redis instance, and Postgres DB per environment (dev/staging/prod) — never share a prod vector index or DB with staging
- [ ] Rotate API keys (Google, Pinecone, Vision, embedding provider) periodically

## 10. Dependency & Runtime Hygiene

- [ ] Run `npm audit` / Snyk / Dependabot regularly; commit a lockfile
- [ ] Keep Prisma, Pinecone SDK, and Vision client libraries current — these get frequent security patches
- [ ] Run the Node process as a non-root user; minimal base Docker images

## 11. Error Handling & Logging

- [x] Never leak stack traces, Prisma errors, or internal paths in responses. True for every live DishLens route (`/upload`, `/chats`) — each has a catch-all error middleware returning a fixed generic `500` JSON body; verified live in Cycle 11 that a real Vision gRPC error (`PERMISSION_DENIED` with internal project/API details) surfaces only server-side, never in the client response. Not yet applicable to `drive-sync` (no live routes exist there yet).
- [ ] Centralize error-handling middleware across both apps (shared package) — currently duplicated inline per-route (`routes/upload.ts`, `routes/history.ts`), not lifted into a shared package.
- [ ] Log security-relevant events (failed logins, permission denials, rejected uploads, rate-limit hits). Partial: unexpected/unhandled errors are now logged server-side (`console.error`, Cycle 11), but *expected* rejections (401s, 422s, 429s) still only produce a response, no log line — needs real structured logging via `shared-logger` (still a stub), not just console.error on the unexpected-error path.
- [ ] Never log raw image bytes, full chat content, or tokens — log references/IDs instead. No logging of these exists yet either way (nothing to violate this on), so this stays open pending the item above.

## 12. Infrastructure & Monitoring

- [ ] Postgres not publicly reachable — network-restricted (VPC/security groups)
- [ ] Redis not publicly reachable — same restriction
- [ ] Automated backups for Postgres (saved chats are user data — losing it is a real incident)
- [ ] Alert on anomalous traffic patterns (spikes in 401s/403s/429s, sudden upload volume spikes)
- [ ] APM/monitoring (Sentry, Datadog, or equivalent) across both services

---

*Tailored for DriveSync (Google Drive → Pinecone vector sync) and DishLens (dish photo → recipe + nutrition, iOS client) within a shared Postgres/Prisma + Redis monorepo.*
