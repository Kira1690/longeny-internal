# Error Handling — Frontend Guide

## Standard Error Response Format

Every error follows this structure:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  },
  "meta": {
    "timestamp": "2026-04-09T...",
    "requestId": "correlation-id"
  }
}
```

## Validation Error Format

When request body fails Zod validation:

```json
{
  "type": "validation",
  "on": "body",
  "property": "password",
  "message": "Must contain special character",
  "found": { "email": "test@test.com", "password": "weak" },
  "errors": [
    {
      "code": "too_small",
      "path": ["password"],
      "message": "String must contain at least 8 character(s)"
    },
    {
      "code": "invalid_string",
      "path": ["password"],
      "message": "Must contain special character"
    }
  ]
}
```

## Error Codes Reference

### Authentication Errors

| HTTP | Code | Message | Frontend Action |
|------|------|---------|-----------------|
| 401 | `UNAUTHORIZED` | Missing or invalid Authorization header | Redirect to login |
| 401 | `TOKEN_EXPIRED` | Token has expired | Call `/auth/refresh` |
| 401 | `INVALID_TOKEN` | Invalid token | Clear tokens, redirect to login |
| 401 | — | Invalid email or password | Show login error |
| 423 | — | Account is locked due to too many failed attempts | Show "Account locked. Try again in 15 minutes." |

### Authorization Errors

| HTTP | Code | Message | Frontend Action |
|------|------|---------|-----------------|
| 403 | `FORBIDDEN` | Requires one of roles: admin | Show "Access denied" or hide the UI element |

### Conflict Errors

| HTTP | Code | Message | Frontend Action |
|------|------|---------|-----------------|
| 409 | — | An account with this email already exists | Show inline form error |

### Rate Limiting

| HTTP | Code | Message | Frontend Action |
|------|------|---------|-----------------|
| 429 | `TOO_MANY_REQUESTS` | Rate limit exceeded | Show "Too many attempts. Please wait." |

### Validation Errors

| HTTP | Code | Message | Frontend Action |
|------|------|---------|-----------------|
| 422 | `validation` | Varies per field | Parse `errors[]` array and show inline |

## Frontend Error Handler Example

```typescript
interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: {
    timestamp: string;
    requestId: string;
  };
}

interface ValidationError {
  type: 'validation';
  on: string;
  property: string;
  message: string;
  errors: Array<{
    code: string;
    path: string[];
    message: string;
  }>;
}

function handleApiError(error: unknown) {
  if (!axios.isAxiosError(error) || !error.response) {
    // Network error
    toast.error('Network error. Check your connection.');
    return;
  }

  const { status, data } = error.response;

  // Validation error
  if (data?.type === 'validation') {
    const validationError = data as ValidationError;
    const fieldErrors: Record<string, string> = {};
    for (const err of validationError.errors) {
      const field = err.path.join('.');
      fieldErrors[field] = err.message;
    }
    return fieldErrors; // Use with react-hook-form setError()
  }

  // Auth errors
  switch (status) {
    case 401:
      if (data?.error?.code === 'TOKEN_EXPIRED') {
        // Handled by interceptor — should not reach here
        return;
      }
      toast.error(data?.error?.message || 'Authentication failed');
      break;
    case 403:
      toast.error('You do not have permission to perform this action.');
      break;
    case 409:
      toast.error(data?.error?.message || 'Resource already exists');
      break;
    case 423:
      toast.error('Account locked. Please try again in 15 minutes.');
      break;
    case 429:
      toast.error('Too many requests. Please wait before trying again.');
      break;
    default:
      toast.error('Something went wrong. Please try again.');
  }
}
```

## Response Headers

Every response includes:

| Header | Description |
|--------|-------------|
| `X-Correlation-ID` | Unique request ID for debugging. Include in bug reports. |
| `Access-Control-Allow-Origin` | CORS origin (`http://localhost:5173`) |
| `Access-Control-Allow-Credentials` | `true` — cookies are allowed |
