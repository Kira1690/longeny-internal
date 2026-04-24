# Auth Service — API Reference

Base URL: `http://localhost:3011`

## Authentication

Protected endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

Access tokens expire in **15 minutes**. Use the refresh token to get a new one.

---

## Public Endpoints

### POST `/auth/register`

Create a new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "MyPass@123",
  "firstName": "Rahul",
  "lastName": "Sharma"
}
```

**Password rules:**
- 8–128 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 number
- At least 1 special character

**Response (201):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "status": "pending_verification",
      "emailVerified": false,
      "firstName": "Rahul",
      "lastName": "Sharma"
    },
    "accessToken": "eyJhbG...",
    "refreshToken": "a1b2c3...",
    "expiresIn": 900
  },
  "meta": { "timestamp": "2026-04-09T..." }
}
```

**Errors:**
- `409` — Email already exists

---

### POST `/auth/login`

Login with email and password. Rate limited to **5 attempts per 15 minutes**.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "MyPass@123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "status": "pending_verification",
      "emailVerified": false,
      "role": "user"
    },
    "accessToken": "eyJhbG...",
    "refreshToken": "a1b2c3...",
    "expiresIn": 900
  },
  "meta": { "timestamp": "..." }
}
```

**Errors:**
- `401` — Invalid email or password
- `423` — Account locked (after 5 failed attempts, locked for 15 minutes)
- `429` — Rate limited

---

### POST `/auth/refresh`

Exchange a refresh token for new access + refresh tokens. The old refresh token is invalidated (rotation).

**Request:**
```json
{
  "refreshToken": "a1b2c3..."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbG...",
    "refreshToken": "d4e5f6...",
    "expiresIn": 900
  },
  "meta": { "timestamp": "..." }
}
```

**Security:**
- If an old/used refresh token is submitted (reuse detection), **ALL sessions for that user are revoked** as a security measure. The user must log in again.

---

### POST `/auth/logout`

Blacklists the current access token. No body required — reads the token from the `Authorization` header.

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Logged out successfully" },
  "meta": { "timestamp": "..." }
}
```

---

### POST `/auth/google`

Authenticate via Google OAuth. Accepts either an ID token or an authorization code.

**Request (ID Token):**
```json
{
  "idToken": "google-id-token"
}
```

**Request (Auth Code):**
```json
{
  "code": "google-auth-code"
}
```

**Response:** Same format as `/auth/register`, with additional `isNewUser: true|false`.

---

### POST `/auth/verify-email`

Verify email address using the token sent via email.

**Request:**
```json
{
  "token": "email-verification-token"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Email verified successfully" },
  "meta": { "timestamp": "..." }
}
```

---

### POST `/auth/forgot-password`

Request a password reset email. Always returns success (prevents email enumeration).

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "If the email exists, a reset link has been sent" },
  "meta": { "timestamp": "..." }
}
```

---

### POST `/auth/reset-password`

Reset password using the token from the email.

**Request:**
```json
{
  "token": "reset-token-from-email",
  "password": "NewPass@123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Password has been reset successfully" },
  "meta": { "timestamp": "..." }
}
```

---

### POST `/auth/verify-token`

Verify if an access token is valid and get its payload. Useful for frontend session checking.

**Request:**
```json
{
  "token": "eyJhbG..."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "payload": {
      "sub": "user-uuid",
      "email": "user@example.com",
      "role": "user",
      "permissions": ["users:read", "users:write", "bookings:read", ...],
      "iat": 1775734470,
      "exp": 1775735370
    }
  },
  "meta": { "timestamp": "..." }
}
```

---

## Authenticated Endpoints

All endpoints below require: `Authorization: Bearer <access_token>`

### POST `/auth/logout-all`

Revoke all active sessions for the current user.

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "All sessions revoked" },
  "meta": { "timestamp": "..." }
}
```

---

### POST `/auth/change-password`

Change password for the authenticated user.

**Request:**
```json
{
  "currentPassword": "OldPass@123",
  "newPassword": "NewPass@456"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Password changed successfully" },
  "meta": { "timestamp": "..." }
}
```

---

### GET `/auth/sessions`

List all active sessions for the current user.

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "session-uuid",
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0...",
      "last_used_at": "2026-04-09T...",
      "created_at": "2026-04-09T...",
      "expires_at": "2026-04-16T..."
    }
  ],
  "meta": { "timestamp": "..." }
}
```

---

### DELETE `/auth/sessions/:id`

Revoke a specific session by ID (e.g., "sign out from another device").

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Session revoked" },
  "meta": { "timestamp": "..." }
}
```

---

### GET `/auth/consents`

List all GDPR consents for the current user.

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "consent-uuid",
      "credential_id": "user-uuid",
      "consent_type": "terms_of_service",
      "version": "1.0",
      "granted": true,
      "granted_at": "2026-04-09T...",
      "revoked_at": null,
      "expires_at": null
    }
  ],
  "meta": { "timestamp": "..." }
}
```

---

### POST `/auth/consents`

Grant a GDPR consent.

**Request:**
```json
{
  "consentType": "terms_of_service",
  "granted": true,
  "version": "1.0"
}
```

**Valid consent types:**
- `terms_of_service`
- `privacy_policy`
- `health_data_processing`
- `ai_profiling`
- `data_sharing_providers`
- `marketing_email`
- `marketing_sms`

**Response (201):** Returns the created consent object.

---

### DELETE `/auth/consents/:type`

Revoke a specific consent (e.g., `/auth/consents/marketing_email`).

**Response (200):** Returns the updated consent object with `granted: false` and `revoked_at` set.

---

## Admin Endpoints

Require: `Authorization: Bearer <admin_token>` (user must have `admin` role)

### GET `/auth/audit-log`

Query the audit log with optional filters.

**Query parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 50 | Items per page (max 100) |
| `event_type` | string | — | Filter by event type |
| `credential_id` | uuid | — | Filter by user |
| `start_date` | ISO date | — | Filter from date |
| `end_date` | ISO date | — | Filter to date |

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "log-uuid",
      "credential_id": "user-uuid",
      "event_type": "user.login",
      "user_email": "user@example.com",
      "user_role": "user",
      "action": "login",
      "result": "success",
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0...",
      "purpose": "authentication",
      "hash": "abc123...",
      "previous_hash": "def456...",
      "created_at": "2026-04-09T..."
    }
  ],
  "meta": {
    "timestamp": "...",
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 27,
      "totalPages": 1
    }
  }
}
```

**Audit event types:**
- `user.registered`
- `user.login`
- `user.login.failed`
- `user.login.locked`
- `user.password.changed`
- `user.password.reset.requested`
- `consent.granted`
- `consent.revoked`

---

## RBAC Admin Endpoints

All require admin role.

### GET `/auth/roles`
List all roles.

### POST `/auth/roles`
Create a new role.

### GET `/auth/roles/:id/permissions`
Get permissions for a role.

### PUT `/auth/roles/:id/permissions`
Update permissions for a role.

### GET `/auth/users/:userId/roles`
Get roles assigned to a user.

### PUT `/auth/users/:userId/roles`
Assign roles to a user.
