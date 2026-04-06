import { verifyAccessToken } from '../services/token.service.js';
import { getActiveConsents } from '../services/consent.service.js';
import { anonymizeAuditLogs } from '../services/audit.service.js';
import { db } from '../db/index.js';
import { credentials, sessions, oauth_accounts, consents, audit_logs, user_roles, roles } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

export function initInternalController(_unused: unknown): void {
  // no-op — Drizzle db is a module-level singleton
}

/**
 * GET /internal/auth/verify
 */
export async function handleInternalVerify({ request, set }: any) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    set.status = 401;
    return {
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing Authorization header' },
    };
  }

  const token = authHeader.slice(7);

  try {
    const decoded = await verifyAccessToken(token);
    return {
      success: true,
      data: {
        sub: decoded.sub,
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions,
        iat: decoded.iat,
        exp: decoded.exp,
      },
    };
  } catch {
    set.status = 401;
    return {
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Token verification failed' },
    };
  }
}

/**
 * GET /internal/auth/consents/:userId
 */
export async function handleInternalGetConsents({ params }: any) {
  const userId = params.userId;
  const activeConsents = await getActiveConsents(userId);

  return {
    success: true,
    data: activeConsents,
  };
}

/**
 * GET /internal/gdpr/user-data/:credentialId
 */
export async function handleGdprExport({ params }: any) {
  const credentialId = params.credentialId;

  const [credential] = await db
    .select({
      id: credentials.id,
      email: credentials.email,
      status: credentials.status,
      email_verified: credentials.email_verified,
      mfa_enabled: credentials.mfa_enabled,
      last_login_at: credentials.last_login_at,
      last_password_change: credentials.last_password_change,
      created_at: credentials.created_at,
      updated_at: credentials.updated_at,
    })
    .from(credentials)
    .where(eq(credentials.id, credentialId))
    .limit(1);

  if (!credential) {
    return { success: true, data: null };
  }

  const sessionsData = await db
    .select({
      id: sessions.id,
      ip_address: sessions.ip_address,
      user_agent: sessions.user_agent,
      is_active: sessions.is_active,
      last_used_at: sessions.last_used_at,
      created_at: sessions.created_at,
      expires_at: sessions.expires_at,
    })
    .from(sessions)
    .where(eq(sessions.credential_id, credentialId));

  const oauthAccountsData = await db
    .select({
      provider: oauth_accounts.provider,
      provider_email: oauth_accounts.provider_email,
      created_at: oauth_accounts.created_at,
    })
    .from(oauth_accounts)
    .where(eq(oauth_accounts.credential_id, credentialId));

  const consentsData = await db
    .select({
      consent_type: consents.consent_type,
      version: consents.version,
      granted: consents.granted,
      ip_address: consents.ip_address,
      granted_at: consents.granted_at,
      revoked_at: consents.revoked_at,
      created_at: consents.created_at,
    })
    .from(consents)
    .where(eq(consents.credential_id, credentialId));

  const auditLogsData = await db
    .select({
      event_type: audit_logs.event_type,
      action: audit_logs.action,
      result: audit_logs.result,
      ip_address: audit_logs.ip_address,
      created_at: audit_logs.created_at,
    })
    .from(audit_logs)
    .where(eq(audit_logs.credential_id!, credentialId))
    .orderBy(desc(audit_logs.created_at))
    .limit(100);

  const rolesData = await db
    .select({
      name: roles.name,
      description: roles.description,
      assigned_at: user_roles.assigned_at,
    })
    .from(user_roles)
    .innerJoin(roles, eq(user_roles.role_id, roles.id))
    .where(eq(user_roles.credential_id, credentialId));

  return {
    success: true,
    data: {
      credential,
      sessions: sessionsData,
      oauthAccounts: oauthAccountsData,
      consents: consentsData,
      auditLogs: auditLogsData,
      roles: rolesData.map((r) => ({
        name: r.name,
        description: r.description,
        assignedAt: r.assigned_at,
      })),
    },
  };
}

/**
 * DELETE /internal/gdpr/user-data/:credentialId
 */
export async function handleGdprDelete({ params }: any) {
  const credentialId = params.credentialId;

  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.id, credentialId))
    .limit(1);

  if (!credential) {
    return {
      success: true,
      data: { message: 'No data found for this credential', deleted: false },
    };
  }

  const deletedSessions = await db.delete(sessions).where(eq(sessions.credential_id, credentialId)).returning();
  const deletedOauth = await db.delete(oauth_accounts).where(eq(oauth_accounts.credential_id, credentialId)).returning();
  const deletedConsents = await db.delete(consents).where(eq(consents.credential_id, credentialId)).returning();
  const deletedRoles = await db.delete(user_roles).where(eq(user_roles.credential_id, credentialId)).returning();

  const auditLogsAnonymized = await anonymizeAuditLogs(credentialId);

  await db.delete(credentials).where(eq(credentials.id, credentialId));

  return {
    success: true,
    data: {
      message: 'User auth data deleted',
      deleted: true,
      details: {
        sessionsDeleted: deletedSessions.length,
        oauthAccountsDeleted: deletedOauth.length,
        consentsDeleted: deletedConsents.length,
        rolesDeleted: deletedRoles.length,
        auditLogsAnonymized,
      },
    },
  };
}
