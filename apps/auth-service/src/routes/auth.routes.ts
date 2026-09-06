import { errorEnvelope } from '@longeny/errors';
import { rateLimit, requireAuth, requireRole } from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import {
  changePasswordSchema,
  consentSchema,
  forgotPasswordSchema,
  googleAuthSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
} from '@longeny/validators';
import Elysia from 'elysia';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import {
  handleChangePassword,
  handleDeleteSession,
  handleForgotPassword,
  handleGetAuditLog,
  handleGetConsents,
  handleGetSessions,
  handleGoogleAuth,
  handleGrantConsent,
  handleLogin,
  handleLogout,
  handleLogoutAll,
  handleRefresh,
  handleRegister,
  handleResetPassword,
  handleRevokeConsent,
  handleVerifyEmail,
  handleVerifyToken,
} from '../controllers/auth.controller.js';
import { isTokenBlacklisted } from '../services/token.service.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'login',
});

const bearer = { security: [{ BearerAuth: [] }] };

// ── Documentation fragments ──────────────────────────────────────────────────

const CREDENTIAL_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    role: { type: 'string', example: 'user' },
    email_verified: { type: 'boolean' },
    is_active: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const TOKEN_PAYLOAD_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    user: CREDENTIAL_SHAPE,
    accessToken: {
      type: 'string',
      description:
        'Short-lived JWT. Its payload carries `roles` (every role held) and `permissions` — decode it client-side to decide which actions to render.',
    },
    refreshToken: {
      type: 'string',
      description: 'Single-use. Rotating it invalidates the one you sent.',
    },
    expiresIn: { type: 'integer', description: 'Access token lifetime in seconds' },
  },
};

const messageShape = (example: string): OpenApiFragment => ({
  type: 'object',
  properties: { message: { type: 'string', example } },
});

/**
 * Compose a description from literal chunks plus the shared rate-limit note. A
 * single call rather than `'…' + NOTE`, which mixes concatenation with an
 * identifier and is rejected by the lint rules.
 */
const describe = (...parts: string[]): string => parts.join('');

/**
 * The limiter is attached per route (`beforeHandle: loginRateLimit.guard`), so
 * only the three credential-guessing surfaces carry it. Documented on exactly
 * those three rather than blanket-listed, so a client is never told to expect a
 * 429 a route cannot produce.
 */
const RATE_LIMIT_NOTE =
  'Rate limited: **5 requests per 15 minutes per IP**, on one counter shared by ' +
  '`POST /auth/login`, `POST /auth/forgot-password` and `POST /auth/reset-password` — five login ' +
  'attempts and a password-reset request come out of the same budget. No other `/auth` route is ' +
  'limited. Read `X-RateLimit-Remaining` and `X-RateLimit-Reset` (epoch ms) from any response.';

const rateLimited: OpenApiFragment = {
  429: errorDoc(
    'Shared credential rate limit exceeded (5 per 15 minutes per IP, across login / forgot-password / reset-password). `X-RateLimit-Reset` says when it clears.',
    'RATE_LIMITED',
  ),
};

const unauthorized = errorDoc(
  'Missing, malformed, expired or revoked access token',
  'UNAUTHORIZED',
);

const validationError = errorDoc('Request body failed validation', 'VALIDATION_ERROR');

/**
 * Blacklist guard: runs after requireAuth validates the JWT signature.
 * Checks Redis to see if the JTI has been blacklisted (e.g. after logout).
 * Uses { as: 'global' } so the hook propagates through Elysia plugin boundaries.
 */
const requireNotBlacklisted = new Elysia({ name: 'require-not-blacklisted' }).onBeforeHandle(
  { as: 'global' },
  async ({ request, set }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return;

    const token = authHeader.slice(7);
    try {
      const decoded = jwt.decode(token) as { jti?: string; sub?: string; iat?: number } | null;
      if (decoded?.jti) {
        const blacklisted = await isTokenBlacklisted(decoded.jti, decoded.sub, decoded.iat);
        if (blacklisted) {
          set.status = 401;
          return errorEnvelope('TOKEN_REVOKED', 'Token has been revoked');
        }
      }
    } catch {
      // If decode fails, requireAuth already handled it
    }
  },
);

const authRoutes = new Elysia({ prefix: '/auth' })
  // ── Public Endpoints ──
  .post('/register', handleRegister, {
    body: documented(registerSchema),
    detail: {
      tags: ['Auth'],
      summary: 'Register a new user account',
      description:
        'Creates the account and signs the user straight in — the response already contains a ' +
        'usable token pair, so there is no need to call `/auth/login` afterwards. Email ' +
        'verification happens separately and does not block login.\n\n' +
        'This is the one `/auth` route **not** covered by the shared rate limit.',
      requestBody: bodyDoc(registerSchema),
      responses: {
        201: okDoc('Account created and signed in', TOKEN_PAYLOAD_SHAPE),
        400: validationError,
        409: errorDoc('An account with this email already exists', 'CONFLICT'),
      },
    },
  })
  // Applied per route, not with `.use()`: a scoped plugin hook propagates to
  // every route declared after it, which put /sessions, /consents and
  // /audit-log on the same 5-per-15-minutes budget as a login attempt. Only the
  // three credential surfaces below carry it, and only those three document 429.
  .post('/login', handleLogin, {
    beforeHandle: loginRateLimit.guard,
    body: documented(loginSchema),
    detail: {
      tags: ['Auth'],
      summary: 'Log in and get an access + refresh token pair',
      description: describe(
        'Returns the same envelope as register. The access token carries `roles` and ' +
          '`permissions`; a permission granted server-side only appears after the next login ' +
          'or refresh.\n\n',
        RATE_LIMIT_NOTE,
        '\n\nRepeated failures lock the account and answer **423**, not 401 — surface the lock ' +
          'to the user rather than inviting another attempt.',
      ),
      requestBody: bodyDoc(loginSchema),
      responses: {
        200: okDoc('Signed in', TOKEN_PAYLOAD_SHAPE),
        400: validationError,
        401: errorDoc('Invalid email or password, or the account is disabled', 'UNAUTHORIZED'),
        423: errorDoc('Account locked after too many failed attempts', 'ACCOUNT_LOCKED'),
        ...rateLimited,
      },
    },
  })
  .post('/refresh', handleRefresh, {
    body: documented(refreshTokenSchema),
    detail: {
      tags: ['Auth'],
      summary: 'Rotate the refresh token — the old one dies immediately',
      description:
        'Single-use rotation: the refresh token you send is invalidated as the new pair is ' +
        'issued, so never retry a refresh with the same token, and never run two refreshes ' +
        'concurrently. This is also how a user picks up newly granted roles or permissions.',
      requestBody: bodyDoc(refreshTokenSchema),
      responses: {
        200: okDoc('New token pair', {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            expiresIn: { type: 'integer' },
          },
        }),
        400: validationError,
        401: errorDoc('Refresh token is invalid, already used, or revoked', 'INVALID_TOKEN'),
      },
    },
  })
  .post('/logout', handleLogout, {
    detail: {
      tags: ['Auth'],
      summary: 'Log out this device — blacklists the access token',
      description:
        'Send the access token in the `Authorization` header. It is added to a Redis blacklist ' +
        'so it stops working immediately, before its natural expiry. No token, or an ' +
        'unparseable one, is not an error: this always answers 200 so a client can log out ' +
        'defensively. Other devices are unaffected — use `/auth/logout-all` for those.',
      ...bearer,
      responses: {
        200: okDoc('Logged out', messageShape('Logged out successfully')),
      },
    },
  })
  .post('/google', handleGoogleAuth, {
    body: documented(googleAuthSchema),
    detail: {
      tags: ['Auth'],
      summary: 'Sign in or sign up with Google',
      description:
        'Send **either** `idToken` (from Google Sign-In on the client) **or** `code` (from a ' +
        'server-side OAuth redirect). A first-time Google user is created on the spot and the ' +
        'response is **201** with `isNewUser: true`; an existing user gets 200. Use `isNewUser` ' +
        'to decide whether to route into onboarding.',
      requestBody: {
        required: true,
        description: 'Exactly one of `idToken` or `code`',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                idToken: { type: 'string', description: 'Google ID token from client sign-in' },
                code: { type: 'string', description: 'OAuth authorisation code to exchange' },
              },
            },
          },
        },
      },
      responses: {
        200: okDoc('Existing user signed in', {
          ...TOKEN_PAYLOAD_SHAPE,
          properties: {
            ...TOKEN_PAYLOAD_SHAPE.properties,
            isNewUser: { type: 'boolean', example: false },
          },
        }),
        201: okDoc('New account created from the Google profile', {
          ...TOKEN_PAYLOAD_SHAPE,
          properties: {
            ...TOKEN_PAYLOAD_SHAPE.properties,
            isNewUser: { type: 'boolean', example: true },
          },
        }),
        401: errorDoc(
          'Neither `idToken` nor `code` was supplied, or Google rejected it',
          'UNAUTHORIZED',
        ),
      },
    },
  })
  .post('/oauth/google', handleGoogleAuth, {
    detail: {
      tags: ['Auth'],
      summary: 'Sign in with Google (alias of POST /auth/google)',
      description:
        'Identical handler and behaviour to `POST /auth/google`; kept so older clients keep ' +
        'working. Prefer `/auth/google` in new code.',
      requestBody: {
        required: true,
        description: 'Exactly one of `idToken` or `code`',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                idToken: { type: 'string' },
                code: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        200: okDoc('Existing user signed in', TOKEN_PAYLOAD_SHAPE),
        201: okDoc('New account created from the Google profile', TOKEN_PAYLOAD_SHAPE),
        401: errorDoc(
          'Neither `idToken` nor `code` was supplied, or Google rejected it',
          'UNAUTHORIZED',
        ),
      },
    },
  })
  .post('/verify-email', handleVerifyEmail, {
    detail: {
      tags: ['Auth'],
      summary: 'Verify an email address with the token from the email link',
      description:
        'The token comes from the verification email, not from the token pair. Expired and ' +
        'already-used tokens answer 400 alike.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['token'],
              properties: { token: { type: 'string', description: 'Token from the email link' } },
            },
          },
        },
      },
      responses: {
        200: okDoc('Email verified', messageShape('Email verified successfully')),
        400: errorDoc('Verification token is invalid or expired', 'INVALID_TOKEN'),
      },
    },
  })
  .post('/forgot-password', handleForgotPassword, {
    beforeHandle: loginRateLimit.guard,
    body: documented(forgotPasswordSchema),
    detail: {
      tags: ['Auth'],
      summary: 'Send a password-reset email',
      description: describe(
        'Always answers 200 with the same message whether or not the address exists — the ' +
          'response deliberately tells an attacker nothing about which emails are registered. ' +
          'Do not use it to check whether an account exists, and do not phrase the UI as if ' +
          'you knew.\n\n',
        RATE_LIMIT_NOTE,
      ),
      requestBody: bodyDoc(forgotPasswordSchema),
      responses: {
        200: okDoc(
          'Request accepted (sent only if the address exists)',
          messageShape('If the email exists, a reset link has been sent'),
        ),
        400: validationError,
        ...rateLimited,
      },
    },
  })
  .post('/reset-password', handleResetPassword, {
    beforeHandle: loginRateLimit.guard,
    body: documented(resetPasswordSchema),
    detail: {
      tags: ['Auth'],
      summary: 'Complete a password reset',
      description: describe(
        '`token` comes from the reset email. On success **every session for that account is ' +
          'revoked**, on every device — a reset is assumed to follow a compromise, so nothing ' +
          'that was signed in before it stays signed in. The user must log in again with the ' +
          'new password; any client still holding an old access token will start seeing ' +
          '`401 TOKEN_REVOKED`.\n\n',
        RATE_LIMIT_NOTE,
      ),
      requestBody: bodyDoc(resetPasswordSchema),
      responses: {
        200: okDoc(
          'Password reset; all sessions revoked',
          messageShape('Password has been reset successfully'),
        ),
        400: errorDoc(
          'Reset token is invalid or expired, or the new password failed validation',
          'INVALID_TOKEN',
        ),
        ...rateLimited,
      },
    },
  })
  .post('/verify-token', handleVerifyToken, {
    detail: {
      tags: ['Auth'],
      summary: 'Verify and decode an access token',
      description:
        'Introspection helper: pass a token in the body (not the header) and get its payload ' +
        'back if it is valid and not blacklisted. Frontends do not need this — decoding the JWT ' +
        'client-side is enough, and the server re-checks on every real request.\n\n' +
        'Failure shapes are uneven: a **blacklisted** token answers `401 INVALID_TOKEN`, while a ' +
        'token with a bad signature or a past expiry escapes as `500 INTERNAL_ERROR` because the ' +
        'underlying `jsonwebtoken` error is not mapped. Do not treat 500 here as "server ' +
        'broken".',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['token'],
              properties: { token: { type: 'string', description: 'Access token to introspect' } },
            },
          },
        },
      },
      responses: {
        200: okDoc('Token is valid', {
          type: 'object',
          properties: {
            valid: { type: 'boolean', example: true },
            payload: {
              type: 'object',
              properties: {
                sub: { type: 'string', format: 'uuid' },
                email: { type: 'string', format: 'email' },
                role: { type: 'string' },
                permissions: { type: 'array', items: { type: 'string' } },
                iat: { type: 'integer' },
                exp: { type: 'integer' },
              },
            },
          },
        }),
        401: errorDoc('Token has been blacklisted', 'INVALID_TOKEN'),
        500: errorDoc('Token signature or expiry check threw and is not mapped', 'INTERNAL_ERROR'),
      },
    },
  })
  // ── Authenticated Endpoints ──
  .use(requireAuth(config.JWT_ACCESS_SECRET))
  .use(requireNotBlacklisted)
  .post('/logout-all', handleLogoutAll, {
    detail: {
      tags: ['Auth'],
      summary: 'Revoke every session on every device',
      description:
        'Blacklists the calling token *and* sets a per-user invalidation marker, so every access ' +
        'token issued before this moment stops working — including the one that made the call. ' +
        'Expect the next request on the old token to answer `401 TOKEN_REVOKED`; send the user ' +
        'back to login.',
      ...bearer,
      responses: {
        200: okDoc('All sessions revoked', messageShape('All sessions revoked')),
        401: unauthorized,
      },
    },
  })
  .post('/change-password', handleChangePassword, {
    body: documented(changePasswordSchema),
    detail: {
      tags: ['Auth'],
      summary: 'Change password (revokes every session, including this one)',
      description:
        'Requires the current password as proof of possession, so a stolen access token alone ' +
        'cannot change it.\n\n' +
        '**Every session for the account is revoked on success — the caller’s included.** ' +
        'The token that made this request stops working immediately, so treat a 200 here as a ' +
        'logout: clear stored tokens and send the user to login with the new password. Any ' +
        'request made with the old token afterwards answers `401 TOKEN_REVOKED`.',
      ...bearer,
      responses: {
        200: okDoc(
          'Password changed; all sessions revoked including the caller’s',
          messageShape('Password changed successfully'),
        ),
        400: validationError,
        401: errorDoc(
          'The current password is wrong, or the access token is missing/revoked',
          'UNAUTHORIZED',
        ),
        404: errorDoc('The credential behind this token no longer exists', 'NOT_FOUND'),
      },
    },
  })
  .get('/sessions', handleGetSessions, {
    detail: {
      tags: ['Sessions'],
      summary: 'List active sessions across devices',
      description:
        'One row per device that is currently signed in, for a "where am I logged in" screen. ' +
        'Sessions revoked by logout, a role change, a password change or a reset do not appear.',
      ...bearer,
      responses: {
        200: okDoc('Active sessions, newest first', {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              ip_address: { type: 'string', nullable: true },
              user_agent: { type: 'string', nullable: true },
              created_at: { type: 'string', format: 'date-time' },
              expires_at: { type: 'string', format: 'date-time', nullable: true },
            },
          },
        }),
        401: unauthorized,
      },
    },
  })
  .delete('/sessions/:id', handleDeleteSession, {
    detail: {
      tags: ['Sessions'],
      summary: 'Revoke one session by id',
      description:
        'Signs one other device out. The revoke is scoped to the caller’s own sessions, so a ' +
        'session id belonging to somebody else simply matches nothing.\n\n' +
        'It answers **200 whether or not the id existed** — there is no 404 here — so do not use ' +
        'the response to confirm a session was real. Re-fetch `/auth/sessions` to show the ' +
        'result.',
      ...bearer,
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Session id from `GET /auth/sessions`',
        },
      ],
      responses: {
        200: okDoc('Session revoked, or no such session of yours', messageShape('Session revoked')),
        401: unauthorized,
      },
    },
  })
  .get('/consents', handleGetConsents, {
    detail: {
      tags: ['Consents'],
      summary: 'List the caller’s consent records',
      description:
        'Current state of each GDPR consent the account has ever granted or revoked, with the ' +
        'document version it was given against.',
      ...bearer,
      responses: {
        200: okDoc('Consent records', {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              consent_type: { type: 'string' },
              granted: { type: 'boolean' },
              version: { type: 'string', example: '1.0' },
              granted_at: { type: 'string', format: 'date-time', nullable: true },
              revoked_at: { type: 'string', format: 'date-time', nullable: true },
            },
          },
        }),
        401: unauthorized,
      },
    },
  })
  .post('/consents', handleGrantConsent, {
    body: documented(consentSchema),
    detail: {
      tags: ['Consents'],
      summary: 'Grant a consent',
      description:
        'Records consent against a document `version`, together with the caller’s IP and user ' +
        'agent, because a consent record has to be defensible later. Granting a type that is ' +
        'already granted re-records it at the new version rather than failing.\n\n' +
        'The `granted` field in the body is part of the schema but this route always records a ' +
        'grant — use `DELETE /auth/consents/{type}` to withdraw one.',
      ...bearer,
      requestBody: bodyDoc(consentSchema),
      responses: {
        201: okDoc('Consent recorded', {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            consent_type: { type: 'string' },
            granted: { type: 'boolean', example: true },
            version: { type: 'string' },
            granted_at: { type: 'string', format: 'date-time' },
          },
        }),
        400: errorDoc(
          'Validation failed, or the consent type is not recognised',
          'VALIDATION_ERROR',
        ),
        401: unauthorized,
      },
    },
  })
  .delete('/consents/:type', handleRevokeConsent, {
    detail: {
      tags: ['Consents'],
      summary: 'Withdraw a consent',
      description:
        'Revoking a consent the account never granted answers 404. Withdrawal is recorded and ' +
        'published to the other services, which stop the corresponding processing.',
      ...bearer,
      parameters: [
        {
          name: 'type',
          in: 'path',
          required: true,
          schema: {
            type: 'string',
            enum: [
              'terms_of_service',
              'privacy_policy',
              'health_data_processing',
              'ai_profiling',
              'data_sharing_providers',
              'marketing_email',
              'marketing_sms',
            ],
          },
          description: 'Consent type to withdraw',
        },
      ],
      responses: {
        200: okDoc('Consent withdrawn', {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            consent_type: { type: 'string' },
            granted: { type: 'boolean', example: false },
            revoked_at: { type: 'string', format: 'date-time' },
          },
        }),
        401: unauthorized,
        404: errorDoc('No such consent on this account', 'NOT_FOUND'),
      },
    },
  })
  // ── Admin Endpoints ──
  .use(requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN))
  .get('/audit-log', handleGetAuditLog, {
    detail: {
      tags: ['Admin'],
      summary: 'Query the security audit log (admin only)',
      description:
        'Every authentication and RBAC event, refusals included — a denied role change leaves a ' +
        'row just as a successful one does. Admin or super_admin role required; there is no ' +
        'permission check beyond the role. `limit` is capped at 100 server-side.',
      ...bearer,
      parameters: [
        {
          name: 'page',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, default: 1 },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          description: 'Capped at 100',
        },
        {
          name: 'event_type',
          in: 'query',
          required: false,
          schema: { type: 'string', example: 'rbac.user.roles.changed' },
        },
        {
          name: 'credential_id',
          in: 'query',
          required: false,
          schema: { type: 'string', format: 'uuid' },
          description: 'Filter to one actor',
        },
        {
          name: 'start_date',
          in: 'query',
          required: false,
          schema: { type: 'string', format: 'date-time' },
        },
        {
          name: 'end_date',
          in: 'query',
          required: false,
          schema: { type: 'string', format: 'date-time' },
        },
      ],
      responses: {
        200: {
          description: 'Page of audit rows (pagination is under `meta`, not top level)',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        credential_id: { type: 'string', format: 'uuid', nullable: true },
                        event_type: { type: 'string' },
                        action: { type: 'string', nullable: true },
                        result: { type: 'string', enum: ['success', 'denied', 'failure'] },
                        ip_address: { type: 'string', nullable: true },
                        resource_type: { type: 'string', nullable: true },
                        resource_id: { type: 'string', nullable: true },
                        metadata: { type: 'object', additionalProperties: true, nullable: true },
                        created_at: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                  meta: {
                    type: 'object',
                    properties: {
                      timestamp: { type: 'string', format: 'date-time' },
                      pagination: {
                        type: 'object',
                        properties: {
                          page: { type: 'integer' },
                          limit: { type: 'integer' },
                          total: { type: 'integer' },
                          totalPages: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: unauthorized,
        403: errorDoc('Caller is not admin or super_admin', 'FORBIDDEN'),
      },
    },
  });

export default authRoutes;
