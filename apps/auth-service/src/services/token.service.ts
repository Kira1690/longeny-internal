import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import Redis from 'ioredis';
import { sha256 } from '@longeny/utils';
import { InvalidTokenError, UnauthorizedError } from '@longeny/errors';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { sessions, credentials, roles, user_roles, role_permissions, permissions } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

let redis: Redis;

export function initTokenService(_prismaUnused: unknown, redisClient: Redis): void {
  redis = redisClient;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  permissions: string[];
  jti: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Parse a duration string like "15m", "7d", "1h" into seconds.
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 900; // default 15m
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return 900;
  }
}

/**
 * Generate a JWT access token and a random refresh token.
 * The refresh token's SHA-256 hash is stored in the sessions table.
 */
export async function generateTokenPair(
  credentialId: string,
  email: string,
  role: string,
  permissionsArray: string[],
  ipAddress: string,
  userAgent?: string,
): Promise<TokenPair> {
  const jti = crypto.randomUUID();
  const accessExpiresIn = parseDuration(config.JWT_ACCESS_EXPIRY);
  const refreshExpiresIn = parseDuration(config.JWT_REFRESH_EXPIRY);

  const accessToken = jwt.sign(
    {
      sub: credentialId,
      email,
      role,
      permissions: permissionsArray,
      jti,
    },
    config.JWT_ACCESS_SECRET,
    { expiresIn: accessExpiresIn },
  );

  // Refresh token is a random 64-byte hex string
  const refreshToken = crypto.randomBytes(64).toString('hex');
  const refreshTokenHash = sha256(refreshToken);

  // Store session with refresh token hash
  await db.insert(sessions).values({
    credential_id: credentialId,
    refresh_token_hash: refreshTokenHash,
    ip_address: ipAddress,
    user_agent: userAgent,
    expires_at: new Date(Date.now() + refreshExpiresIn * 1000),
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: accessExpiresIn,
  };
}

/**
 * Rotate refresh token with reuse detection.
 */
export async function rotateRefreshToken(
  oldRefreshToken: string,
  ipAddress: string,
  userAgent?: string,
): Promise<TokenPair> {
  const oldHash = sha256(oldRefreshToken);

  // Find the session by refresh token hash
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.refresh_token_hash, oldHash))
    .limit(1);

  if (!session) {
    throw new InvalidTokenError();
  }

  // Reuse detection: if session is already revoked, someone stole the token
  if (!session.is_active || session.revoked_at) {
    // Revoke ALL sessions for this user (token theft detected)
    await db
      .update(sessions)
      .set({ is_active: false, revoked_at: new Date() })
      .where(eq(sessions.credential_id, session.credential_id));
    throw new UnauthorizedError('Token reuse detected. All sessions revoked for security.');
  }

  // Check if session has expired
  if (session.expires_at < new Date()) {
    await db
      .update(sessions)
      .set({ is_active: false, revoked_at: new Date() })
      .where(eq(sessions.id, session.id));
    throw new InvalidTokenError();
  }

  // Revoke the old session
  await db
    .update(sessions)
    .set({ is_active: false, revoked_at: new Date() })
    .where(eq(sessions.id, session.id));

  // Get credential with role and permissions
  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.id, session.credential_id))
    .limit(1);

  const [userRoleRow] = await db
    .select({ roleName: roles.name, roleId: roles.id })
    .from(user_roles)
    .innerJoin(roles, eq(user_roles.role_id, roles.id))
    .where(eq(user_roles.credential_id, session.credential_id))
    .limit(1);

  const roleName = userRoleRow?.roleName ?? 'user';
  let permsArray: string[] = [];
  if (userRoleRow) {
    const rolePerms = await db
      .select({ name: permissions.name })
      .from(role_permissions)
      .innerJoin(permissions, eq(role_permissions.permission_id, permissions.id))
      .where(eq(role_permissions.role_id, userRoleRow.roleId));
    permsArray = rolePerms.map((rp) => rp.name);
  }

  return generateTokenPair(
    session.credential_id,
    credential.email,
    roleName,
    permsArray,
    ipAddress,
    userAgent,
  );
}

/**
 * Blacklist an access token in Redis. TTL = remaining lifetime of the token.
 */
export async function blacklistAccessToken(accessToken: string): Promise<void> {
  try {
    const decoded = jwt.decode(accessToken) as jwt.JwtPayload | null;
    if (!decoded?.exp || !decoded?.jti) return;

    const remainingSeconds = decoded.exp - Math.floor(Date.now() / 1000);
    if (remainingSeconds > 0) {
      await redis.set(`blacklist:${decoded.jti}`, '1', 'EX', remainingSeconds);
    }
  } catch {
    // If token can't be decoded, nothing to blacklist
  }
}

/**
 * Check if a token JTI is blacklisted.
 */
export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  const result = await redis.get(`blacklist:${jti}`);
  return result !== null;
}

/**
 * Revoke a specific session by ID.
 */
export async function revokeSession(sessionId: string, credentialId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ is_active: false, revoked_at: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.credential_id, credentialId)));
}

/**
 * Revoke all sessions for a user.
 */
export async function revokeAllSessions(credentialId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ is_active: false, revoked_at: new Date() })
    .where(and(eq(sessions.credential_id, credentialId), eq(sessions.is_active, true)));
}

/**
 * Get all active sessions for a user.
 */
export async function getActiveSessions(credentialId: string) {
  return db
    .select({
      id: sessions.id,
      ip_address: sessions.ip_address,
      user_agent: sessions.user_agent,
      last_used_at: sessions.last_used_at,
      created_at: sessions.created_at,
      expires_at: sessions.expires_at,
    })
    .from(sessions)
    .where(and(eq(sessions.credential_id, credentialId), eq(sessions.is_active, true)))
    .orderBy(sessions.created_at);
}

/**
 * Verify and decode an access token, checking blacklist.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload & { iat: number; exp: number }> {
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload & { iat: number; exp: number };

  // Check if token is blacklisted
  if (decoded.jti) {
    const blacklisted = await isTokenBlacklisted(decoded.jti);
    if (blacklisted) {
      throw new InvalidTokenError();
    }
  }

  return decoded;
}
