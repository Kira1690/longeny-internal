import Elysia from 'elysia';
import { requireAuth, requireRole, rateLimit } from '@longeny/middleware';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  consentSchema,
} from '@longeny/validators';
import {
  handleRegister,
  handleLogin,
  handleRefresh,
  handleLogout,
  handleLogoutAll,
  handleGoogleAuth,
  handleVerifyEmail,
  handleForgotPassword,
  handleResetPassword,
  handleVerifyToken,
  handleChangePassword,
  handleGetSessions,
  handleDeleteSession,
  handleGetConsents,
  handleGrantConsent,
  handleRevokeConsent,
  handleGetAuditLog,
} from '../controllers/auth.controller.js';
import { config } from '../config/index.js';
import { isTokenBlacklisted } from '../services/token.service.js';
import jwt from 'jsonwebtoken';

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'login',
});

const bearer = { security: [{ BearerAuth: [] }] };

/**
 * Blacklist guard: runs after requireAuth validates the JWT signature.
 * Checks Redis to see if the JTI has been blacklisted (e.g. after logout).
 * Uses { as: 'global' } so the hook propagates through Elysia plugin boundaries.
 */
const requireNotBlacklisted = new Elysia({ name: 'require-not-blacklisted' })
  .onBeforeHandle({ as: 'global' }, async ({ request, set }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return;

    const token = authHeader.slice(7);
    try {
      const decoded = jwt.decode(token) as { jti?: string; sub?: string; iat?: number } | null;
      if (decoded?.jti) {
        const blacklisted = await isTokenBlacklisted(decoded.jti, decoded.sub, decoded.iat);
        if (blacklisted) {
          set.status = 401;
          return {
            success: false,
            error: { code: 'TOKEN_REVOKED', message: 'Token has been revoked' },
            meta: { timestamp: new Date().toISOString() },
          };
        }
      }
    } catch {
      // If decode fails, requireAuth already handled it
    }
  });

const authRoutes = new Elysia({ prefix: '/auth' })
  // ── Public Endpoints ──
  .post('/register', handleRegister, {
    body: registerSchema,
    detail: { tags: ['Auth'], summary: 'Register a new user account' },
  })
  .use(loginRateLimit)
  .post('/login', handleLogin, {
    body: loginSchema,
    detail: { tags: ['Auth'], summary: 'Login — returns access + refresh tokens (rate limited: 5/15min)' },
  })
  .post('/refresh', handleRefresh, {
    body: refreshTokenSchema,
    detail: { tags: ['Auth'], summary: 'Rotate refresh token — old token invalidated immediately' },
  })
  .post('/logout', handleLogout, {
    detail: { tags: ['Auth'], summary: 'Logout — blacklists current access token in Redis' },
  })
  .post('/google', handleGoogleAuth, {
    detail: { tags: ['Auth'], summary: 'Authenticate with Google OAuth token' },
  })
  .post('/oauth/google', handleGoogleAuth, {
    detail: { tags: ['Auth'], summary: 'Authenticate with Google OAuth token (alias)' },
  })
  .post('/verify-email', handleVerifyEmail, {
    detail: { tags: ['Auth'], summary: 'Verify email address using token from email link' },
  })
  .post('/forgot-password', handleForgotPassword, {
    body: forgotPasswordSchema,
    detail: { tags: ['Auth'], summary: 'Trigger password reset email (always returns 200)' },
  })
  .post('/reset-password', handleResetPassword, {
    body: resetPasswordSchema,
    detail: { tags: ['Auth'], summary: 'Complete password reset using token from email' },
  })
  .post('/verify-token', handleVerifyToken, {
    detail: { tags: ['Auth'], summary: 'Verify and decode an access token' },
  })
  // ── Authenticated Endpoints ──
  .use(requireAuth(config.JWT_ACCESS_SECRET))
  .use(requireNotBlacklisted)
  .post('/logout-all', handleLogoutAll, {
    detail: { tags: ['Auth'], summary: 'Revoke all sessions — sets per-user Redis invalidation key', ...bearer },
  })
  .post('/change-password', handleChangePassword, {
    body: changePasswordSchema,
    detail: { tags: ['Auth'], summary: 'Change password (requires current password)', ...bearer },
  })
  .get('/sessions', handleGetSessions, {
    detail: { tags: ['Sessions'], summary: 'List all active sessions', ...bearer },
  })
  .delete('/sessions/:id', handleDeleteSession, {
    detail: { tags: ['Sessions'], summary: 'Revoke a specific session by ID', ...bearer },
  })
  .get('/consents', handleGetConsents, {
    detail: { tags: ['Consents'], summary: 'List all consent records', ...bearer },
  })
  .post('/consents', handleGrantConsent, {
    body: consentSchema,
    detail: { tags: ['Consents'], summary: 'Grant a consent type', ...bearer },
  })
  .delete('/consents/:type', handleRevokeConsent, {
    detail: { tags: ['Consents'], summary: 'Revoke a consent type', ...bearer },
  })
  // ── Admin Endpoints ──
  .use(requireRole('admin'))
  .get('/audit-log', handleGetAuditLog, {
    detail: { tags: ['Admin'], summary: 'Get audit log (admin only)', ...bearer },
  });

export default authRoutes;
