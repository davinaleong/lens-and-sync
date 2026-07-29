# Implementation Log

Running log of real business-logic implementation, following the
implement → document → update checklists → commit/push cycle. Each entry
is one commit. See `05-progress.md` for the scaffolding baseline and
`06-toolchain-decisions.md` for vendor choices this builds on.

---

## 2026-07-22 — Cycle 1: `shared-config` env loader

**What:** `packages/shared-config/src/env.ts` now exports a real
`loadEnv(schema, source?)` — parses `process.env` (or an injected source,
for testing) against a Zod schema, and throws one readable error listing
every missing/invalid key if validation fails. Also exports two small
reusable pieces: `commaSeparated` (splits `"a, b, c"` into `["a","b","c"]`,
used for `CORS_ALLOWED_ORIGINS` and `GOOGLE_DRIVE_FOLDER_IDS`) and shared
`nodeEnvSchema`/`logLevelSchema` enums so both apps validate those the
same way.

**Why this first:** every other implementation cycle needs config that's
validated *before* the app tries to use it — better to crash immediately
with "JWT_ACCESS_SECRET is missing" than fail confusingly three requests
later. It also directly extends the `pnpm run env:check` scripts added
last session: `env:check` verifies presence at the shell level, `loadEnv`
verifies shape/type at process startup.

**Tests:** `packages/shared-config/tests/env.test.ts` — 5 cases (defaults
applied, values coerced/overridden, multi-field error message, comma-split
edge cases). All passing. `pnpm run typecheck` and `pnpm run build` pass
clean across all 9 workspace packages.

**Not done yet:** not wired into either app yet — that's Cycle 2.

---

## 2026-07-22 — Cycle 2: wire config, CORS, and rate limiting into both apps

**What:** Each app now has `src/config.ts` — a Zod schema matching its
`.env.example` exactly, parsed once via `loadEnv()` at import time. Both
`index.ts` files import `config` instead of reading `process.env`
directly, and now run real middleware that was previously just
`.env.example` placeholders:

- `cors({ origin: config.CORS_ALLOWED_ORIGINS })` — explicit allowlist,
  not `*` (`01-security-checklist.md` §2).
- `express-rate-limit` backed by `rate-limit-redis`, using a shared
  `ioredis` client (`01-security-checklist.md` §8). New files:
  `apps/dish-lens/src/session/redis-client.ts` (was a stub) and
  `apps/drive-sync/src/redis-client.ts` (new — also earmarked for BullMQ
  job locking later).

**Gotchas hit:** `ioredis`'s default export isn't constructable under
this project's `NodeNext`/`isolatedModules` TS config — fixed by using
the named `{ Redis }` export instead. `rate-limit-redis`'s `sendCommand`
type doesn't accept a plain spread of `ioredis.call(...args)` because
`call` is overloaded (TS can't resolve which overload against a
non-tuple spread) — fixed by passing the command as a positional arg and
spreading only the rest, then casting the return to `Promise<RedisReply>`.

**Verified live** (not just typecheck/build): started a temporary local
Redis, ran both compiled apps with their real `.env` files. `/health` on
both returns `200` with `RateLimit-*` response headers proving requests
are actually being counted through Redis, not an in-memory stub. Also
confirmed the fail-fast path: running `drive-sync` with an empty
environment crashes immediately with `Invalid environment
configuration: - CORS_ALLOWED_ORIGINS: Required` instead of starting
broken. Redis was shut down again afterward — no persistent process left
running.

**Not done yet:** `helmet()` config is still defaults (no custom CSP).
JWT verification middleware itself (`shared-auth`) is still a stub — config
validates the secrets exist, but nothing checks a token yet.

---

## 2026-07-22 — Cycle 3: DishLens blur detection

**What:** `apps/dish-lens/src/preprocessing/blur-detection.ts` implements
the Laplacian-variance blur check from `02-milestones-checklist.md` #3 and
`01-security-checklist.md` §5: greyscale the image, convolve with a 3×3
Laplacian kernel (`[0,1,0,1,-4,1,0,1,0]`), and return the variance of the
resulting pixel values. Flat/blurry regions produce near-zero edge
response (low variance); crisp edges produce large swings (high
variance). `isBlurry(buffer, threshold)` wraps it as a boolean check.
Threshold is a parameter, not read from config internally — keeps the
module a pure, dependency-free function so it's trivially unit-testable
and the actual threshold value (`BLUR_VARIANCE_THRESHOLD`) is supplied by
whatever calls it later (the upload pipeline, not yet built).

**Tests:** `tests/preprocessing/blur-detection.test.ts` — no real photo
fixtures needed. Generates synthetic images in-memory with `sharp`: a
flat uniform-gray image (variance ≈ 0) and a high-frequency checkerboard
(variance > 1000), then applies real Gaussian blur to the checkerboard
and confirms variance drops. That last case is the important one — it
proves the metric responds correctly to actual blurring, not just that
two arbitrary fixtures produce different numbers. 5 tests passing.

**Not done yet:** not wired into the upload pipeline (`src/upload/` is
still a TODO stub) — that's Cycle 4 territory, along with file-type
validation. Real photo fixtures (per `04-testing-checklist.md`'s
"dedicated fixture images required" for edge cases) still don't exist —
synthetic images validate the algorithm, not real-world calibration.

---

## 2026-07-22 — Cycle 4: DishLens upload validation

**What:** `apps/dish-lens/src/upload/index.ts` — `validateUpload(buffer,
{ maxSizeBytes })` implements the two checks from
`01-security-checklist.md` §5 that don't need a live service: real
magic-byte sniffing via `file-type` (never the client's claimed
Content-Type/extension) against a strict allowlist (JPEG/PNG/WEBP/HEIC/
HEIF — SVG and everything else rejected, since SVG is executable script
per the checklist), plus a size-limit check. Returns a discriminated
union (`ok: true` | `too-large` | `unrecognized-format` |
`unsupported-format`) so callers get a distinct, non-leaky reason per
rejection path (`01-security-checklist.md` §6's "distinct, non-leaky
error message" requirement, applied one level down from the API
response).

**Tests:** `tests/upload/validate-upload.test.ts` — real PNG/JPEG buffers
generated with `sharp` (accepted), a plain-text buffer with no image
signature at all (rejected as `unrecognized-format` — simulates a renamed
non-image file), a real TIFF buffer (rejected as `unsupported-format` —
proves the allowlist rejects *recognized* formats too, not just garbage),
and an oversized buffer rejection. 5 tests passing, 10/10 across the app.

**Not done yet:** not wired into an Express route yet — no multer/
multipart handling, no pixel-dimension limit (needs a decoded image, not
just the raw buffer), no GCS pre-signed upload URL. Those need an actual
`POST /upload` route, which also needs the blur check (Cycle 3) and
Vision call wired together — a bigger integration slice than a pure
function, saved for a dedicated cycle.

---

## 2026-07-23 — Cycle 5: DishLens `POST /upload` route

**What:** A real, live `POST /upload` route in
`apps/dish-lens/src/routes/upload.ts`, wiring together everything built in
Cycles 3–4 plus the missing piece — pixel-dimension limits:

- `multer` (memory storage, `fileSize` capped from `config.MAX_UPLOAD_SIZE_MB`)
  handles multipart intake — no more raw-buffer-only testing.
- `upload/index.ts` gained `checkImageDimensions(buffer, { maxDimensionPx })`
  (new `MAX_IMAGE_DIMENSION_PX` config/env key, default `8192` — iPhone
  ProRAW/48MP tops out around 8064×6048) and `assessUpload(buffer, options)`,
  a pure function composing format/size validation → dimension check → blur
  check in cost order, short-circuiting on the first failure so a garbage
  upload never pays for a full decode + Laplacian convolution.
- The route maps each `assessUpload` rejection reason to a distinct,
  non-leaky HTTP response (`01-security-checklist.md` §6): `413` for
  too-large/dimensions-too-large, `415` for unrecognized/unsupported format,
  `422` for unreadable-image/too-blurry. A separate error-handling
  middleware catches `multer.MulterError` (e.g. the multipart-layer
  `LIMIT_FILE_SIZE` rejection, which fires before `assessUpload` ever runs)
  and any other unexpected error, always returning JSON — never Express's
  default HTML error page with a stack trace.
- No Vision call yet (still no credentials) — a validated image gets a
  `200 { status: "accepted", mimeType, sizeBytes, width, height }` stub
  response so the pipeline is exercisable end-to-end up to that point.

**Gotcha hit:** first version of `checkImageDimensions` passed
`limitInputPixels: maxDimensionPx * maxDimensionPx` to `sharp()` as a
decompression-bomb guard. That's wrong — it bounds by *total area*, so an
image oversized on only one side (e.g. 9000×100, the exact shape a real
"too-large" test wants) can already exceed that area budget and make sharp
throw during `.metadata()` itself, before the friendlier per-side check
ever runs — surfaced as two failing tests (`unreadable-image` instead of
`dimensions-too-large`). Fixed by dropping the custom limit and relying on
sharp's own default cap (~268M pixels, i.e. ~16384×16384 — comfortably
above any real iPhone output) for bomb protection, while the explicit
per-side `maxDimensionPx` check does the actual business-rule enforcement.

**Also discovered (live, not just from docs):** this environment's `sharp`/
libvips build reports HEIF format support, but only for the AVIF codec —
not the HEVC-coded HEIC that iPhones actually output (HEVC decode is
patent-encumbered and excluded from prebuilt libvips binaries; verified via
`sharp.format.heif` → `fileSuffix: [".avif"]` only). A real iPhone HEIC
photo therefore fails closed as `unreadable-image` in `checkImageDimensions`
today, even though `validateUpload`'s magic-byte allowlist accepts it. This
isn't a regression — it's the correct fail-closed behavior — but it means
HEIC dimension-checking won't actually work end-to-end until
`preprocessing/image-normalize.ts` (still a TODO stub) converts HEIC to
JPEG/PNG before this check runs. Documented inline in `upload/index.ts` and
carried into the checklists below.

**Tests:** `tests/upload/assess-upload.test.ts` — 7 new cases:
`checkImageDimensions` (accepts in-bounds, rejects over-bounds with correct
width/height/limit reported, rejects an undecodable buffer as
`unreadable-image` instead of throwing) and `assessUpload` (accepts a
sharp/correctly-sized/allowlisted image, short-circuits on format
rejection before touching dimensions or blur, rejects oversized dimensions
after passing format/size, rejects blur after passing format/dimensions).
18/18 passing across the app; `pnpm -r run typecheck` and `pnpm -r run
build` pass clean across all 9 workspace packages.

**Verified live** (not just typecheck/tests): started a temporary local
Redis + the real compiled app with a `.env` (dummy secrets, real Redis
URL), and drove `POST /upload` with `curl -F` against real generated
fixtures for every path — no file (`400`), valid sharp JPEG (`200
accepted`), flat/blurry PNG (`422 too-blurry`), a 9000×100 PNG (`413
dimensions-too-large`), a plain-text file renamed as an upload (`415
unrecognized-format`), and a 25MB random-bytes file hitting multer's own
`LIMIT_FILE_SIZE` before `assessUpload` runs (`413 too-large` via the
Multer error-handling middleware, not a stack trace). Confirmed `/health`'s
`RateLimit-*` headers still work unaffected by the new route. Redis and the
app process were both shut down afterward; the temporary `.env` was
deleted (never committed).

**Not done yet:** no GCS pre-signed upload URL (raw binary still routes
through the API server) or random UUID object key — those need object
storage wiring, a separate cycle. `preprocessing/image-normalize.ts`
(sharp re-encode, EXIF strip, HEIC→JPEG normalization) is still a TODO
stub, which is *why* HEIC dimension-checking doesn't fully work yet (see
above). No auth/JWT verification on the route — anyone can call it once
deployed; `shared-auth` is still a stub. No per-user upload rate limiting
(the existing `express-rate-limit` is per-IP/global, not upload-specific).
No Vision call, so dish detection and the edge-case rejections (#5–#7 in
`02-milestones-checklist.md`) haven't started.

---

## 2026-07-23 — Cycle 6: DishLens image preprocessing (EXIF-safe re-encode)

**What:** `apps/dish-lens/src/preprocessing/image-normalize.ts` now
implements `normalizeImage(buffer)` — the piece Cycle 5 flagged as
blocking real HEIC handling. Pipeline: `sharp(buffer).rotate()` reads the
EXIF `Orientation` tag and bakes the correct rotation into the pixel data
*before* anything is stripped (order matters — stripping first would
leave sideways images with no tag left to correct them by), then re-encodes
without calling `.withMetadata()`, which is what actually drops GPS/device
metadata (sharp only carries EXIF/ICC/XMP forward if you ask it to keep
them). Output format is decided by content, not by echoing the input
format: images with an alpha channel become PNG (JPEG has no
transparency), everything else becomes JPEG. Mirrors Cycle 5's
`checkImageDimensions` in one respect — a real iPhone HEIC (HEVC-coded)
still isn't decodable by this environment's libvips build, so it fails
closed as `{ ok: false, reason: "undecodable" }` rather than throwing.

**Tests:** `tests/preprocessing/image-normalize.test.ts` — 4 cases: an
opaque JPEG with GPS EXIF data re-encodes as JPEG with `exif` confirmed
absent from the output's own metadata; an image with an alpha channel
re-encodes as PNG; a 40×20 image tagged EXIF orientation 6 (rotate 90°
CW) comes out 20×40 with the orientation tag gone from the output (proves
the rotation was actually baked into pixels, not just the tag dropped
unapplied — the dimension swap is the tell); a non-image buffer returns
`undecodable` instead of throwing. 22/22 passing across the app;
`pnpm -r run typecheck` and `pnpm -r run build` pass clean across all 9
workspace packages.

**Not done yet:** not wired into `POST /upload` yet — there's nowhere for
the re-encoded buffer to go until GCS pre-signed upload URLs exist
(Cycle 5's leftover). Wiring it into the route today would just re-encode
and discard the result, so it stays a tested, standalone unit until object
storage lands. HEIC input is still practically undecodable end-to-end in
this environment (see above) — the milestone checklist note about that
carries forward unchanged from Cycle 5.

---

## 2026-07-23 — Cycle 7: DishLens Redis session store

**What:** `apps/dish-lens/src/session/session-store.ts` implements
`createSessionStore(redis, ttlSeconds)` — session creation (random UUID via
`node:crypto`), read, message-append, and delete, all backed by Redis.
Keys are `dishlens:session:{userId}:{sessionId}` — embedding `userId` in
the key itself means a session ID alone is never sufficient to read
someone else's session (`01-security-checklist.md` §7's "scoped per
user/session ID" and §1's IDOR guard, applied at the storage layer as
defense-in-depth beneath whatever auth check eventually calls this).
`getSession`/`appendMessage` return `null` — not a thrown error — for
both "doesn't exist" and "belongs to another user," so callers can't
distinguish the two cases from the return value alone. Every write
(`createSession`, `appendMessage`) re-sets the key with `EX ttlSeconds`,
so the TTL slides forward on activity instead of expiring an in-use
session on a fixed clock from creation — genuinely idle sessions still
auto-expire via Redis's own TTL mechanism, no manual sweep needed.

Like `checkImageDimensions` (Cycle 5) and `normalizeImage` (Cycle 6), this
takes its dependencies (`redis`, `ttlSeconds`) as parameters instead of
importing the app's `config`/singleton `redis` client directly — keeps it
testable against a real test Redis without needing the full env schema
(`JWT_ACCESS_SECRET`, `ANTHROPIC_API_KEY`, etc.) loaded just to run a unit
test.

**Tests:** `tests/session/session-store.test.ts` — 9 cases against a real
local Redis (same one CI already runs as a service container, and that
`infra/docker-compose.yml` provides for local dev — TTL/expiry behavior
isn't trustworthy against a mock): create/read round-trip, ordered
message append with timestamps, cross-user read returns `null` (not the
other user's data), nonexistent-session read/append both return `null`
rather than throwing, real TTL expiry after the window elapses (1s TTL,
1.3s wait), sliding TTL confirmed by writing at the 600ms mark of a 1s TTL
and finding the session still alive 600ms after that (would've expired on
a fixed clock from creation), and explicit delete. 31/31 passing across
the app; `pnpm -r run typecheck` and `pnpm -r run build` pass clean across
all 9 workspace packages.

**Verified live:** ran the full suite (including the two timing-dependent
tests) against a temporary local Redis on the default port (6379, matching
`ci.yml`'s service container) — all 9 pass, including the two Redis
round-trips actually blocking on real `EXPIRE` behavior rather than fake
timers. Redis was shut down afterward.

**Not done yet:** no route wiring — there's no Vision integration yet to
generate the dish-detection turn that would start a real session, so
`createSession`/`appendMessage` have no caller yet (same "tested unit,
nothing to plug it into yet" situation as Cycle 6's `normalizeImage`).
No abuse/rate-limit on session creation itself (distinct from the existing
per-IP `express-rate-limit` on all routes). Session data has no schema
validation on `content` (e.g. size cap on a single message) — not a
concern yet since nothing writes to it in production, but will need one
once a real caller exists.

---

## 2026-07-23 — Cycle 8: DishLens save-chat + list-chats (Postgres/Prisma)

**What:** `apps/dish-lens/src/history/save-chat.ts` (`saveChat`) and
`list-chats.ts` (`listSavedChats`, `getSavedChat`) implement Milestone
#12/#13 against the existing `SavedChat` Prisma model. `saveChat` creates
one row per snapshot; there's no update function anywhere in the codebase
for `SavedChat`, so the write-once guarantee is enforced by that absence
rather than a runtime check — matches the model's existing "write-once by
convention" comment in `schema.prisma`. `getSavedChat(userId, chatId)`
returns `null` for both "doesn't exist" and "belongs to someone else,"
same non-leaking pattern as `session-store.ts`'s `getSession` (Cycle 7).
`listSavedChats(userId)` is owner-scoped via `where: { userId }` — never
returns another user's chats.

**Prerequisite fixes hit along the way (both were latent, pre-existing
gaps — this is the first cycle to actually touch `shared-db`):**

1. `packages/shared-db/package.json` declares `"main": "dist/index.js"`
   but the package only ever had `src/client.ts` — no `src/index.ts`, so
   `import { prisma } from "@lens-and-sync/shared-db"` couldn't have
   resolved. Added `src/index.ts` (`export * from "./client.js"`).
2. There was no Prisma migration — `prisma/migrations/` had only a
   `.gitkeep`, and `ci.yml` ran `prisma generate` but never `migrate
   deploy`, so CI's Postgres service container had no schema at all.
   Generated a real migration (`prisma migrate dev --name init` against a
   local Postgres) and added a `migrate:deploy` step to `ci.yml` (with
   `DATABASE_URL` pointed at the service container) between `generate` and
   `lint`, plus `DATABASE_URL` on the `test` step so Postgres-backed tests
   like this cycle's actually have a database to hit in CI.

**Tests:** `tests/history/save-chat.test.ts` — 4 cases against a real,
migrated local Postgres (same DB CI now actually sets up): a saved chat
round-trips its messages/dishName exactly; `listSavedChats` returns only
the calling user's chats, confirmed against a second real user; `
getSavedChat` returns the chat for its owner but `null` for a different
user; `getSavedChat` returns `null` for a nonexistent ID instead of
throwing. Two real `User` rows are created in `beforeAll` (the `SavedChat`
→ `User` foreign key requires one) and both the users and any created
chats are cleaned up in `afterEach`/`afterAll` — no leftover rows.
35/35 tests passing across the app (31 after Cycle 7 + 4 here);
`pnpm -r run typecheck` and `pnpm -r run build` pass clean across all 9
workspace packages.

**Verified live:** ran the full suite against a temporary local Postgres
database + Redis — all pass. Separately simulated the CI fix end-to-end:
created a second, completely fresh database and ran `pnpm --filter
@lens-and-sync/shared-db run migrate:deploy` against it standalone (the
exact command now in `ci.yml`), confirming the migration applies cleanly
with no local state to lean on. Both temporary databases and Redis were
torn down afterward — no persistent state left running.

**Not done yet:** `routes/history.ts` is still a stub — wiring real `GET
/chats` and `GET /chats/:id` routes needs a `userId` sourced from a
verified auth token, and `shared-auth` is still a stub. Trusting a
client-supplied user ID here would violate `01-security-checklist.md` §1
("never trust client-supplied user/role IDs"), so the route stays
unwired rather than take that shortcut — same reasoning as why
`normalizeImage` (Cycle 6) and the session store (Cycle 7) aren't wired
into routes yet, just a different blocking prerequisite. No enforcement
exists yet for "reject writes to an already-saved chat" at the API layer,
because no endpoint exists yet that could attempt one — today it's true
only because the code path doesn't exist, not because of an active check;
that'll need a real assertion once a continue-chat endpoint exists.

---

## 2026-07-23 — Cycle 9: `shared-auth` JWT verification + live `GET /chats` routes

**What:** Three cycles in a row (6, 7, 8) hit the same wall — a
credential-independent piece was built and tested but couldn't be wired
into a live route because there was no verified way to get `userId`
without trusting client input. This cycle removes that wall for the read
side: `packages/shared-auth` now implements real JWT **verification**
(not issuance — see scope note below):

- `verify.ts` — `verifyAccessToken(token, secret)` checks signature and
  expiry via `jsonwebtoken`, extracts `userId` from the `sub` claim, and
  returns a discriminated result (`missing` / `malformed` / `expired` /
  `invalid` / `ok`). This is the only place `userId` is allowed to come
  from anywhere downstream.
- `middleware.ts` — `requireAuth(secret)` returns Express middleware that
  extracts a `Bearer` token from `Authorization`, verifies it, and either
  attaches `req.userId` and calls `next()`, or returns a **single, fixed**
  `401 { error: { code: "unauthorized", message: "Authentication
  required." } }` — deliberately the same shape regardless of *why*
  verification failed, so a client (or attacker) can't distinguish
  expired/malformed/invalid/missing from the response
  (`01-security-checklist.md` §1's clean-401-for-iOS-refresh requirement).

`routes/history.ts` (Milestone #13, previously blocked in Cycle 8) is now
a real route: `historyRouter.use(requireAuth(config.JWT_ACCESS_SECRET))`
gates both `GET /chats` (→ `listSavedChats`) and `GET /chats/:chatId` (→
`getSavedChat`), reading `req.userId` — never anything client-supplied —
as the identity for every Prisma call. A JSON error-handling middleware
(same pattern as Cycle 5's upload route) catches anything unexpected
rather than leaking a stack trace.

**Scope note:** this is verification only — no login/signup/token-issuance
endpoint, no refresh-token rotation/storage (the `RefreshToken` Prisma
model exists but nothing writes to it yet), no RBAC/ABAC. Those are
separate, larger pieces of `01-security-checklist.md` §1 and stay
unstarted; this cycle only unblocks routes that need to know *who's
asking*, not routes that need to log someone in.

**Prerequisite fix:** `shared-auth` had `jsonwebtoken` as a dependency but
no `test` script, no `vitest`, and no `@types/express` (needed for the
middleware's `Request`/`Response`/`NextFunction` types) — added all three,
matching the `test`/`vitest` convention already used by `shared-config`.

**Tests:** `packages/shared-auth/tests/verify.test.ts` (6 cases: valid
token round-trips to the right `userId`, missing/expired/wrong-secret/
non-JWT/no-`sub` all rejected with the correct distinct *internal* reason)
and `middleware.test.ts` (4 cases, using hand-built mock `req`/`res`
objects rather than a new test-server dependency: valid token attaches
`userId` and calls `next()`; missing header, expired token, and a
non-`Bearer` scheme all return the identical 401 shape and never call
`next()`). 10/10 passing. `pnpm -r run typecheck` and `pnpm -r run build`
pass clean across all 9 workspace packages.

**Verified live end-to-end** (not just unit tests): stood up a temporary
local Postgres (migrated) + Redis, seeded two real `User` rows and one
`SavedChat` owned by the first, signed real JWTs for each user with
`jsonwebtoken` against the app's actual `JWT_ACCESS_SECRET`, ran the
compiled app, and drove `GET /chats` and `GET /chats/:chatId` with curl:
no `Authorization` header → `401`; a garbage token → the identical `401`;
owner listing their own chat → `200` with the chat; the *other* user
listing → `200 { chats: [] }` (correctly empty, not an error); the other
user requesting the first user's chat ID directly → `404` — the exact
same shape as a genuinely nonexistent ID, confirming no cross-user
existence leak. All temporary infra torn down afterward (databases
dropped, Redis and the app process stopped, `.env` deleted).

**Not done yet:** no login/token-issuance/refresh-rotation (see scope
note above) — there's still no way for a real client to *obtain* an
access token, only to have one verified. `POST /upload` (Cycle 5) is
still unauthenticated — wiring `requireAuth` there too is a natural next
step now that the middleware exists, but is deliberately left for its own
cycle rather than bundled in here. No RBAC/ABAC beyond "is this a valid
token for some user."

---

## 2026-07-23 — Cycle 10: authenticate + per-user rate-limit `POST /upload`

**What:** Closed the leftover flagged at the end of Cycle 9. `POST
/upload` now runs `requireAuth(config.JWT_ACCESS_SECRET)` first — before
`multer` even touches the request body, so an unauthenticated request
never pays for multipart parsing — followed by a new per-user rate
limiter, then the existing multer/`assessUpload` pipeline unchanged.

The per-user limiter (Milestone #14, `01-security-checklist.md` §8's
"Rate-limit image uploads per user... iOS clients may retry aggressively
on poor cellular connections, so limits need to tolerate legitimate
retries without allowing abuse") is deliberately separate from the
existing global per-IP `express-rate-limit` in `index.ts` (Cycle 2):
same libraries (`express-rate-limit` + `rate-limit-redis`), but keyed on
the verified `req.userId` instead of IP — IP is a poor proxy for "one
user" behind carrier-grade NAT on cellular, which is exactly the
population this limit needs to not accidentally punish. New config:
`UPLOAD_RATE_LIMIT_WINDOW_MS` / `UPLOAD_RATE_LIMIT_MAX_UPLOADS` (default
20 uploads / 10 minutes — generous enough for retry storms, still a real
cap), and a distinct Redis key prefix (`dishlens:upload-rl:`) so it can't
collide with the global limiter's counters.

**Also fixed while touching this route:** `express-rate-limit`'s default
429 response is a plain-text body ("Too many requests, please try again
later."), inconsistent with every other rejection on this route, which
returns `{ error: { code, message } }` JSON. Added a custom `handler` so
rate-limit rejections match the same shape — closes a small piece of
Milestone #11's "consistent error schema across all rejection paths" that
was sitting there unnoticed since Cycle 2 first introduced the global
limiter (that one still has the default plain-text body; out of scope
for this cycle, noted below).

**Verified live** (no new automated test — matches Cycle 2's precedent
for this same library pairing, where the actual rate-limiting behavior
was verified live rather than unit-tested, since it needs a real Express
app + real Redis + real timing to mean anything): temporary local Redis +
compiled app, `UPLOAD_RATE_LIMIT_MAX_UPLOADS` set to `3` for a fast
check. No `Authorization` header → `401` before multer runs (confirmed no
multipart parsing happens first). A garbage token → the same `401`.
Uploads 1–3 from one signed-in user succeed (`200`); upload 4 from the
*same* user → `429` with the new JSON shape
(`{"error":{"code":"rate-limited","message":"Too many uploads. Please
wait before trying again."}}`). A *different* user's token uploading
immediately after → `200`, confirming the limit is genuinely per-user,
not accidentally global. Redis, the app process, and the temporary `.env`
were all torn down afterward.

**Not done yet:** the pre-existing global per-IP limiter (Cycle 2) still
returns the default plain-text 429 body — left as-is rather than expanded
scope; worth a follow-up for full schema consistency. No bandwidth-based
limiting (checklist mentions "count and bandwidth" — this cycle only
covers count). Moderation (NSFW/SafeSearch) still blocked on Vision
credentials, same as every cycle since 5.

---

## 2026-07-24 — Cycle 11: Google Vision dish detection + edge cases + moderation

**What:** Real credentials for Vision/Anthropic/Edamam landed in
`apps/dish-lens/.env` since Cycle 10 (previously every cycle was blocked by
"no credentials exist regardless" — see `05-progress.md`). This cycle spends
that unblock on Milestone #4–#7: a live Google Vision integration.

- `src/vision/index.ts` — `analyzeImage(client, buffer)` calls Vision's
  `annotateImage` with `LABEL_DETECTION` + `SAFE_SEARCH_DETECTION` in one
  request (one Vision cost for both dish detection and moderation, per
  `06-toolchain-decisions.md`). Takes the client as a parameter (same
  dependency-injection pattern as `session-store.ts`'s `redis` and
  `image-normalize.ts`'s buffer-in/buffer-out shape) so it's unit-testable
  against a hand-built fake client, no network or real credentials needed
  for tests. `src/vision/client.ts` holds the actual singleton
  (`ImageAnnotatorClient` constructed from `GOOGLE_CLOUD_CREDENTIALS_JSON` /
  `GOOGLE_CLOUD_PROJECT_ID`), imported only by the route.
- `src/moderation/index.ts` — `checkModeration(safeSearch)`, a pure function
  reading the SafeSearch annotation from the same Vision call. Blocks on
  `LIKELY`/`VERY_LIKELY` for adult/violence/racy; deliberately allows
  `POSSIBLE` through (fires on plenty of ordinary food photos, e.g. racy on
  a photo of ribs) and never blocks on medical/spoof likelihoods, which
  aren't moderation concerns for a dish photo.
- `src/edge-cases/index.ts` — `classifyDish(labels, thresholds)`, the
  Milestone #4–#7 heuristic. Vision has no built-in "is this one prepared
  dish" signal, so this composes three label categories: generic
  category labels ("Food", "Dish", "Cuisine" — prove food-relatedness but
  can't name a dish), raw-ingredient labels ("Egg", "Carrot" — food-related
  but not a *finished* dish, so milestone #6 puts these under "non-dish"
  rather than "unidentified dish"), and everything else (candidate dish
  names). Zero food-related labels at all → `non-dish`; food evidence but
  no specific label clears `DISH_CONFIDENCE_THRESHOLD` → `low-confidence`;
  more than one specific candidate clears it → `multi-dish`; exactly one →
  accepted with `dishName`/`confidence`. New config:
  `DISH_CONFIDENCE_THRESHOLD` (default `0.6`), `FOOD_EVIDENCE_THRESHOLD`
  (default `0.5`).
- `src/routes/upload.ts` now runs Vision analysis after `assessUpload`
  passes (so blur/format/size rejections still never incur Vision cost):
  moderation check first, then dish classification, each mapping to a
  distinct `422` with a non-leaky message (`01-security-checklist.md` §6 —
  no confidence scores or label names echoed to the client). A validated,
  classified dish now gets `200 { status: "accepted", dishName, ... }`
  instead of the old unconditional acceptance stub.

**Prerequisite fixes hit along the way (both pre-existing, not caused by
this cycle):**

1. `packages/shared-auth`'s `@types/express` devDependency was in
   `package.json` but not actually linked in `node_modules` (stale
   lockfile-vs-install state) — `pnpm -r run build` failed on
   `Cannot find module 'express'` before any of this cycle's code ran.
   Fixed with a plain `pnpm install` (lockfile itself was already correct).
   `packages/shared-db`'s `dist/` was similarly stale (missing the
   `index.js` Cycle 8 added to `src/`) — fixed by rebuilding.
2. The local `apps/dish-lens/.env` had a wrong relative path for
   `GOOGLE_CLOUD_CREDENTIALS_JSON` (one `../` short — resolves from the
   app's own cwd, not the repo root) and was missing `MAX_IMAGE_DIMENSION_PX`
   / `UPLOAD_RATE_LIMIT_WINDOW_MS` / `UPLOAD_RATE_LIMIT_MAX_UPLOADS`, all
   added to the config schema in Cycles 5 and 10 after this `.env` was last
   hand-edited — the app couldn't have booted with it as found. Fixed
   locally (`.env` isn't committed).
3. `handleUploadError` (the route's catch-all error middleware) swallowed
   unexpected errors with no server-side logging at all — a real gap once
   this cycle introduced a new failure surface (Vision auth/quota/network
   errors) that needs *some* visibility without leaking internals to the
   client. Added a `console.error` server-side log ahead of the existing
   generic `500` response — partial progress on `01-security-checklist.md`
   §11's "log security-relevant events," not full structured logging (still
   open, needs `shared-logger` wired in).

**Tests:** 22 new cases, all against mocked Vision clients / hand-built
label arrays — no live network in the test suite itself.
`tests/vision/analyze-image.test.ts` (3): label/SafeSearch mapping, both
feature types requested in one call, defaults to empty/`UNKNOWN` when Vision
returns nothing. `tests/moderation/check-moderation.test.ts` (9): clean
image passes, `POSSIBLE` passes, `LIKELY`/`VERY_LIKELY` block on each of
adult/violence/racy individually, medical/spoof never block. `tests/edge-
cases/classify-dish.test.ts` (10): single clear dish accepted, two distinct
dishes → multi-dish, egg/carrot → non-dish (not low-confidence), empty
plate/person/unrelated-object → non-dish, generic-evidence-only and
just-under-threshold specific label → low-confidence, dish with only
generic-labeled garnish/side → still accepted (single specific candidate).
75/75 tests passing across the app (53 pre-existing + 22 new — one
pre-existing file, `save-chat.test.ts`, fails/skips without a running local
Postgres, unrelated to this cycle and unchanged by it). `pnpm -r run
typecheck` and `pnpm -r run build` pass clean across all 9 workspace
packages.

**Verified live** (real Google Cloud project, real Vision API — first
cycle able to do this): hit a real blocker mid-verification — the initial
live call returned a genuine gRPC `PERMISSION_DENIED`, "Cloud Vision API has
not been used in project ... or it is disabled," meaning the service
account credentials authenticated correctly but the API itself wasn't
enabled on the project. Flagged to the user rather than working around it
(enabling a GCP API is an account-level action outside what this session
should do unilaterally); the user enabled it directly in the GCP console.
After that: started the real compiled app with the real `.env`, signed a
real JWT with `jsonwebtoken` against the app's actual `JWT_ACCESS_SECRET`,
and drove `POST /upload` with curl. A flat-color synthetic image was
rejected `422 too-blurry` by the pre-existing blur check *before* Vision was
ever reached (confirms cost-ordering still holds with the new stage added
after it). A high-frequency synthetic checkerboard (passes the blur check,
but isn't a real dish photo) reached a genuine Vision API call and came back
`422 non-dish` — proving the full pipeline (auth → rate-limit → format/size/
dimension/blur → real Vision call → moderation → classification) executes
end-to-end against live infrastructure. Also confirmed: no `Authorization`
header and a garbage token both still return the identical `401` *before*
Vision runs (no wasted API cost on unauthenticated requests); the earlier
mid-cycle `500` (before the credentials-path fix and the disabled-API
error) came back as the same generic, non-leaking JSON body, with the real
gRPC error text now visible server-side in the new log line instead of
silently disappearing. All temporary processes, signed tokens, and
generated test images were cleaned up afterward.

**Not done yet:** no real dish-photo fixtures exist (still the standing gap
noted since Cycle 3 for blur calibration, now also true for classification
calibration) — the live check above proves the *pipeline* works against
real Vision, not that the label-category heuristic in `classifyDish` is
correctly calibrated against real dish photos, real multi-dish plates, or
real poor-lighting shots. That remains a heuristic verified only against
mocked label sets modeled on Vision's documented behavior, exactly as
flagged inline in `edge-cases/index.ts`. Recipe generation (Anthropic,
Milestone #8) and nutrition lookup (Edamam, Milestone #9) are unblocked by
the same credential landing but not started this cycle. No session
creation on a successful classification yet — `createSessionStore` (Cycle
7) still has no caller. Object storage / pre-signed GCS URLs (Milestone #1
leftover) still not done.

---

## 2026-07-24 — Cycle 12: DishLens recipe generation (Anthropic Claude)

**What:** `src/recipe/index.ts` implements `generateRecipe(client, model,
dishName)` — Milestone #8. One Claude call per dish name, with a system
prompt carrying the home-kitchen feasibility constraints directly (grocery-
store ingredients only, standard equipment only, no specialty gear) and
instructing strict JSON-only output (no markdown fences, no commentary).
The response text is parsed and validated against a `zod` schema
(`recipeSchema`: non-empty `dishName`, non-empty `ingredients`/`steps`
arrays) rather than trusted as-is — an LLM can still reply with prose, a
truncated object, or a shape that merely happens to parse as JSON, so the
schema check is what actually gates acceptance, not just `JSON.parse`
succeeding. Both failure modes (non-JSON text, JSON missing required
fields) collapse to the same `{ ok: false, reason: "invalid-response" }` -
callers don't need to distinguish "Claude explained itself instead of
returning JSON" from "Claude returned malformed JSON." Same
dependency-injection shape as `vision/index.ts`'s `VisionAnnotateClient`:
`RecipeClient` is `Pick<Anthropic, "messages">`, so tests never touch the
network, and `src/recipe/client.ts` holds the one real singleton
(`new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })`) for the route layer
to eventually import.

**Tests:** `tests/recipe/generate-recipe.test.ts` — 5 cases against a
hand-built fake client: well-formed JSON round-trips to the exact recipe
object; the dish name and configured model are confirmed passed through to
the actual API call; conversational (non-JSON) text, well-formed-but-
incomplete JSON, and a response with no text content block at all (e.g. a
pure tool-use block) all correctly reject as `invalid-response`. 63/63
tests passing across the app (58 after Cycle 11 + 5 here — one pre-existing
file, `save-chat.test.ts`, still needs a running local Postgres, unchanged
from every prior cycle). `pnpm -r run typecheck` and `pnpm -r run build`
pass clean across all 9 workspace packages.

**Verified live** (real Anthropic API, first cycle able to): the initial
attempt hit a second real account-level blocker in a row — `400
invalid_request_error`, "Your credit balance is too low to access the
Anthropic API." Same handling as Cycle 11's Vision-not-enabled blocker:
flagged to the user rather than working around it (adding billing credits
is the user's account action, not something this session should do
unilaterally). The user added credits; a real call to `generateRecipe`
against `claude-sonnet-5` for "Margherita Pizza" then returned a genuine,
well-formed, home-kitchen-feasible 10-step recipe with ordinary grocery
ingredients and standard equipment (oven, baking sheet/stone) - both the
JSON-only instruction and the feasibility constraints held on a real
model response, not just in the mocked unit tests.

**Deliberately not wired into a route yet:** unlike Cycles 3–10 (which
usually wired a new capability into `POST /upload` the same cycle it was
built), this one stays a tested, standalone unit on purpose. Milestone #11
("Response assembly") calls for one coherent structured chat response
combining recipe generation *and* nutrition lookup (Milestone #9, Edamam -
not started) *and* Redis session creation (Cycle 7's `createSessionStore`,
still uncalled) into a single response appended to the session. Wiring
recipe generation alone into the route now would mean re-touching the same
response-assembly code twice (once for recipe-only, again once nutrition
lands) for no benefit - better to build nutrition next and assemble both
into the route in one dedicated cycle.

**Not done yet:** nutrition lookup (Edamam, Milestone #9) - separate
credentials already sitting unused in `.env` since before this cycle.
Session creation on a successful classification (Milestone #10's remaining
gap). No automated check for recipe feasibility beyond the system prompt
itself - `04-testing-checklist.md`'s "spot-check against a rubric" for
exotic equipment/ingredients is inherently a manual/qualitative check, not
something this cycle automated.

---

## 2026-07-24 — Cycle 13: DishLens nutrition lookup (Edamam)

**What:** `src/nutrition/index.ts` implements `lookupNutrition(fetchFn,
credentials, dishName, ingredients)` - Milestone #9, matched to the
generated ingredient list from Cycle 12's `generateRecipe()`. Same
dependency-injection shape as the last two cycles: takes Node's global
`fetch` as a parameter (`FetchLike`) instead of importing it, so tests
never touch the network.

**Gotcha hit (only discovered live, not from any doc):** Edamam's
Nutrition Analysis API is documented to return top-level aggregate fields
(`calories`, `totalWeight`, `totalNutrients`) alongside the per-ingredient
breakdown. This account's real responses omit all three entirely - a real
call returns only `{ uri, yield, dietLabels, healthLabels, cautions,
ingredients }`, confirmed by dumping `Object.keys()` on an actual live
response. First implementation (schema expecting the top-level fields)
built, unit-tested against a shape matching the *documented* response, then
failed live with `no-nutrition-data` against the *real* response - caught
before this cycle was called done, not after. Rewrote to aggregate
client-side from `ingredients[].parsed[].nutrients` instead (summing
`ENERC_KCAL`/`PROCNT`/`FAT`/`CHOCDF` and `weight` across every parsed match
in every ingredient line), which the real response reliably does contain
regardless of the missing aggregate fields. Tests were rewritten to match
this real shape rather than the documented one.

**Tests:** `tests/nutrition/lookup-nutrition.test.ts` - 6 cases against a
hand-built fake `fetch`: correct summation across multiple ingredients;
dish title/ingredient list sent through to the request body; an ingredient
with an empty `parsed` array (Edamam couldn't match it) contributes zero
rather than breaking the sum; a non-2xx response rejects as
`lookup-failed`; a 200 response where every ingredient is unmatched (zero
total calories) rejects as `no-nutrition-data`; a response that doesn't
match the expected shape at all also rejects as `no-nutrition-data`.
70/70 tests passing across the app (64 after Cycle 12 + 6 here - one
pre-existing file, `save-chat.test.ts`, still needs a running local
Postgres, unchanged from every prior cycle). `pnpm -r run typecheck` and
`pnpm -r run build` pass clean across all 9 workspace packages.

**Verified live** (real Edamam API): a real call for "Margherita Pizza"
with five realistic ingredient strings (matching Cycle 12's actual live
recipe output) returned `{ calories: 2174.8, totalWeightGrams: 834.4,
proteinGrams: 94.2, fatGrams: 95.6, carbsGrams: 232.8 }` - plausible for an
8-serving pizza (~272 kcal/serving). Also drove two failure paths live, not
just mocked: deliberately wrong credentials → real `401` → `lookup-failed`;
a single gibberish ingredient string ("asdkfjaslkdjf gibberish xyz123") →
Edamam's own real `555 { error: "low_quality" }` response → also
`lookup-failed` (confirmed this is genuine Edamam behavior for unparseable
input, not a bug in this code, by inspecting the raw status/body directly).
Also confirmed these are NOT Food Database API credentials - a direct call
to that different Edamam product's endpoint with the same `app_id`/
`app_key` returned `401`, ruling out a wrong-endpoint explanation for the
missing aggregate fields before concluding it's an account-tier quirk of
the Nutrition Analysis product specifically.

**Deliberately not wired into a route yet:** same reasoning as Cycle 12 -
Milestone #11's "Response assembly" wants recipe generation, nutrition
lookup, and Redis session creation combined into one coherent response in
a single pass, not three separate partial wirings of the same route.

**Not done yet:** Milestone #11 (response assembly: recipe + nutrition +
session, wired into `POST /upload`) and Milestone #10's remaining gap
(session creation actually called) are next. No caching/dedup of repeated
Edamam lookups for the same dish - each request re-hits the live API.

---

## 2026-07-24 — Cycle 14: DishLens response assembly (recipe + nutrition + session)

**What:** `POST /upload` now wires together everything built standalone in
Cycles 7 and 11–13 into one coherent response - Milestone #10's remaining
gap (`createSessionStore` finally has a caller) and Milestone #11
("Response assembly"). After a successful `classifyDish`:

1. `generateRecipe()` (Cycle 12) generates a recipe for the identified
   dish. Failure here (`invalid-response` - Claude returned something the
   `zod` schema rejects) returns a `502 { code: "recipe-generation-failed"
   }` - a genuine upstream-dependency failure, not a client input problem,
   so it gets a 5xx rather than joining the 422 rejection family.
2. `lookupNutrition()` (Cycle 13) looks up nutrition for the *actual
   generated ingredients* (not the raw dish name), matching Milestone #9's
   "matched to generated ingredients" wording literally. **Deliberately
   best-effort, not a gate**: if Edamam fails for any reason (rate limit,
   outage, a dish whose ingredients don't parse), the response still
   returns with `nutrition: null` rather than failing the whole request -
   a flaky third-party nutrition lookup shouldn't take down the core
   recipe result the user actually asked for. The failure reason is logged
   server-side (`console.error`) so a persistent outage stays visible.
3. `sessionStore.createSession(userId)` + `appendMessage(...)` (Cycle 7)
   persists one assistant turn - `content` is a JSON string of `{
   dishName, confidence, recipe, nutrition }` - keyed by the verified
   `req.userId`, never a client-supplied ID.

The final `200` response now returns `{ status, sessionId, dishName,
recipe, nutrition, mimeType, sizeBytes, width, height }` instead of the
acknowledgment-only stub from Cycles 5/11.

**Verified live** (real Vision, real Claude, real Edamam, real Redis - no
mocks anywhere in this verification): two checks, since no real dish photo
exists to drive a full `200` through the actual HTTP route (the standing
gap since Cycle 3).

1. HTTP-level, via the real running app: the same synthetic checkerboard
   image from Cycle 11 still returns `422 non-dish` - confirms the new
   recipe/nutrition/session code added *after* the classification gate is
   never reached on a rejection (cost-ordering preserved, no wasted Claude/
   Edamam calls on a photo that was never a dish to begin with).
2. Assembly-chain level, via a standalone script calling the exact same
   sequence of real dependencies the route now calls, in the same order,
   threading real data between them: real `generateRecipe()` for "Chicken
   Caesar Salad" (returned 16 ingredients, 11 steps) → real
   `lookupNutrition()` fed those exact 16 generated ingredient strings
   (returned real aggregated macros) → real Redis `createSession` +
   `appendMessage` with the combined payload as `content` → `getSession`
   read-back confirmed the persisted JSON round-trips correctly → session
   deleted afterward. This proves the assembly logic itself is correct
   against live infrastructure, even though the HTTP-level `200` path
   specifically (going through a real Vision dish match) remains unverified
   pending a real dish-photo fixture.

**Tests:** no new automated tests this cycle - `generateRecipe`,
`lookupNutrition`, and `createSessionStore` are already unit-tested
individually (Cycles 7, 12, 13), and the route-level assembly is Express
wiring with no new pure logic to unit-test in isolation (matches the
precedent set in Cycles 9/10, where route-level behavior was verified live
rather than with a new test file). 70/70 pre-existing tests still passing;
`pnpm -r run typecheck` and `pnpm -r run build` pass clean across all 9
workspace packages.

**Not done yet:** no real dish-photo fixture exists to drive a true
end-to-end `200` through the live HTTP route (recurring gap, unchanged).
No caching of the Redis session ID back to the client beyond the response
body - there's no follow-up endpoint yet that would let a client continue
a conversation using it (`appendMessage` has no second caller). Nutrition
failures are silently swallowed into `null` from the client's perspective -
no `nutritionAvailable: false`-style flag distinguishing "no nutrition data
returned" from "lookup failed," which a real iOS client would likely want
to render differently. Save-chat (Cycle 8) still isn't wired to this flow
- there's no endpoint yet that snapshots a live session into a `SavedChat`.

---

## 2026-07-29 — Cycle 15: DishLens GCS object storage

**What:** `src/storage/index.ts` implements `uploadNormalizedImage(bucket,
buffer, mimeType)` and `getSignedReadUrl(bucket, objectKey, expirySeconds)`
- the remaining piece of Milestone #1/#2 and the last unchecked items in
`01-security-checklist.md` §5. `src/storage/gcs-client.ts` holds the one
real `Storage`/`Bucket` singleton (same pattern as `vision/client.ts` and
`recipe/client.ts` - reuses the same service account already used for
Vision, per `.env.example`'s existing comment). Same dependency-injection
shape as every prior cycle: `bucket` is a parameter, not an import, so
`uploadNormalizedImage`/`getSignedReadUrl` are unit-testable against a
hand-built fake bucket.

- Object keys are `${randomUUID()}.{jpg|png}` - never the client filename,
  never derived from dish/user data.
- `file.save()` is called with no `public`/`predefinedAcl` option, so
  objects inherit the bucket's own (private) access - confirmed live below
  that an unauthenticated fetch of the raw object URL gets `403`.
- The only read path is `getSignedReadUrl` - a v4 signed URL with a
  caller-supplied expiry (new `GCS_SIGNED_URL_EXPIRY_SECONDS` config,
  default 1 hour).

`routes/upload.ts` now calls `normalizeImage()` (Cycle 6 - finally has a
caller) then `uploadNormalizedImage()` + `getSignedReadUrl()`, but **only
after** moderation and dish classification both pass - a photo that fails
format/blur/moderation/non-dish checks is never persisted. Storage is
deliberately best-effort like nutrition (Cycle 14): a GCS hiccup or an
undecodable-on-normalize edge case (the same HEVC-HEIC gap noted since
Cycle 5/6) logs server-side and continues with `image: null` rather than
failing a request whose core recipe result doesn't depend on it. The
session message persisted to Redis stores the object key (not the signed
URL itself, which would go stale before the session TTL); the HTTP
response returns both the key and a freshly-generated signed URL.

**Tests:** `tests/storage/gcs-storage.test.ts` - 4 cases against a
hand-built fake `Bucket`: uploads under a UUID `.jpg` key with the right
content-type/options; `.png` extension for PNG input and no key reuse
across two calls; confirms no `public`/`predefinedAcl` option is ever
passed to `save()`; `getSignedReadUrl` requests a v4 read-scoped URL with
an expiry timestamp in the future. 72/72 tests passing across the app (68
pre-existing + 4 here - `save-chat.test.ts`'s 4 cases still skip without a
running local Postgres, unchanged from every prior cycle). `pnpm -r run
typecheck` and `pnpm -r run build` pass clean across all 9 workspace
packages.

**Verified live** (real GCS bucket, real credentials): a standalone script
uploaded a test object to the real `GCS_BUCKET_NAME` bucket, confirmed its
content-type/size via `getMetadata()`, confirmed an unauthenticated fetch
of the raw object URL returns `403` (not publicly readable), confirmed a
v4 signed URL for the same object returns `200` with the correct byte
count, then deleted the object - no leftover test data in the bucket.
Separately, started the real compiled app (killed a stale process from an
earlier session that was still holding port 4002 with pre-Cycle-15 code)
and drove `POST /upload` with curl: no `Authorization` header returns
`401` before any file processing; a plain-text file renamed as an upload
returns `415 unrecognized-format`; a flat-gray synthetic JPEG returns `422
too-blurry` - confirming the blur check still short-circuits before
Vision, moderation, classification, *and* the new storage step, so a
rejected photo never reaches GCS. `/health`'s `RateLimit-*` headers still
present, unaffected. The app process was stopped afterward (confirmed
nothing left listening on `:4002` besides harmless `TIME_WAIT` sockets).

**Not done yet:** still no real dish-photo fixture to drive a `200`
through the live HTTP route and confirm a real image actually lands in GCS
via the full pipeline (same standing gap as Cycle 14, now one layer
deeper). No lifecycle policy on the bucket (orphaned images from requests
that succeed through storage but then fail recipe generation - a `502` -
are never cleaned up, since there's no delete-on-failure or scheduled
sweep). No `imageObjectKey` column on `SavedChat` - if a session is later
saved (Cycle 8's `saveChat`, still unwired to this flow), the image
reference only lives inside the JSONB message content, not as a queryable
field.

---

## 2026-07-29 — Cycle 16: structured logging (`shared-logger`) + security-event logging

**What:** `packages/shared-logger/src/index.ts` now exports a real
`createLogger({ service, level })` (a configured `pino` instance - JSON
lines, ISO timestamps, service name tag) instead of the empty `TODO` stub,
closing the last blocker noted in `01-security-checklist.md` §11
("needs real structured logging via `shared-logger`, not just
`console.error` on the unexpected-error path"). Two things beyond a bare
pino wrapper:

- **Redaction.** A fixed `redact` path list (`headers.authorization`,
  `token`/`accessToken`/`refreshToken`, `password`, `buffer`/`imageBuffer`,
  `content`, `messages`, each also matched one level deep via pino's `*`
  wildcard) censors these fields to `"[REDACTED]"` wherever they appear in
  a logged object, regardless of call site - directly implements
  `01-security-checklist.md` §11's "never log raw image bytes, full chat
  content, or tokens."
- **`logSecurityEvent(logger, event)`** - one consistent shape
  (`event`/`route`/`reason`/`statusCode`/`userId`, logged at `warn`) for
  every *expected* rejection (401/413/415/422/429), so these are
  greppable/alertable as a single class rather than scattered ad hoc
  `console.error` calls - the other half of §11 ("log security-relevant
  events... failed logins, permission denials, rejected uploads,
  rate-limit hits"), which before this cycle only covered *unexpected*
  errors (Cycle 11's `console.error` addition).

`packages/shared-auth/src/middleware.ts`'s `requireAuth` now takes an
optional second `logger` parameter (a minimal structural
`AuthEventLogger` interface - just `warn(obj, msg?)` - rather than an
import from `shared-logger`, so `shared-auth` doesn't gain a hard
dependency on the logging package; `shared-logger`'s real `Logger`
satisfies it structurally). On rejection, it now logs the *internal*
reason (missing/malformed/expired/invalid) server-side via
`logSecurityEvent`-shaped fields before returning the same external `401`
as always - the client-visible contract from Cycle 9 is unchanged, only
what's now visible server-side. Logs `req.originalUrl`, not `req.path` -
caught live (see below) that `req.path` inside a mounted sub-router
strips the mount prefix, which would've logged every rejection as the
unhelpful `"POST /"` regardless of which route it came from.

Both `dish-lens` routes now use the real logger: `routes/upload.ts` logs
`upload-rejected` (format/size/dimension/blur/dish-classification
rejections), `moderation-blocked`, and `rate-limited` (the per-user upload
limiter's handler); `routes/history.ts` gained server-side error logging
it never had before (a real, if smaller, pre-existing gap - the same
"first cycle to actually touch this code" pattern as Cycle 8's `shared-db`
fixes). Every prior `console.error` call (unhandled-error catch-alls in
both routes, nutrition-lookup failure, and this repo's own new
image-storage/normalization failure logging from Cycle 15) is now
`logger.error` with a real `err` field - `createLogger` registers pino's
standard `err` serializer so a logged `Error` produces an actual
`message`/`stack`, not an empty object (plain JSON.stringify of an `Error`
loses its non-enumerable `message`/`stack` properties otherwise; caught by
a dedicated unit test before assuming it worked).

**Prerequisite fix:** `shared-logger` had no `test` script or `vitest`
devDependency - added both, matching the convention `shared-auth`
established in Cycle 9.

**Tests:** `packages/shared-logger/tests/logger.test.ts` - 6 cases against
a real pino instance writing to a captured in-memory stream (not mocked -
this needs pino's actual redaction/serialization behavior to mean
anything): logs at the configured level tagged with the service name;
suppresses below-threshold levels; redacts an `authorization` header
wherever nested, confirmed the raw token string never appears anywhere in
the serialized line; serializes an `err: new Error(...)` into a real
`message`/`stack` rather than `{}`; redacts `buffer`/`content` fields,
confirmed the raw strings never appear in the output; `logSecurityEvent`
produces the correct structured warning shape. `packages/shared-auth/tests/middleware.test.ts`
gained 2 cases: a supplied logger receives the internal rejection reason on
401 without changing the client response; the logger is never called on a
successful verification. 78/78 dish-lens tests still passing (`save-chat.test.ts`'s
4 cases still skip without a running local Postgres, unchanged), 18/18
shared-auth + shared-logger tests passing. `pnpm -r run typecheck` and
`pnpm -r run build` pass clean across all 9 workspace packages.

**Verified live** (real running app, real `.env`, no mocks): started the
compiled app and drove requests with curl while tailing the raw log
output. An unauthenticated `POST /upload` and `GET /chats` each produced a
`{"event":"auth-rejected","route":"POST /upload","reason":"missing",...}`-
shaped JSON line - and this is where the `req.path` vs `req.originalUrl`
bug was actually caught: the first version logged both as `"POST /"` /
`"GET /"`, which would make route-based alerting useless in production
(every rejection looking identical). Fixed, rebuilt, and re-verified: the
routes now log correctly (`POST /upload`, `GET /chats`). A plain-text file
renamed as an upload, sent with a valid signed JWT, produced an
`{"event":"upload-rejected","reason":"unrecognized-format","userId":"verify-user-cycle16",...}`
line - confirmed by inspecting the raw log line directly that no file
content or header value appears anywhere in it. The app process was
stopped afterward.

**Not done yet:** `logger.info`-level request logging (a line per request,
not just per-rejection) doesn't exist - only rejections and the boot line
are logged today; that's a reasonable next increment but wasn't asked for
by any checklist item, so left alone rather than expanding scope. Error
middleware itself is still duplicated per-route (`handleUploadError`,
`handleHistoryError`) rather than lifted into a shared package -
`01-security-checklist.md` §11's separate "centralize error-handling
middleware" item is still open. `drive-sync` has no logger wiring yet -
its routes/index.ts are still stubs with nothing to log. No log
shipping/aggregation (Sentry/Datadog, `01-security-checklist.md` §12) -
these are structured local JSON lines only, not sent anywhere yet.

---

## 2026-07-29 — Cycle 17: input/transport hardening + centralized error handling

**What:** Closes most of `01-security-checklist.md` §2/§3 and the
"centralize error-handling middleware" item flagged as still-open at the
end of Cycle 16. New `packages/shared-utils/src/http.ts` (the package's
first real content past its `TODO` stub) exports three framework-level
pieces shared by both apps:

- **`enforceHttps(nodeEnv)`** - rejects any request reaching the app over
  plain HTTP once `NODE_ENV=production`, a no-op in dev. Requires
  `app.set("trust proxy", 1)` (now set in both apps' `index.ts`) so
  `req.secure` reflects the client's real connection when a TLS-terminating
  load balancer sits in front, not the plain-HTTP proxy-to-app hop.
- **`notFoundHandler()`** - a JSON `404` instead of Express's default HTML
  "Cannot GET /x" page.
- **`createFallbackErrorHandler(logger)`** - the actual centralization:
  one last-resort error handler, registered after every router in both
  apps, replacing what was previously duplicated per-route
  (`handleUploadError`, `handleHistoryError` still exist for their
  route-specific cases like `multer.MulterError`, but anything that
  reaches *this* handler - most importantly body-parser errors like
  malformed JSON, which fire in global middleware before any router is
  reached - is now caught centrally instead of falling through to
  Express's own leaky default). Maps a body-parser-style 4xx error to its
  real status (`400`, not a blanket `500`) without ever echoing the
  parser's own error message (which could contain a snippet of the raw
  malformed body).

Both apps' `index.ts` also gained a custom `helmet` CSP
(`default-src 'none'`, `useDefaults: false` - correct for a pure JSON API
that never serves HTML/scripts/styles; `useDefaults: false` was added
after a live check showed helmet otherwise merges in font-src/img-src/
style-src defaults alongside `defaultSrc`, diluting the "nothing is
allowed" intent) and an explicit `express.json({ limit: "100kb" })` body
size cap. `drive-sync` also gained `src/logger.ts` (same `createLogger`
pattern as Cycle 16's `dish-lens` one) since it's now wired into
`createFallbackErrorHandler` and the boot-line log - the first real code
in that app beyond scaffolding, though its own routes remain unbuilt
(DriveSync milestones haven't started).

Two DishLens-specific input-validation additions:
- `routes/upload.ts` gained `requireMultipartContentType` - rejects any
  `POST /upload` whose `Content-Type` doesn't start with
  `multipart/form-data` with a `415`, *before* multer parses it. Distinct
  from `validateUpload`'s magic-byte sniffing of the file itself - this is
  the header-level check `01-security-checklist.md` §3 asks for
  separately. Logged via `logSecurityEvent` like every other rejection on
  this route.
- `routes/history.ts`'s `GET /:chatId` now validates `chatId` against a
  `zod` `.uuid()` schema (matching `SavedChat`'s Prisma `@default(uuid())`
  ID) before calling `getSavedChat` - previously only checked truthiness,
  which is nearly a no-op since Express won't match `:chatId` on an empty
  path segment anyway. Malformed IDs now get a clean `400` instead of
  being handed to Prisma unchecked.

Also confirmed, not implemented: `01-security-checklist.md` §3's "use
Prisma's parameterized queries - never raw string-concatenated SQL" is
already satisfied - grepped the whole repo for `$queryRaw`/`$executeRaw`
and found zero matches, so there's nothing to fix, just nothing to
regress either. "Sanitize/escape user-supplied text (chat titles, etc.)
before storage and on render" stays open - no live endpoint accepts
free-text user input yet (`SavedChat.dishName` comes from Vision/Claude,
not a client-supplied field), so there's nothing to sanitize against
today.

**Tests:** `packages/shared-utils/tests/http.test.ts` - 7 cases against
hand-built mock `req`/`res`: `enforceHttps` passes plain HTTP through in
dev, passes secure requests through in production, rejects plain HTTP in
production with a `403`; `notFoundHandler` returns a JSON `404`;
`createFallbackErrorHandler` logs and returns a generic `500`, maps a
body-parser-style error object (`status: 400`) to its real status instead
of a blanket `500`, and defers to `next()` rather than double-responding
if headers were already sent. `packages/shared-utils` also gained its
first `test`/`vitest` setup (same prerequisite pattern as Cycles 9 and
16). 72/72 dish-lens tests passing - **all of them**, including
`save-chat.test.ts`'s 4 cases, which had skipped in every prior cycle for
lack of a running local Postgres; this cycle stood one up for live
verification (see below) and applied the existing `prisma migrate deploy`
against it, so the standing test gap is now closed for any future session
that has Postgres running. `pnpm -r run typecheck` and `pnpm -r run build`
pass clean across all 9 workspace packages.

**Verified live** (real running app, real `.env`): started a local
Postgres (via the Laragon-bundled `postgres.exe`/`pg_ctl` - not Docker,
which isn't installed in this environment) against the existing
`lens_and_sync_dev` database, found it had no schema at all (a different
local Postgres instance than whatever prior cycles used), and applied
`prisma migrate deploy` to bring it current - closing the recurring
"needs a running local Postgres" gap for real, not just working around it.
With the compiled app running: confirmed the CSP header is exactly
`Content-Security-Policy: default-src 'none'` (the `useDefaults: false`
fix, caught live - the first version leaked extra default directives);
confirmed HSTS (`Strict-Transport-Security`) and `X-Content-Type-Options`
headers are present; an unknown route returned the new JSON `404`; a
malformed-JSON body to `GET /chats` returned a JSON `400`
(`{"error":{"code":"invalid-request",...}}`), not an HTML stack-trace
page; `POST /upload` with a valid token but `Content-Type: application/json`
returned `415 invalid-content-type` before multer ran; `GET /chats/not-a-uuid`
returned `400 invalid-request`; and - now that Postgres was actually
migrated - `GET /chats` returned a real `{"chats":[]}` and
`GET /chats/:chatId` for a well-formed but nonexistent UUID returned a
genuine `404 not-found` (previously this could only be verified as a
generic `500`, since no live Postgres was reachable in any earlier
cycle's verification). The app process was stopped afterward; Postgres
was also stopped (it wasn't running before this cycle, unlike the
already-running local Redis, so it was torn down to match).

**Not done yet:** RBAC/ABAC checks beyond "is this a valid token for some
user" (`01-security-checklist.md` §1, unrelated to this cycle's scope).
Query-param validation has no live target yet - no current endpoint reads
a query string. Chat-title/free-text sanitization stays blocked on an
endpoint that accepts free text existing at all (see above). `drive-sync`
still has no real routes to apply `requireMultipartContentType`-style
per-route validation to - only the app-level hardening (CSP, HTTPS
enforcement, fallback error handler) applies there so far.

---

## 2026-07-29 — Cycle 18: DriveSync Google Drive auth + change detection

**What:** First real business logic in `drive-sync` - Milestone #1 (Drive
half) and #2. `src/auth/index.ts`'s `createDriveAuthClient(email,
keyFile)` builds a `google.auth.JWT` scoped to `drive.readonly` only -
this app only ever reads content to sync into Pinecone, never writes to
Drive, so the broader read-write `drive` scope would be an unnecessary
privilege (`01-security-checklist.md` §4). `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
was renamed to `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` in `config.ts`/
`.env.example` - inspecting the real `.env` showed the value has always
been a path to a service-account JSON key file (matching dish-lens's
`GOOGLE_CLOUD_CREDENTIALS_JSON` convention), not raw key material, so the
old name was actively misleading. While fixing that, found the same class
of off-by-one relative-path bug Cycle 11 hit for dish-lens's credentials
path (`../` instead of `../../`, resolving from the app's own cwd) and
fixed it in the local `.env` (not committed).

`src/drive/index.ts`:
- `createDriveClient(auth)` - thin factory wrapping `google.drive({
  version: "v3", auth })`.
- `listDriveFiles(drive, folderId)` - lists every non-trashed file
  directly inside `folderId`, paginating through `nextPageToken` until
  exhausted. Takes the `drive_v3.Drive` client as a parameter (same
  dependency-injection shape as every DishLens external-service call), so
  it's unit-testable against a hand-built fake client. Escapes a literal
  single quote in `folderId` before interpolating it into Drive's `q`
  query language (defensive - `folderId` is always admin-configured via
  `GOOGLE_DRIVE_FOLDER_IDS`, never client input, but the escape is cheap
  and correct per Drive's own docs).
- `detectChanges(currentFiles, knownFiles)` - the actual Milestone #2
  logic, a pure function with no I/O: a file is "new" if its ID isn't in
  the known set, "updated" if Drive's `modifiedTime` is strictly newer
  than what was last recorded, "deleted" if a previously-known ID no
  longer appears in the current listing (also correctly catches a file
  being *moved out* of the tracked folder, not just an actual Drive
  deletion - the right behavior since this app only tracks files inside
  the configured folder(s)).

**Prerequisite fix:** `google-auth-library` (needed for the `JWT` type
used by both new files) was only a transitive dependency of `googleapis`,
not declared directly - pnpm's isolated `node_modules` doesn't let a
package import an undeclared transitive dependency, so `tsc` failed with
`Cannot find module` until it was added to `package.json` explicitly
(matching the already-resolved `9.15.1` from the lockfile).

**Tests:** `tests/drive/change-detection.test.ts` - 5 cases: no-known-record
→ new; strictly-newer `modifiedTime` → updated; identical `modifiedTime` →
neither new nor updated (unchanged); a known ID absent from the current
listing → deleted; a realistic mixed batch (one of each, plus one
unchanged) classified correctly in a single call. `tests/drive/list-drive-files.test.ts`
- 5 cases against a hand-built fake `drive_v3.Drive`: maps API entries to
`DriveFileMetadata`; skips an entry missing a required field rather than
including a partial record; follows `nextPageToken` across multiple pages
and combines the results; scopes the query to the given folder ID and
excludes trashed files; escapes a single quote in the folder ID. 10/10
passing (first tests to exist in `drive-sync` at all - previously "no
tests to run yet" per `05-progress.md`). `pnpm -r run typecheck` and
`pnpm -r run build` pass clean across all 9 workspace packages.

**Verified live** (real Google Drive API, real service account) - hit a
real blocker first: the initial call returned `403 PERMISSION_DENIED`,
"Google Drive API has not been used in project 11490227436... or it is
disabled." Same handling as Cycles 11/12's account-level blockers: flagged
to the user rather than enabling a GCP API unilaterally; the user enabled
it in the console. After that, a standalone script against the real
`drivesync@lens-and-sync.iam.gserviceaccount.com` service account and the
real configured folder (`GOOGLE_DRIVE_FOLDER_IDS`) found 7 real files (all
Google Docs - recipe test fixtures, coincidentally useful real input data
for the extraction cycle next). Ran `detectChanges` against this real data
four ways: vs. an empty known-set → all 7 correctly "new"; vs. an
identical known-set (mapped 1:1 from the real listing) → zero new/updated/
deleted; vs. a known-set with one file's `modifiedTime` set far in the
past → exactly that one file "updated", the other 6 "new" (as expected,
since only one was in the known-set at all); vs. a known-set with one
extra ID that doesn't exist in Drive → exactly that one ID "deleted". All
four matched the expected counts exactly.

**Not done yet:** Pinecone API key setup (the other half of Milestone #1)
- not started, that's Milestone #6 territory. No extraction (#3),
chunking (#4), embeddings (#5), Pinecone writes (#6), dedup/versioning
(#7), or Postgres sync-state persistence (#8) yet - `detectChanges` is
pure comparison logic; nothing yet calls it with real `DriveFile` records
from Postgres, since that model has no reader/writer in `drive-sync` at
all today. No scheduling (#9) or retrieval endpoint (#10) - `routes/sync.ts`
is still an empty stub.

---

## 2026-07-29 — Cycle 19: DriveSync extraction pipeline

**What:** `src/extraction/index.ts` implements `extractText(drive, file)`
- Milestone #3. Dispatches on `mimeType`:

- **Google Docs / Slides** (`application/vnd.google-apps.document` /
  `...presentation`) - Drive's own `files.export` to `text/plain`. No
  separate parser needed; Drive does the conversion server-side.
- **Google Sheets** (`application/vnd.google-apps.spreadsheet`) - exports
  to `text/csv`. Documented limitation: Drive's `export` endpoint only
  returns the *first* sheet of a multi-sheet spreadsheet - full
  multi-sheet support would need the separate Sheets API (`spreadsheets.values.get`
  per sheet), out of scope for this cycle.
- **Plain text** (`text/plain`) - downloaded via `files.get({ alt: "media"
  })` and decoded as UTF-8 as-is.
- **PDF** (`application/pdf`) - downloaded the same way, then parsed with
  `pdf-parse` v2 (a from-scratch TypeScript rewrite, not the old v1
  function-style API - exposes a `PDFParse` class with `.getText()`).

Every path returns a discriminated `ExtractionResult` rather than a bare
string, with `empty-content` and `unsupported-mime-type` as distinct
non-throwing outcomes (mirrors the discriminated-result pattern used
throughout DishLens - `assessUpload`, `classifyDish`, etc.) - a caller can
tell "nothing to extract" apart from "this file type isn't handled" apart
from a genuine `extraction-failed`.

**OCR for scanned PDFs (the milestone's conditional clause) is detected,
not implemented.** A PDF with real pages but no extractable text (the
signature of a scanned/image-only PDF) returns a distinct
`scanned-pdf-ocr-not-implemented` reason rather than silently returning
empty text or claiming success on a blank string. Real OCR (`tesseract.js`
being the natural fit, since it's already a documented option and needs
no separate paid API) is left as a dedicated follow-up - it needs a real
scanned-PDF fixture to verify against (none exists in the test Drive
folder, which is all native Google Docs), and its worker-based
runtime downloads trained-language data at runtime, which needs its own
verification pass rather than being bundled into this cycle.

**Gotcha hit (caught by a test before assuming it worked):** `pdf-parse`'s
`getText()` inserts a `"-- page_number of total_number --"` marker
between every page by default (`pageJoiner` parameter). A real generated
PDF with a page but zero text drawn on it therefore came back as `{ ok:
true, text: "-- 1 of 1 --" }` - a `pageJoiner: ""` on every `getText()`
call fixed it, letting the actual emptiness check work correctly.

**Prerequisite additions:** `pdf-parse` (`^2.4.5`) added as a runtime
dependency; `pdf-lib` (`^1.17.1`, dev-only) added purely to generate real
PDF fixtures in tests (a genuinely blank page and a page with real drawn
text) - no network/pre-existing PDF file needed for either test case.

**Tests:** `tests/extraction/extract-text.test.ts` - 9 cases: Google Doc/
Slides/Sheet export mapped and trimmed correctly (including confirming
the exact `fileId`/`mimeType`/`responseType` arguments sent to the Drive
API); a Doc that exports to whitespace-only returns `empty-content`; a
plain-text file downloads and decodes correctly; an unsupported mime type
is rejected *without* calling the Drive API at all (confirmed via
`toHaveBeenCalled` on both `export` and `get`); a rejected Drive API call
returns `extraction-failed` instead of throwing; and, using real
`pdf-parse` against real `pdf-lib`-generated PDFs (no mocking - this
logic has no live external dependency to fake): a PDF with real drawn
text extracts that exact text, and a PDF with a real page but no text
layer returns `scanned-pdf-ocr-not-implemented`. 19/19 passing
(first extraction tests to exist - previously zero). `pnpm -r run
typecheck` and `pnpm -r run build` pass clean across all 9 workspace
packages.

**Verified live** (real Drive API, real files - no mocks): ran
`extractText` against all 7 real files found by Cycle 18's live check.
All 7 (real Google Docs, TEST-prefixed recipe fixtures) extracted
successfully, 454-807 characters each, with real recipe content visible
in a preview of each result (category/cuisine/tags/ingredients text,
confirming the export path returns genuinely structured recipe content,
not just placeholder text). No Sheets, Slides, or PDF files exist in the
real test folder, so those paths remain live-unverified beyond their unit
tests - flagged below rather than glossed over.

**Not done yet:** OCR for scanned PDFs (see above - detected, not
implemented). Sheets/Slides/PDF extraction unverified against real Drive
files of those types (only unit-tested + a synthetic PDF). No chunking
(#4) yet - `extractText`'s output is whole-document text, not yet split
into retrieval-sized pieces. Embeddings (#5), Pinecone writes (#6),
dedup/versioning (#7), Postgres sync-state persistence (#8), scheduling
(#9), and the retrieval endpoint (#10) are all still unstarted.

---

## 2026-07-29 — Cycle 20: DriveSync chunking strategy

**What:** `src/chunking/index.ts`'s `chunkText(text, source, options)` -
Milestone #4. Token-budgeted, not character-budgeted: `js-tiktoken`'s
`encodingForModel("text-embedding-3-small")` (resolves to `cl100k_base`,
the same encoding the actual embedding model uses) counts tokens per
line, so a chunk's size is measured the way the embedding API will
actually measure it, not an approximation. Accumulates whole lines into a
buffer until the next line would push it over `chunkSizeTokens` (default
400), then starts the next chunk by first flushing the current one, then
seeding the new buffer with however many trailing lines from the
just-finished chunk fit within `overlapTokens` (default 60) - so
retrieval context survives a hard chunk boundary. A single line that's
already over budget on its own is flushed as its own dedicated chunk
(bypassing the normal overlap-seed path, which would otherwise glue it to
unrelated leading content - caught by a test, see below) rather than
being silently dropped or truncated mid-token.

Every chunk carries `fileId`/`title` (Milestone #4's "preserve source
metadata") plus a `section` - the most recent heading-like line before
the chunk started. Since Drive's plain-text export strips all real
formatting (no bold, no heading level - see `extraction/index.ts`),
"heading-like" has to be a text heuristic, not real structure. The final
heuristic: a trimmed line that ends in a bare colon with nothing after it
(`Ingredients:`, `Steps:`, `Notes:`) - which correctly excludes `Key:
value` metadata lines like `Category: Main Course` (content follows the
colon, so it doesn't match).

**Two real bugs caught only by testing against live data, not assumed
correct from the design doc:**

1. **First heading heuristic was far too permissive.** The original rule
   ("short line, doesn't end in sentence punctuation") flagged ordinary
   short content lines (`"bake"`, `"mix"`, `"flour"`) as headings in a
   unit test using made-up text - then, pulling a *real* extracted Doc's
   full text to investigate, found the actual structure: list items start
   with `*`/`1.` markers and real section labels end in a bare `:`.
   Rewrote the heuristic around that real signal instead of a guess.
2. **`\r\n` line endings.** The same real-text pull revealed Drive's
   plain-text export uses `\r\n`, not `\n` - `text.split("\n")` would have
   left every line carrying a trailing `\r`, silently breaking the new
   `endsWith(":")` heading check (and leaking `\r` into chunk text).
   Normalizing line endings before splitting fixed both.

**Also caught by a test, not live data:** the oversized-single-line case
initially produced a chunk that combined the huge line with leftover
overlap-seed content from the previous chunk, instead of isolating it -
restructured to check "is this segment alone already over budget" *before*
the normal overlap-seeding path, flushing any pending buffer first with no
seeding into the oversized chunk.

**Prerequisite addition:** `js-tiktoken` (`^1.0.21`) - a pure-TypeScript,
no-native-bindings port of OpenAI's tokenizer with `cl100k_base`'s rank
data bundled locally (no runtime network fetch needed to tokenize).

**Tests:** `tests/chunking/chunk-text.test.ts` - 9 cases: text well under
budget stays one chunk; empty/whitespace-only text returns no chunks; text
over budget splits into multiple chunks, each within budget plus one
line's slack; `chunkIndex` values are sequential from zero; the end of one
chunk's content reappears at the start of the next when `overlapTokens >
0`; no overlap occurs when `overlapTokens` is `0`; a real bare-colon
heading is tracked as `section` across subsequent chunks; a `Key: value`
line is confirmed *not* picked up as a heading (regression test for bug
#1 above); an oversized single line becomes its own chunk rather than
being combined or dropped. 28/28 passing across the app (19 pre-existing +
9 here). `pnpm -r run typecheck` and `pnpm -r run build` pass clean across
all 9 workspace packages.

**Verified live** (real Drive files, real extracted text - no mocks): ran
`extractText` + `chunkText` (`chunkSizeTokens: 60`, deliberately small to
force multiple chunks per short recipe doc) against all 7 real files from
the test folder. Every document split into 3-5 chunks; every chunk's
`section` correctly reflects `Ingredients:`/`Steps:` (or `null` before the
first heading), never a `Category:`/`Cuisine:`/`Tags:` metadata line;
token counts per chunk stayed within budget plus one line's slack, matching
the unit-tested behavior; overlap was visible in the raw output (the
tail of one chunk's text reappearing at the head of the next). This is
the same live data that surfaced both real bugs above - the fixes were
verified against the exact documents that exposed them, not just the
now-passing unit tests.

**Not done yet:** Sheets/Slides/PDF-derived text has never actually been
chunked against real files of those types (extraction itself is
real-data-verified per Cycle 19, but no real non-Doc file exists in the
test folder to chunk). Embeddings (#5), Pinecone writes (#6),
dedup/versioning (#7), Postgres sync-state persistence (#8), scheduling
(#9), and the retrieval endpoint (#10) are all still unstarted - nothing
yet calls `chunkText`'s output for anything beyond this cycle's
verification script.

---

## 2026-07-29 — Cycle 21: DriveSync embedding generation (OpenAI)

**What:** `src/embeddings/index.ts` implements `generateEmbeddings(client,
model, texts, options)` - Milestone #5. Same dependency-injection shape
as every external-service call in this codebase: `client` is `Pick<OpenAI,
"embeddings">`, so tests never touch the network.

- **Batching:** splits `texts` into batches of `batchSize` (default 100)
  before calling `client.embeddings.create({ model, input: batch })` -
  OpenAI caps a single request at 2048 input items and 300,000 tokens
  summed across all inputs, and 100 chunks per batch stays comfortably
  under both given `chunking/index.ts`'s ~400-460-token chunk sizes.
  Batches are processed sequentially, not in parallel - firing every batch
  at once would be more likely to *cause* rate limiting than avoid it.
- **Rate limits/retries:** a batch that fails with a `429` or `5xx` is
  retried with exponential backoff (`baseDelayMs * 2^attempt`, default
  base 500ms) up to `maxRetries` (default 3) before giving up; any other
  error (e.g. a `400` from malformed input) fails immediately without
  retrying, since retrying a request that will deterministically fail
  again wastes time and quota for no benefit. `sleep` is an injectable
  parameter (same reasoning as `redis`/`bucket`/`drive` elsewhere in this
  codebase), so tests exercise real retry-count and backoff-timing logic
  without actually waiting.
- **Ordering correctness:** the response's own `index` field is used to
  reorder each batch's embeddings before returning them, rather than
  trusting the response array's position - defensive, since a caller
  pairing embeddings back up with `chunkText`'s chunks by array position
  would silently mismatch vectors to the wrong chunk text if that
  assumption were ever violated.
- **All-or-nothing per call:** if any batch exhausts its retries, the
  whole call returns `{ ok: false, reason: "embedding-failed" }` rather
  than a partial list with silent gaps - a file's chunks are either fully
  embedded or the sync for that file didn't happen, never
  inconsistently half-vectorized without a caller noticing.

Note: the OpenAI SDK already has its own built-in retry behavior
(`maxRetries` client option, silent). This module's retry layer sits on
top of that deliberately - it's explicit, testable, and its exhaustion is
visible to the caller as a real `embedding-failed` result, rather than
relying entirely on an opaque SDK default.

**Tests:** `tests/embeddings/generate-embeddings.test.ts` - 9 cases
against a hand-built fake client: empty input returns an empty result
without calling the API at all; a response with out-of-order `index`
values is correctly reordered; input splits into the expected number of
batches for a given `batchSize`; a `429` is retried and succeeds once the
mocked API recovers; a `503` is retried the same way as a `429`; backoff
delays are confirmed exponential (`100`, then `200`, for `baseDelayMs:
100`); a non-retryable `400` fails immediately with zero retries/sleeps;
exhausting `maxRetries` returns `embedding-failed` after the expected
total call count (initial + N retries); a failure in *any* batch fails
the whole multi-batch call rather than returning a partial result.
37/37 tests passing across the app (28 pre-existing + 9 here). `pnpm -r
run typecheck` and `pnpm -r run build` pass clean across all 9 workspace
packages.

**Verified live** (real OpenAI API, real chunked text - no mocks): ran
`chunkText` (small `chunkSizeTokens: 40` to force multiple chunks per
short recipe doc) over all 7 real extracted Drive docs, producing 42
total chunks, then called `generateEmbeddings` against the real API with
`batchSize: 5` (forcing 9 real separate batched requests, not one big
call). Got 42 real embeddings back, all dimension 1536 (matching
`text-embedding-3-small`'s documented output size). As a sanity check
that these are genuine semantic embeddings and not just distinct random
vectors: cosine similarity between two chunks of the *same* real document
("TEST: Creamy Mushroom Pasta") was 0.75, versus 0.42 between chunks of
two *different* documents - same-document similarity meaningfully higher,
as expected for real embeddings of related recipe content. Retry-on-error
behavior itself was intentionally left to the unit tests above rather
than re-verified against the real API - deliberately triggering a real
rate limit or server error against a live paid API isn't a reasonable way
to verify it, and the mocked-client tests already exercise the exact
retry/backoff code path.

**Not done yet:** Pinecone writes (#6) - these 42 real embeddings were
generated but not written anywhere; that's the next cycle. Dedup/versioning
(#7), Postgres sync-state persistence (#8), scheduling (#9), and the
retrieval endpoint (#10) remain unstarted.

---

## 2026-07-29 — Cycle 22: DriveSync Pinecone index writes

**What:** `src/vector-store/index.ts`'s `upsertChunkVectors(index,
vectors, options)` and `vectorId(fileId, chunkIndex)` - Milestone #6.
`vectorId` is the stable `{fileId}-{chunkIndex}` scheme called for by the
milestone: a pure, deterministic function, so re-syncing an unchanged or
updated file re-derives the exact same IDs for its chunks and an upsert
overwrites the prior vector in place rather than creating a
duplicate/orphaned one alongside it. Metadata is deliberately narrow -
`fileId`/`title`/`chunkIndex`/`sourceUrl`/`section` only, never the
chunk's actual extracted text - directly implementing
`01-security-checklist.md` §4's "Pinecone metadata never includes
sensitive raw content." `section` is stored as `""` rather than
`null`/omitted, since Pinecone metadata values are string/number/boolean/
string-array only - there's no null in that type system. Upserts are
batched (default 100 per call, Pinecone's own recommended size) and take
the `Index` client as a parameter (same dependency-injection shape as
every external-service call in this codebase), so this is unit-testable
against a hand-built fake index. `src/vector-store/pinecone-client.ts`
holds the one real `Pinecone`/`Index` singleton, scoped to the configured
index + namespace via `.namespace()`.

**Blocker hit and resolved mid-cycle:** the real `PINECONE_API_KEY` in
`.env` turned out to be a placeholder (`defaultp...` - not Pinecone's real
`pcsk_...` key format), confirmed by a real `listIndexes()` call coming
back `PineconeAuthorizationError`. Flagged to the user rather than
guessing around it; they supplied a real key. Once connected,
`listIndexes()` revealed the pre-existing `drive-sync-dev` index is
configured at **512 dimensions**, not `text-embedding-3-small`'s default
1536 - a real mismatch that would have made every upsert in this cycle
fail. Rather than delete/recreate the existing index (destructive, and
not this session's call to make about infra someone else provisioned),
`generateEmbeddings` (Cycle 21) gained an optional `dimensions` parameter
using `text-embedding-3-small`'s Matryoshka-representation-learning
support for shortened output, and a new `EMBEDDING_DIMENSIONS` config
value (set to `512` locally) threads that through - Milestone #6's own
wording, "dimension (matching embedding model output)," cuts both ways:
the index has to match what's actually requested from the embedding
model, and here that meant asking the model to match the index instead of
the reverse.

**Prerequisite addition:** `DriveFileMetadata` (Cycle 18) gained a
required `webViewLink` field - Drive's own canonical "open this file" URL,
now requested via `listDriveFiles`'s `fields` parameter. Used as-is for
the "source URL" metadata field rather than hand-constructing a
per-mime-type URL scheme, which would have to track Drive's URL format
for every file type separately (Docs vs. Sheets vs. Slides vs. arbitrary
uploads) and could silently drift from whatever Drive actually serves.
This is a real, if small, change to an earlier cycle's contract - the
blast radius was checked first: `extraction/index.ts` and `chunking/index.ts`
both take narrower inline types (`{ id, mimeType }` / `{ fileId, title }`)
rather than the full `DriveFileMetadata`, so neither was affected; only
`drive/index.ts`'s own tests needed updating (fixtures gained the new
field).

**Tests:** `tests/vector-store/upsert-chunk-vectors.test.ts` - 8 cases
against a hand-built fake `Index`: `vectorId` is deterministic and stable
across repeated calls for the same file/chunk; empty input returns
`{ ok: true, count: 0 }` without calling the API; a single vector upserts
with the exact expected ID and metadata shape; a `null` section is stored
as `""`; metadata keys are confirmed to be exactly the five allowed
fields (regression test against ever accidentally including raw text); a
5-vector list with `batchSize: 2` splits into 3 calls; an API rejection
returns `upsert-failed` rather than throwing.
`tests/embeddings/generate-embeddings.test.ts` gained 2 cases for the new
`dimensions` passthrough (configured value sent to the API; omitted
entirely when not configured). `tests/drive/*.test.ts` fixtures updated
with the new `webViewLink` field. 47/47 tests passing across the app (39
pre-existing + 8 here). `pnpm -r run typecheck` and `pnpm -r run build`
pass clean across all 9 workspace packages.

**Verified live end-to-end** (real Drive, real OpenAI, real Pinecone - no
mocks anywhere in this chain): all 7 real Drive docs → real `extractText`
→ real `chunkText` → real `generateEmbeddings` with `dimensions: 512`
(confirmed the returned vectors were genuinely 512-dimensional, matching
the real index) → real `upsertChunkVectors` against the real
`drive-sync-dev` index/`default` namespace. `describeIndexStats()`
afterward showed exactly 7 records in the `default` namespace at
dimension 512. Fetched one vector back by its exact `{fileId}-{chunkIndex}`
ID and confirmed its metadata round-tripped correctly, including a real
`sourceUrl` (`https://docs.google.com/document/d/.../edit?usp=drivesdk` -
a genuine Drive URL, not a placeholder). Ran a real similarity query for
"How do I make banana pancakes?" and got the real "TEST: Banana Pancakes"
document back as the top match (score 0.71) by a wide margin over the
next candidates (0.32, 0.32) - concrete proof the whole pipeline produces
retrieval-quality results, not just structurally valid API calls. All 7
test vectors were deleted from the real index afterward
(`describeIndexStats()` reconfirmed 0 records remaining) - no test data
left in shared infrastructure.

**Not done yet:** dedup/versioning (#7) - nothing yet skips unchanged
files via content-hash comparison, and deleted Drive files don't trigger
Pinecone vector deletion (this cycle's `upsertChunkVectors` only writes,
it never deletes). Postgres sync-state persistence (#8) - the `DriveFile`
Prisma model still has no reader/writer in `drive-sync`, so `detectChanges`
(Cycle 18) has never actually been called against real historical sync
state, only hand-built known-file lists. Scheduling (#9) and the
retrieval endpoint (#10) remain unstarted. Namespace isolation for
multiple tenants is untested (not yet relevant - single namespace only).

---

## 2026-07-29 — Cycle 23: DriveSync dedup & versioning

**What:** Milestone #7, split into its two independent halves:

- **Content-hash dedup** (`drive/index.ts`): `computeContentHash(text)` -
  a plain `sha256` of the *extracted* text (not raw file bytes - two Docs
  exports of unchanged content are byte-identical for this purpose), and
  `shouldReembedFile(newHash, knownHash)`. This is a second, more precise
  layer beneath `detectChanges`'s (Cycle 18) `modifiedTime` check: Drive
  can report a `modifiedTime` change for a metadata-only edit (rename,
  move, permission change) with no actual change to the extracted text,
  and re-embedding is the expensive part of a sync (real OpenAI/Pinecone
  cost) - `shouldReembedFile` lets a caller skip that cost for a file
  `detectChanges` already flagged as "updated" but whose real content
  didn't change. `knownHash: null` (no prior record) always returns
  `true` - nothing to compare against yet.
- **Stale vector deletion** (`vector-store/index.ts`):
  `deleteVectorsForFile(index, fileId)`. The real design decision here:
  Pinecone's metadata-filter delete (`index.deleteMany({ fileId: { $eq }
  })`, which the SDK's types technically allow) **does not work on
  serverless indexes** - only pod-based ones. Since Cycle 22 already
  confirmed live that this project's real index is serverless, that
  path would have failed in production despite typechecking and probably
  working against a mocked test. Used `listPaginated({ prefix:
  '${fileId}-' })` instead - explicitly documented as serverless-only in
  the SDK, the *opposite* constraint - to find every vector ID belonging
  to a file (safe because `vectorId()`'s `{fileId}-{chunkIndex}` scheme
  guarantees the prefix), then deletes that explicit ID list. Documented,
  not "fixed": a theoretical prefix-collision case (file ID `abc` vs. file
  ID `abc-xyz`) exists but isn't realistic given Drive's actual ~33-44
  character random file IDs.

**Tests:** `tests/drive/content-hash.test.ts` - 7 cases: identical text
hashes identically; different text hashes differently; whitespace-only
differences still change the hash (confirms this is an exact-text hash,
not a semantic one); output is a real 64-hex-char sha256; `shouldReembedFile`
returns `true` for a `null` known hash, `true` for a differing hash,
`false` for a matching hash. `tests/vector-store/delete-vectors-for-file.test.ts`
- 5 cases against a hand-built fake index: no matches means
`deletedCount: 0` and `deleteMany` is never called at all; the query uses
the correct `{fileId}-` prefix; matching IDs are collected and deleted;
pagination is followed across multiple pages before deleting; an API
rejection returns `delete-failed` rather than throwing. 59/59 tests
passing across the app (47 pre-existing + 12 here). `pnpm -r run
typecheck` and `pnpm -r run build` pass clean across all 9 workspace
packages.

**Verified live** (real Drive, real Pinecone - no mocks): two independent
real `extractText` calls against the same real Drive doc produced
identical `computeContentHash` output, and `shouldReembedFile` behaved
correctly against that real hash in all three cases (no prior record,
matching, differing). Separately, upserted 3 real vectors for a
fabricated "target" file ID plus 1 for an unrelated "other" file ID into
the real `drive-sync-dev` index, confirmed 4 records via
`describeIndexStats()`, ran `deleteVectorsForFile` for the target file
ID, and confirmed exactly 3 records were deleted (`deletedCount: 3`,
`describeIndexStats()` dropped to 1) - and, critically, that the
unrelated file's vector was still fetchable afterward, proving the
prefix-based delete didn't over-delete. All test vectors (including the
"other" file's) were removed afterward, confirmed via a final
`describeIndexStats()` showing 0 records.

**Not done yet:** Postgres sync-state persistence (#8) - `shouldReembedFile`
and `deleteVectorsForFile` both exist now but have no real caller yet,
since there's still no reader/writer for the `DriveFile` Prisma model to
supply the "known" content hash or to know which files were actually
deleted in a real sync run. That's the next cycle. Scheduling (#9) and
the retrieval endpoint (#10) remain unstarted.

---

## 2026-07-29 — Cycle 24: DriveSync Postgres sync-state persistence

**What:** New `src/sync-state/index.ts` - Milestone #8. No folder for this
existed in the original scaffold (`03-monorepo-structure.md` lists `auth/`,
`drive/`, `extraction/`, `chunking/`, `embeddings/`, `vector-store/`,
`retrieval/`, `jobs/`, `routes/` - nothing Postgres-facing), so this is a
small, deliberate addition, same as Cycle 22 adding `vector-store/index.ts`
alongside the pre-scaffolded `pinecone-client.ts`. Four functions against
the existing `DriveFile` Prisma model:

- `listKnownFiles()` - reads every `DriveFile` row, mapped down to exactly
  the `KnownFileRecord` shape `detectChanges()` (Cycle 18) already
  expects. Reads every row rather than scoping by folder - the schema has
  no `folderId` column (Milestone #8's own field list is `driveFileId`/
  `contentHash`/`driveModifiedTime`/`chunkIds`/`lastSyncedAt` only), which
  matches `detectChanges`'s existing behavior of following a file by ID
  even if it moved between tracked folders.
- `getKnownContentHash(driveFileId)` - the previously-recorded hash, or
  `null` - the exact input shape `shouldReembedFile()` (Cycle 23) expects
  for "never synced before."
- `upsertSyncState(record)` - creates or updates a file's row. Only
  bumps `lastSyncedAt` explicitly on the update branch; a freshly created
  row relies on the schema's own `@default(now())` instead of duplicating
  it.
- `deleteSyncState(driveFileId)` - removes a file's row once its Pinecone
  vectors are gone (Cycle 23's `deleteVectorsForFile`); a no-op rather
  than an error if the row doesn't exist, so retrying a partially-failed
  sync doesn't need a pre-check.

Follows the established convention for Prisma-backed modules in this
codebase (`dish-lens`'s `history/save-chat.ts`, `history/list-chats.ts`):
imports the `prisma` singleton directly rather than taking it as a
dependency-injection parameter, and tests run against a real local
Postgres rather than a mock - Prisma itself isn't the kind of external
dependency this codebase fakes.

**Tests:** `tests/sync-state/sync-state.test.ts` - 8 cases against a real
local Postgres (same migrated `lens_and_sync_dev` database dish-lens
already uses): a new record is created and readable via `listKnownFiles`;
its content hash is readable via `getKnownContentHash`; a
never-synced file returns `null`; a second `upsertSyncState` call updates
the existing row in place rather than creating a duplicate; `lastSyncedAt`
is confirmed to advance on update; `chunkIds` round-trips as a real array;
`deleteSyncState` removes a record so it disappears from `listKnownFiles`;
deleting a file that was never synced resolves without throwing. Every
test cleans up its own rows in `afterEach`. 67/67 tests passing across the
app (59 pre-existing + 8 here). `pnpm -r run typecheck` and `pnpm -r run
build` pass clean across all 9 workspace packages. Running dish-lens's own
suite against the same shared Postgres confirmed no cross-app interference
(72/72, unchanged) - caught along the way that the local Redis instance
this session had been reusing had stopped running at some point; unrelated
to this cycle's work, restarted to confirm it was purely an environment
gap and not a regression, then torn back down afterward per this session's
own teardown convention.

**Verified live end-to-end** (real Drive, real Postgres - no mocks): with
`listKnownFiles()` confirmed empty beforehand, ran `detectChanges` against
the real 7-file Drive folder and the real (empty) Postgres state - all 7
correctly classified `new`. Extracted and hashed each real file for real
and called `upsertSyncState` for real, persisting all 7 to the actual
`DriveFile` table. Re-ran `detectChanges` against the *same real Postgres
state*, now populated - correctly found 0 new/updated/deleted, proving
`listKnownFiles` → `detectChanges` round-trips real persisted state
correctly, not just hand-built fixtures. Re-extracted and re-hashed every
real file a second time and confirmed `shouldReembedFile` said "no" for
all 7 against their real stored hashes - the full "would a real second
sync run skip everything unchanged" question, answered yes with real
infrastructure. All 7 rows were deleted afterward via `deleteSyncState`,
confirmed `listKnownFiles()` back to empty - no leftover test data in the
shared database. Postgres and Redis (both started fresh for this cycle,
neither was running beforehand) were stopped afterward.

**Not done yet:** nothing yet actually orchestrates
`detectChanges` → `extractText` → `chunkText` → `generateEmbeddings` →
`upsertChunkVectors`/`deleteVectorsForFile` → `upsertSyncState`/
`deleteSyncState` into one real sync run triggered by anything other than
a manual verification script - that orchestration, plus BullMQ scheduling
and job locking, is Milestone #9, still unstarted. The retrieval endpoint
(#10) also remains unstarted.
