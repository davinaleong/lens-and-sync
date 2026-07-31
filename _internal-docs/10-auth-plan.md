# dish-lens Auth Implementation — Milestone Checklist

## M1 — Schema

- [ ] Add `passwordHash String` to `User` in `packages/shared-db/prisma/schema.prisma`
- [ ] Start local Postgres: `docker-compose -f infra/docker-compose.yml up -d postgres redis`
- [ ] Generate migration: `pnpm --filter @lens-and-sync/shared-db run migrate` (do not hand-write SQL)

## M2 — Token signing in shared-auth

- [ ] `packages/shared-auth/src/sign.ts`: `signToken(userId, secret, ttl)` → `jwt.sign({ sub: userId }, secret, { expiresIn: ttl })`
  - [ ] One generic function used for both access and refresh tokens (different secret/TTL args)
- [ ] Export `signToken` from `packages/shared-auth/src/index.ts`
- [ ] `packages/shared-auth/tests/sign.test.ts`: sign → verify round-trip via existing `verifyAccessToken`, mirroring `verify.test.ts` style
- [ ] Confirm no new `verifyRefreshToken` was added — refresh tokens verify via existing `verifyAccessToken(token, JWT_REFRESH_SECRET)`

## M3 — Password hashing (app-local)

- [ ] Add `bcryptjs` + `@types/bcryptjs` to `apps/dish-lens/package.json`
- [ ] `apps/dish-lens/src/auth/hash.ts`: `hashPassword` / `verifyPassword` wrappers over `bcryptjs`
- [ ] Zod password schema capped at `.max(72)` (bcrypt silent-truncation guard), min 8

## M4 — Auth service layer

- [ ] `apps/dish-lens/src/auth/service.ts` with:
  - [ ] `registerUser`
  - [ ] `loginUser`
  - [ ] `refreshTokens`
  - [ ] `revokeRefreshToken`
- [ ] Uses `prisma` from `@lens-and-sync/shared-db`, hashing from M3, `signToken` from M2
- [ ] Returns discriminated `{ ok: true, ... } | { ok: false, reason }` (matches `verify.ts` style) — no throwing on expected failures
- [ ] Refresh flow implemented in order: verify JWT sig+expiry → look up `sha256(token)` in `RefreshToken.tokenHash` → confirm `revokedAt IS NULL` → revoke old row → insert new row → issue new access+refresh pair
- [ ] Login failure (unknown email or bad password) collapses to one generic reason (no enumeration signal)

## M5 — Routes

- [ ] `apps/dish-lens/src/routes/auth.ts` (`authRouter`), following `history.ts`/`upload.ts` conventions:
  - [ ] Zod schemas at top, `.safeParse` inline per route
  - [ ] try/catch + `next(err)` per route
  - [ ] Router-scoped trailing `ErrorRequestHandler`
  - [ ] `{ error: { code, message } }` shape on every failure
- [ ] `POST /auth/register` → 201 `{ accessToken, refreshToken }`; 409 `email-in-use`
- [ ] `POST /auth/login` → 200 `{ accessToken, refreshToken }`; 401 `invalid-credentials`
- [ ] `POST /auth/refresh` → 200 rotated `{ accessToken, refreshToken }`; 401 `invalid-refresh-token`
- [ ] `POST /auth/logout` → 204, revokes given refresh token

## M6 — Logging

- [ ] `packages/shared-logger/src/index.ts`: add `"auth-failed"` to `SecurityEventType` (kept distinct from `"auth-rejected"`)
- [ ] `logSecurityEvent` called on every 4xx path in `auth.ts` (same pattern as `upload.ts`)

## M7 — Wiring

- [ ] `apps/dish-lens/src/index.ts`: `app.use("/auth", authRouter)` mounted alongside `/upload`/`/chats`, before `notFoundHandler()`

## M8 — Tests

- [ ] `apps/dish-lens/src/auth/service.test.ts` (vitest, hand-rolled mocks, `vi.mock("@lens-and-sync/shared-db")`, no supertest)
  - [ ] register: success, duplicate-email
  - [ ] login: success, wrong-password, unknown-email
  - [ ] refresh: success, expired, revoked, reused-after-rotation
  - [ ] logout: revokes token
- [ ] `pnpm --filter @lens-and-sync/dish-lens run typecheck && run test` passes

## M9 — Local end-to-end verification

- [ ] `pnpm --filter @lens-and-sync/dish-lens run dev`
- [ ] curl `register` → `login` → `refresh` (confirm new token pair differs, old refresh token now rejected) → `logout`
- [ ] Subsequent `/chats` call with issued access token returns real data (not 401)

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
