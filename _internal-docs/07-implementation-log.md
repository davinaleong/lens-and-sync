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
