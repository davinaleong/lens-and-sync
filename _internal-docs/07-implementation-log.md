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
