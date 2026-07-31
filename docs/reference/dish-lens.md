# DishLens API

Base URL: `https://dish-lens-production.up.railway.app`

All routes except `/health` and the public auth routes require a JWT access token:

```
Authorization: Bearer <accessToken>
```

Error responses always use the shape `{ "error": { "code": string, "message": string } }`.

---

## Auth

### `POST /auth/register`

Create a new account. Automatically sends a verification email via Resend.

**Body**

```json
{ "email": "user@example.com", "password": "password123" }
```

Password must be 8–72 characters.

**201 Created**

```json
{ "accessToken": "eyJ...", "refreshToken": "eyJ..." }
```

**409 Conflict** — `email-in-use`

---

### `POST /auth/login`

**Body**

```json
{ "email": "user@example.com", "password": "password123" }
```

**200 OK**

```json
{ "accessToken": "eyJ...", "refreshToken": "eyJ..." }
```

**401 Unauthorized** — `invalid-credentials` (same response for unknown email and wrong password — no enumeration)

---

### `POST /auth/refresh`

Rotate a refresh token. The submitted token is revoked and a new pair is issued. Reusing an already-rotated token returns 401.

**Body**

```json
{ "refreshToken": "eyJ..." }
```

**200 OK**

```json
{ "accessToken": "eyJ...", "refreshToken": "eyJ..." }
```

**401 Unauthorized** — `invalid-refresh-token`

---

### `POST /auth/logout`

Revoke a refresh token. Always returns 204 regardless of whether the token was valid.

**Body**

```json
{ "refreshToken": "eyJ..." }
```

**204 No Content**

---

### `POST /auth/verify-email`

Consume the token from the verification email.

**Body**

```json
{ "token": "<raw token from email link>" }
```

**200 OK** — `{ "message": "Email verified." }`

**400 Bad Request** — `invalid-token` | `expired-token` | `already-verified`

---

### `POST /auth/resend-verification`

Re-send the verification email. Requires authentication.

**200 OK** — `{ "message": "Verification email sent if the address is unverified." }`

---

### `POST /auth/send-otp`

Send a 6-digit one-time login code. Always returns 200 — no enumeration of registered emails.

**Body**

```json
{ "email": "user@example.com" }
```

**200 OK** — `{ "message": "If an account exists for this email, a login code has been sent." }`

---

### `POST /auth/verify-otp`

Exchange a 6-digit OTP for a token pair. OTPs expire after 10 minutes and are single-use.

**Body**

```json
{ "email": "user@example.com", "code": "482910" }
```

**200 OK**

```json
{ "accessToken": "eyJ...", "refreshToken": "eyJ..." }
```

**401 Unauthorized** — `invalid-otp`

---

### `POST /auth/forgot-password`

Send a password reset link. Always returns 200.

**Body**

```json
{ "email": "user@example.com" }
```

**200 OK** — `{ "message": "If an account exists for this email, a reset link has been sent." }`

---

### `POST /auth/reset-password`

Set a new password using the token from the reset email. Tokens expire after 1 hour and are single-use.

**Body**

```json
{ "token": "<raw token from reset link>", "password": "newpassword123" }
```

**200 OK** — `{ "message": "Password reset successfully." }`

**400 Bad Request** — `invalid-token` | `expired-token`

---

## Upload

### `POST /upload` 🔒

Analyse a dish photo. Returns recipe, nutritional data, and a conversational message.

**Content-Type:** `multipart/form-data`

| Field   | Type | Description                              |
| ------- | ---- | ---------------------------------------- |
| `image` | file | JPEG or PNG, max 20 MB, max 8192×8192 px |

**200 OK**

```json
{
  "dishName": "Pad Thai",
  "recipe": {
    "ingredients": ["200g rice noodles", "..."],
    "steps": ["..."]
  },
  "nutrition": {
    "calories": 520,
    "protein": 22,
    "carbs": 68,
    "fat": 14
  },
  "message": "This looks like Pad Thai! Here's a recipe..."
}
```

**400 Bad Request** — `no-image` | `invalid-image-type` | `image-too-large` | `image-too-large-dimensions` | `blurry-image`

**422 Unprocessable Entity** — `not-food` (image passed upload checks but Vision didn't detect a dish)

---

## Chat history

### `GET /chats` 🔒

List all saved chat sessions for the authenticated user, newest first.

**200 OK**

```json
{
  "chats": [
    { "id": "uuid", "dishName": "Pad Thai", "createdAt": "2026-07-31T..." },
    ...
  ]
}
```

---

### `GET /chats/:chatId` 🔒

Get a single saved chat with full message history.

**200 OK**

```json
{
  "chat": {
    "id": "uuid",
    "dishName": "Pad Thai",
    "messages": [
      { "role": "user", "content": "..." },
      { "role": "assistant", "content": "..." }
    ],
    "createdAt": "2026-07-31T..."
  }
}
```

**404 Not Found** — `not-found`

---

## Meal planning

### `POST /meal-plans` 🔒

**Body**

```json
{ "name": "Week of 4 Aug" }
```

**201 Created**

```json
{
  "plan": {
    "id": "uuid",
    "name": "Week of 4 Aug",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

### `GET /meal-plans` 🔒

**200 OK**

```json
{
  "plans": [
    {
      "id": "uuid",
      "name": "Week of 4 Aug",
      "entryCount": 7,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

### `GET /meal-plans/:planId` 🔒

**200 OK**

```json
{
  "plan": {
    "id": "uuid",
    "name": "Week of 4 Aug",
    "entries": [
      {
        "id": "uuid",
        "date": "2026-08-04",
        "mealType": "LUNCH",
        "dishName": "Pad Thai",
        "notes": null,
        "createdAt": "..."
      }
    ],
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

### `DELETE /meal-plans/:planId` 🔒

Deletes the plan and all its entries (cascade).

**204 No Content**

---

### `POST /meal-plans/:planId/entries` 🔒

**Body**

```json
{
  "date": "2026-08-04",
  "mealType": "LUNCH",
  "dishName": "Pad Thai",
  "notes": "Optional note"
}
```

`mealType` must be one of `BREAKFAST`, `LUNCH`, `DINNER`, `SNACK`.

**201 Created** — `{ "entry": { ... } }`

---

### `DELETE /meal-plans/:planId/entries/:entryId` 🔒

**204 No Content**

---

## Health

### `GET /health`

**200 OK** — `{ "status": "ok" }`
