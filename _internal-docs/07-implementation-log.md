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
