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

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'login',
});

const authRoutes = new Elysia({ prefix: '/auth' })
  // ── Public Endpoints ──
  .post('/register', handleRegister, { body: registerSchema })
  .use(loginRateLimit)
  .post('/login', handleLogin, { body: loginSchema })
  .post('/refresh', handleRefresh, { body: refreshTokenSchema })
  .post('/logout', handleLogout)
  .post('/google', handleGoogleAuth)
  .post('/oauth/google', handleGoogleAuth)
  .post('/verify-email', handleVerifyEmail)
  .post('/forgot-password', handleForgotPassword, { body: forgotPasswordSchema })
  .post('/reset-password', handleResetPassword, { body: resetPasswordSchema })
  .post('/verify-token', handleVerifyToken)
  // ── Authenticated Endpoints ──
  .use(requireAuth(config.JWT_ACCESS_SECRET))
  .post('/logout-all', handleLogoutAll)
  .post('/change-password', handleChangePassword, { body: changePasswordSchema })
  .get('/sessions', handleGetSessions)
  .delete('/sessions/:id', handleDeleteSession)
  .get('/consents', handleGetConsents)
  .post('/consents', handleGrantConsent, { body: consentSchema })
  .delete('/consents/:type', handleRevokeConsent)
  // ── Admin Endpoints ──
  .use(requireRole('admin'))
  .get('/audit-log', handleGetAuditLog);

export default authRoutes;
