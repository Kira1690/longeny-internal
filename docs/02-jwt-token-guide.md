# JWT Token & Session Management — Frontend Guide

## Token Types

| Token | Lifetime | Storage | Purpose |
|-------|----------|---------|---------|
| Access Token | 15 minutes | Memory (state/context) | API authentication |
| Refresh Token | 7 days | `httpOnly` cookie or secure storage | Get new access token |

## Access Token (JWT) Payload

```json
{
  "sub": "4f3d262f-f1b9-4c38-b4f0-ae77ce4c00ce",
  "email": "user@example.com",
  "role": "user",
  "permissions": [
    "users:read",
    "users:write",
    "bookings:read",
    "bookings:write",
    "bookings:cancel",
    "payments:read",
    "payments:write",
    "providers:read",
    "documents:read",
    "documents:write",
    "documents:share"
  ],
  "jti": "unique-token-id",
  "iat": 1775734470,
  "exp": 1775735370
}
```

### Decoding the Token (Frontend)

```typescript
// No library needed — just base64 decode the payload
function decodeToken(token: string) {
  const payload = token.split('.')[1];
  return JSON.parse(atob(payload));
}

const user = decodeToken(accessToken);
console.log(user.sub);         // user ID
console.log(user.email);       // email
console.log(user.role);        // "user" | "provider" | "admin"
console.log(user.permissions); // string[]
console.log(user.exp);         // expiry timestamp (seconds)
```

### Checking Token Expiry

```typescript
function isTokenExpired(token: string): boolean {
  const { exp } = decodeToken(token);
  return Date.now() >= exp * 1000;
}
```

## Roles & Permissions

### Roles

| Role | Description |
|------|-------------|
| `user` | Patient / consumer — browse, book, pay |
| `provider` | Doctor / practitioner — manage practice, programs, availability |
| `admin` | Platform owner — full access, user management, analytics |

### User Permissions (11)

```
users:read, users:write,
bookings:read, bookings:write, bookings:cancel,
payments:read, payments:write,
providers:read,
documents:read, documents:write, documents:share
```

### Provider Permissions (16)

All user permissions plus:
```
providers:write,
bookings:manage,
ai:recommendations, ai:content
```

### Admin Permissions (20)

All permissions including:
```
admin:users, admin:providers, admin:analytics,
admin:moderation, admin:settings
```

### Permission Check (Frontend)

```typescript
function hasPermission(token: string, permission: string): boolean {
  const { permissions } = decodeToken(token);
  return permissions.includes(permission);
}

// Usage
if (hasPermission(token, 'bookings:write')) {
  // Show booking button
}

if (hasPermission(token, 'admin:users')) {
  // Show admin panel
}
```

## Token Refresh Flow

```
┌──────────┐                    ┌──────────────┐
│ Frontend │                    │ Auth Service  │
└────┬─────┘                    └──────┬───────┘
     │                                 │
     │  API call with expired token    │
     │────────────────────────────────>│
     │  401 TOKEN_EXPIRED              │
     │<────────────────────────────────│
     │                                 │
     │  POST /auth/refresh             │
     │  { refreshToken: "..." }        │
     │────────────────────────────────>│
     │  200 { accessToken, refresh }   │
     │<────────────────────────────────│
     │                                 │
     │  Retry original API call        │
     │────────────────────────────────>│
     │  200 Success                    │
     │<────────────────────────────────│
```

### React Example — Axios Interceptor

```typescript
import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:3011' });

let accessToken = '';
let refreshToken = '';

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
}

// Attach token to every request
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    if (error.response?.status === 401 && !original._retry && refreshToken) {
      original._retry = true;

      try {
        const { data } = await axios.post('http://localhost:3011/auth/refresh', {
          refreshToken,
        });

        accessToken = data.data.accessToken;
        refreshToken = data.data.refreshToken;
        original.headers.Authorization = `Bearer ${accessToken}`;

        return api(original);
      } catch {
        // Refresh failed — redirect to login
        accessToken = '';
        refreshToken = '';
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;
```

## Security — Token Reuse Detection

If someone tries to reuse an old refresh token (e.g., a stolen token):

1. **All sessions for that user are immediately revoked**
2. The user must log in again from scratch
3. This is logged as a security event in the audit log

Frontend should handle this gracefully:

```typescript
// If refresh fails with "Token reuse detected" message
// → Clear all local auth state
// → Redirect to login
// → Show: "Your session was terminated for security reasons. Please log in again."
```

## Recommended Storage

| Platform | Access Token | Refresh Token |
|----------|-------------|---------------|
| React (Web) | React state / Context | `httpOnly` cookie (ideal) or `localStorage` |
| React Native | Zustand/Redux state | `expo-secure-store` |
| Next.js | Server-side session | `httpOnly` cookie via API route |

**Never store access tokens in `localStorage`** — they contain user permissions and are readable by XSS attacks. Keep them in memory only.
