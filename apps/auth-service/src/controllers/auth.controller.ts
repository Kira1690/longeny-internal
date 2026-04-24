import { register, login, verifyEmail, forgotPassword, resetPassword, changePassword } from '../services/auth.service.js';
import { rotateRefreshToken, blacklistAccessToken, revokeAllSessions, revokeSession, getActiveSessions, verifyAccessToken, invalidateAllUserTokens } from '../services/token.service.js';
import { googleAuth } from '../services/oauth.service.js';
import { listConsents, grantConsent, revokeConsent } from '../services/consent.service.js';
import { queryAuditLogs } from '../services/audit.service.js';
import { publishUserRegistered, publishUserLogin, publishConsentGranted, publishConsentRevoked, publishConsentChanged } from '../events/publishers.js';

function getIp(request: Request): string {
  return (
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    request.headers.get('X-Real-IP') ||
    'unknown'
  );
}

function getUserAgent(request: Request): string | undefined {
  return request.headers.get('User-Agent') ?? undefined;
}

function getCorrelationId(request: Request): string | undefined {
  return request.headers.get('X-Correlation-ID') ?? undefined;
}

// ── Public Endpoints ──

export async function handleRegister({ body, request, set, store }: any) {
  const ip = getIp(request);
  const ua = getUserAgent(request);

  const result = await register(body.email, body.password, body.firstName, body.lastName, ip, ua);

  await publishUserRegistered(result.credential.id, body.email, body.firstName, body.lastName, getCorrelationId(request));

  set.status = 201;
  return {
    success: true,
    data: {
      user: result.credential,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresIn: result.tokens.expiresIn,
    },
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleLogin({ body, request, set }: any) {
  const ip = getIp(request);
  const ua = getUserAgent(request);

  const result = await login(body.email, body.password, ip, ua);

  await publishUserLogin(result.credential.id, body.email, ip, getCorrelationId(request));

  return {
    success: true,
    data: {
      user: result.credential,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresIn: result.tokens.expiresIn,
    },
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleRefresh({ body, request }: any) {
  const ip = getIp(request);
  const ua = getUserAgent(request);

  const tokens = await rotateRefreshToken(body.refreshToken, ip, ua);

  return {
    success: true,
    data: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    },
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleLogout({ request }: any) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    await blacklistAccessToken(token);
  }

  return {
    success: true,
    data: { message: 'Logged out successfully' },
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleLogoutAll({ request, store }: any) {
  const userId = store.userId as string;

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    await blacklistAccessToken(token);
  }

  await revokeAllSessions(userId);
  await invalidateAllUserTokens(userId);

  return {
    success: true,
    data: { message: 'All sessions revoked' },
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleGoogleAuth({ body, request, set }: any) {
  const ip = getIp(request);
  const ua = getUserAgent(request);

  const result = await googleAuth(body, ip, ua);

  if (result.isNewUser) {
    await publishUserRegistered(result.credential.id, result.credential.email, '', '', getCorrelationId(request));
  } else {
    await publishUserLogin(result.credential.id, result.credential.email, ip, getCorrelationId(request));
  }

  set.status = result.isNewUser ? 201 : 200;
  return {
    success: true,
    data: {
      user: result.credential,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresIn: result.tokens.expiresIn,
      isNewUser: result.isNewUser,
    },
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleVerifyEmail({ body }: any) {
  await verifyEmail(body.token);

  return {
    success: true,
    data: { message: 'Email verified successfully' },
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleForgotPassword({ body, request }: any) {
  const ip = getIp(request);

  await forgotPassword(body.email, ip);

  return {
    success: true,
    data: { message: 'If the email exists, a reset link has been sent' },
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleResetPassword({ body, request }: any) {
  const ip = getIp(request);

  await resetPassword(body.token, body.password, ip);

  return {
    success: true,
    data: { message: 'Password has been reset successfully' },
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleVerifyToken({ body }: any) {
  const decoded = await verifyAccessToken(body.token);

  return {
    success: true,
    data: {
      valid: true,
      payload: {
        sub: decoded.sub,
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions,
        iat: decoded.iat,
        exp: decoded.exp,
      },
    },
    meta: { timestamp: new Date().toISOString() },
  };
}

// ── Authenticated Endpoints ──

export async function handleChangePassword({ body, request, store }: any) {
  const userId = store.userId as string;
  const ip = getIp(request);
  const ua = getUserAgent(request);

  await changePassword(userId, body.currentPassword, body.newPassword, ip, ua);

  return {
    success: true,
    data: { message: 'Password changed successfully' },
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleGetSessions({ store }: any) {
  const userId = store.userId as string;
  const sessions = await getActiveSessions(userId);

  return {
    success: true,
    data: sessions,
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleDeleteSession({ params, store }: any) {
  const userId = store.userId as string;
  const sessionId = params.id;

  await revokeSession(sessionId, userId);

  return {
    success: true,
    data: { message: 'Session revoked' },
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleGetConsents({ store }: any) {
  const userId = store.userId as string;
  const consents = await listConsents(userId);

  return {
    success: true,
    data: consents,
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleGrantConsent({ body, request, store, set }: any) {
  const userId = store.userId as string;
  const ip = getIp(request);
  const ua = getUserAgent(request);

  const consent = await grantConsent(userId, body.consentType, body.version, ip, ua);

  await publishConsentGranted(userId, body.consentType, body.version, getCorrelationId(request));
  await publishConsentChanged(userId, body.consentType, true, body.version, getCorrelationId(request));

  set.status = 201;
  return {
    success: true,
    data: consent,
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleRevokeConsent({ params, request, store }: any) {
  const userId = store.userId as string;
  const consentType = params.type;
  const ip = getIp(request);
  const ua = getUserAgent(request);

  const consent = await revokeConsent(userId, consentType, ip, ua);

  await publishConsentRevoked(userId, consentType, getCorrelationId(request));
  await publishConsentChanged(userId, consentType, false, '', getCorrelationId(request));

  return {
    success: true,
    data: consent,
    meta: { timestamp: new Date().toISOString() },
  };
}

// ── Admin Endpoints ──

export async function handleGetAuditLog({ query }: any) {
  const page = parseInt(query.page || '1', 10);
  const limit = Math.min(parseInt(query.limit || '50', 10), 100);
  const eventType = query.event_type || undefined;
  const credentialId = query.credential_id || undefined;
  const startDate = query.start_date || undefined;
  const endDate = query.end_date || undefined;

  const result = await queryAuditLogs({
    page,
    limit,
    eventType,
    credentialId,
    startDate,
    endDate,
  });

  return {
    success: true,
    data: result.logs,
    meta: {
      timestamp: new Date().toISOString(),
      pagination: result.pagination,
    },
  };
}
