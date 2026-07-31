# Shared packages

Six packages under `packages/` eliminate duplication between DishLens and DriveSync. All are internal workspace packages — not published to npm.

## shared-auth

**`@lens-and-sync/shared-auth`**

JWT sign/verify and Express authentication middleware.

### Exports

```ts
// Sign a JWT (access or refresh — differentiated by secret + TTL args)
signToken(userId: string, secret: string, ttl: string): string

// Verify a token; returns { ok: true, userId } or { ok: false, reason }
verifyAccessToken(token: string, secret: string): VerifyResult

// Express middleware — attaches req.userId on success, returns 401 on failure
requireAuth(secret: string, logger: Logger): RequestHandler
```

### `AuthenticatedRequest`

Routes that use `requireAuth` can type `req` as `AuthenticatedRequest` to access `req.userId`.

---

## shared-config

**`@lens-and-sync/shared-config`**

Environment variable loading with Zod schema validation. Throws at startup if any required var is missing or invalid — fail-fast before accepting traffic.

### Exports

```ts
// Parse process.env through a Zod schema; throws on validation failure
loadEnv<Schema extends ZodTypeAny>(schema: Schema, source?: NodeJS.ProcessEnv): z.infer<Schema>

// Zod schema: parses comma-separated string → string[]
commaSeparated: ZodEffects<ZodString, string[]>

// Zod schema: parses JSON object from env var string.
// Accepts plain JSON, quote-wrapped JSON (Railway/Docker), or base64-encoded JSON.
jsonObject: ZodEffects<ZodString, Record<string, unknown>>

// Zod schemas for common env var shapes
nodeEnvSchema: ZodEnum<["development", "test", "production"]>
logLevelSchema: ZodEnum<["fatal", "error", "warn", "info", "debug", "trace"]>
```

---

## shared-db

**`@lens-and-sync/shared-db`**

Prisma client and schema. Re-exports everything from `@prisma/client` so consumers don't need to install it directly.

### Models

| Model               | Owner      | Description                                                    |
| ------------------- | ---------- | -------------------------------------------------------------- |
| `User`              | DishLens  | Registered users (email + bcrypt passwordHash + emailVerified) |
| `RefreshToken`      | DishLens  | Active refresh tokens (stored as sha256 hash)                  |
| `VerificationToken` | DishLens  | Email verification, OTP, and password reset tokens             |
| `SavedChat`         | DishLens  | Write-once chat history records                                |
| `MealPlan`          | DishLens  | Named meal plans                                               |
| `MealEntry`         | DishLens  | Individual meals within a plan                                 |
| `DriveFile`         | DriveSync | Sync state for each indexed Drive file                         |

### Usage

```ts
import { prisma, type User } from "@lens-and-sync/shared-db";

const user = await prisma.user.findUnique({ where: { email } });
```

### Migrations

Migrations are in `packages/shared-db/prisma/migrations/`. Run with:

```sh
pnpm db:migrate          # dev (creates new migration)
pnpm db:generate         # regenerate client only
```

---

## shared-logger

**`@lens-and-sync/shared-logger`**

Pino-based structured logger factory with security event helpers.

### Exports

```ts
// Create a Pino logger with the given name and level
createLogger(name: string, level: string): Logger

// Log a security-relevant event (auth failures, rate limits, etc.)
logSecurityEvent(logger: Logger, event: SecurityEvent): void
```

### Security event types

`"auth-failed"` | `"auth-rejected"` | `"rate-limited"` | `"upload-rejected"`

---

## shared-types

**`@lens-and-sync/shared-types`**

Shared TypeScript types used across services. Currently houses the cross-service type contracts.

---

## shared-utils

**`@lens-and-sync/shared-utils`**

Reusable Express middleware.

### Exports

```ts
// Redirect HTTP → HTTPS in production
enforceHttps(nodeEnv: string): RequestHandler

// 404 handler — returns { error: { code: "not-found", message: "..." } }
notFoundHandler(): RequestHandler

// Fallback error handler — logs + returns 500
createFallbackErrorHandler(logger: Logger): ErrorRequestHandler
```
