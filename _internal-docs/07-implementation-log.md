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
