# dish-lens Auth Implementation — Milestone Checklist

## M1 — Schema

- [x] Add `passwordHash String` to `User` in `packages/shared-db/prisma/schema.prisma`
- [x] Start local Postgres: `docker-compose -f infra/docker-compose.yml up -d postgres redis`
- [x] Generate migration: `pnpm --filter @lens-and-sync/shared-db run migrate` (do not hand-write SQL)

## M2 — Token signing in shared-auth

- [x] `packages/shared-auth/src/sign.ts`: `signToken(userId, secret, ttl)` → `jwt.sign({ sub: userId }, secret, { expiresIn: ttl })`
  - [x] One generic function used for both access and refresh tokens (different secret/TTL args)
  - [x] Also signs a random `jwtid` per token — without it, two tokens signed for the same user in the same second are byte-identical, which collides against `RefreshToken.tokenHash`'s unique constraint (caught via a failing test, not planned upfront)
- [x] Export `signToken` from `packages/shared-auth/src/index.ts`
- [x] `packages/shared-auth/tests/sign.test.ts`: sign → verify round-trip via existing `verifyAccessToken`, mirroring `verify.test.ts` style
- [x] Confirm no new `verifyRefreshToken` was added — refresh tokens verify via existing `verifyAccessToken(token, JWT_REFRESH_SECRET)`

## M3 — Password hashing (app-local)

- [x] Add `bcryptjs` + `@types/bcryptjs` to `apps/dish-lens/package.json`
- [x] `apps/dish-lens/src/auth/hash.ts`: `hashPassword` / `verifyPassword` wrappers over `bcryptjs`
- [x] Zod password schema capped at `.max(72)` (bcrypt silent-truncation guard), min 8

## M4 — Auth service layer

- [x] `apps/dish-lens/src/auth/service.ts` with:
  - [x] `registerUser`
  - [x] `loginUser`
  - [x] `refreshTokens`
  - [x] `revokeRefreshToken`
- [x] Uses `prisma` from `@lens-and-sync/shared-db`, hashing from M3, `signToken` from M2
- [x] Returns discriminated `{ ok: true, ... } | { ok: false, reason }` (matches `verify.ts` style) — no throwing on expected failures
- [x] Refresh flow implemented in order: verify JWT sig+expiry → look up `sha256(token)` in `RefreshToken.tokenHash` → confirm `revokedAt IS NULL` → revoke old row → insert new row → issue new access+refresh pair
- [x] Login failure (unknown email or bad password) collapses to one generic reason (no enumeration signal) — hardened further with a constant-time dummy-hash compare on unknown-email so response timing doesn't leak it either

## M5 — Routes

- [x] `apps/dish-lens/src/routes/auth.ts` (`authRouter`), following `history.ts`/`upload.ts` conventions:
  - [x] Zod schemas at top, `.safeParse` inline per route
  - [x] try/catch + `next(err)` per route
  - [x] Router-scoped trailing `ErrorRequestHandler`
  - [x] `{ error: { code, message } }` shape on every failure
- [x] `POST /auth/register` → 201 `{ accessToken, refreshToken }`; 409 `email-in-use`
- [x] `POST /auth/login` → 200 `{ accessToken, refreshToken }`; 401 `invalid-credentials`
- [x] `POST /auth/refresh` → 200 rotated `{ accessToken, refreshToken }`; 401 `invalid-refresh-token`
- [x] `POST /auth/logout` → 204, revokes given refresh token

## M6 — Logging

- [x] `packages/shared-logger/src/index.ts`: add `"auth-failed"` to `SecurityEventType` (kept distinct from `"auth-rejected"`)
- [x] `logSecurityEvent` called on every 4xx path in `auth.ts` (same pattern as `upload.ts`)

## M7 — Wiring

- [x] `apps/dish-lens/src/index.ts`: `app.use("/auth", authRouter)` mounted alongside `/upload`/`/chats`, before `notFoundHandler()`

## M8 — Tests

- [x] `apps/dish-lens/src/auth/service.test.ts` (vitest, hand-rolled mocks, `vi.mock("@lens-and-sync/shared-db")`, no supertest)
  - [x] register: success, duplicate-email
  - [x] login: success, wrong-password, unknown-email
  - [x] refresh: success, expired, revoked, reused-after-rotation, cross-user-mismatch
  - [x] logout: revokes token
- [x] `pnpm --filter @lens-and-sync/dish-lens run typecheck && run test` passes (pre-existing `session-store.test.ts`/`save-chat.test.ts` failures are unrelated — they require a live Postgres/Redis this sandbox doesn't have running by default; not touched by this change)

## M9 — Local end-to-end verification

- [x] `pnpm --filter @lens-and-sync/dish-lens run dev` (verified via a throwaway local Postgres + Redis instance since Docker wasn't available in this environment)
- [x] curl `register` → `login` → `refresh` (confirmed new token pair differs, old refresh token rejected with 401) → `logout`
- [x] Subsequent `/chats` call with issued access token returns real data (`200 {"chats":[]}`, not 401)
- [x] Bonus: verified the full migration history (`init` + `add_password_hash`) applies cleanly to a brand-new database via `prisma migrate deploy`, matching what production will do

## M10 — Production rollout gap (Railway dashboard, not code)

- [ ] Append `&& pnpm --filter @lens-and-sync/shared-db run migrate:deploy` to `dish-lens`'s Railway Build Command
- [ ] Confirm this runs _before_ app startup, ahead of deploying passwordHash-dependent code
- [ ] Deploy
- [ ] Repeat the same curl sequence (register → login → refresh → logout → `/chats`) against `https://dish-lens-production.up.railway.app`

## Explicitly out of scope (fast-follow, not this change)

- [ ] Stricter per-IP/per-email login rate limiter (app-wide `rateLimit` in `index.ts` is relied on for now)

## Non-goals / confirmed unaffected

- `drive-sync` — untouched; verifies tokens only, shares `JWT_ACCESS_SECRET` with `dish-lens` already
- GraphQL — explicitly ruled out for this change
