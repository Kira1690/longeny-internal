import crypto from 'node:crypto';
import {
  AccountLockedError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '@longeny/errors';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { credentials, permissions, role_permissions, roles, user_roles } from '../db/schema.js';
import { createAuditLog } from './audit.service.js';
import { resolveIdentity } from './identity.service.js';
import {
  type TokenPair,
  generateTokenPair,
  invalidateAllUserTokens,
  revokeAllSessions,
} from './token.service.js';

type Credential = typeof credentials.$inferSelect;

/** What the auth routes are allowed to echo back about a credential. Never the
 *  password hash, the reset token or any other column on the row. */
export interface CredentialView {
  id: string;
  email: string;
  status: Credential['status'];
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
  role?: string;
}

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Register a new user with email/password credentials.
 */
export async function register(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  ipAddress: string,
  userAgent?: string,
): Promise<{ credential: CredentialView; tokens: TokenPair }> {
  // Check if email already exists
  const [existing] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.email, email))
    .limit(1);
  if (existing) {
    throw new ConflictError('An account with this email already exists');
  }

  // Hash password with Bun.password
  const passwordHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 12 });

  // Generate email verification token
  const emailVerificationToken = crypto.randomBytes(64).toString('hex');
  const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Create credential
  const [credential] = await db
    .insert(credentials)
    .values({
      email,
      password_hash: passwordHash,
      email_verification_token: emailVerificationToken,
      email_verification_expires: emailVerificationExpires,
    })
    .returning();

  // Find or create the 'user' role and assign it
  let [userRole] = await db.select().from(roles).where(eq(roles.name, 'user')).limit(1);
  if (!userRole) {
    [userRole] = await db
      .insert(roles)
      .values({
        name: 'user',
        description: 'Default user role',
        is_system: true,
      })
      .returning();
  }

  await db.insert(user_roles).values({
    credential_id: credential.id,
    role_id: userRole.id,
  });

  const identity = await resolveIdentity(credential.id);

  // Generate JWT pair
  const tokens = await generateTokenPair(
    credential.id,
    credential.email,
    identity,
    ipAddress,
    userAgent,
  );

  // Audit log
  await createAuditLog({
    credentialId: credential.id,
    eventType: 'user.registered',
    userEmail: email,
    ipAddress,
    userAgent,
    action: 'register',
    result: 'success',
    purpose: 'account_creation',
    metadata: { firstName, lastName },
  });

  return {
    credential: {
      id: credential.id,
      email: credential.email,
      status: credential.status,
      emailVerified: credential.email_verified,
      firstName,
      lastName,
    },
    tokens,
  };
}

/**
 * Login with email/password. Checks lockout, validates credentials,
 * resets or increments failed attempts, and creates a session.
 */
export async function login(
  email: string,
  password: string,
  ipAddress: string,
  userAgent?: string,
): Promise<{ credential: CredentialView; tokens: TokenPair }> {
  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.email, email))
    .limit(1);

  if (!credential) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Check account lockout
  if (credential.locked_until && credential.locked_until > new Date()) {
    await createAuditLog({
      credentialId: credential.id,
      eventType: 'user.login.locked',
      userEmail: email,
      ipAddress,
      userAgent,
      action: 'login',
      result: 'denied',
      purpose: 'authentication',
    });
    throw new AccountLockedError(credential.locked_until);
  }

  // Check account status
  if (credential.status === 'suspended' || credential.status === 'deactivated') {
    throw new UnauthorizedError('Account is disabled');
  }

  // Verify password
  if (!credential.password_hash) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const isValid = await Bun.password.verify(password, credential.password_hash);

  if (!isValid) {
    // Increment failed attempts
    const failedAttempts = credential.failed_login_attempts + 1;
    const updateData: Partial<typeof credentials.$inferInsert> = {
      failed_login_attempts: failedAttempts,
      updated_at: new Date(),
    };

    if (failedAttempts >= LOCKOUT_THRESHOLD) {
      updateData.locked_until = new Date(Date.now() + LOCKOUT_DURATION_MS);
      updateData.status = 'locked';
    }

    await db.update(credentials).set(updateData).where(eq(credentials.id, credential.id));

    await createAuditLog({
      credentialId: credential.id,
      eventType: 'user.login.failed',
      userEmail: email,
      ipAddress,
      userAgent,
      action: 'login',
      result: 'failure',
      purpose: 'authentication',
      metadata: { failedAttempts },
    });

    throw new UnauthorizedError('Invalid email or password');
  }

  // Reset failed login attempts on successful login
  await db
    .update(credentials)
    .set({
      failed_login_attempts: 0,
      locked_until: null,
      last_login_at: new Date(),
      status: credential.status === 'locked' ? 'active' : credential.status,
      updated_at: new Date(),
    })
    .where(eq(credentials.id, credential.id));

  const identity = await resolveIdentity(credential.id);
  const roleName = identity.primaryRole;

  // Generate JWT pair
  const tokens = await generateTokenPair(
    credential.id,
    credential.email,
    identity,
    ipAddress,
    userAgent,
  );

  await createAuditLog({
    credentialId: credential.id,
    eventType: 'user.login',
    userRole: roleName,
    userEmail: email,
    ipAddress,
    userAgent,
    action: 'login',
    result: 'success',
    purpose: 'authentication',
  });

  return {
    credential: {
      id: credential.id,
      email: credential.email,
      status: credential.status,
      emailVerified: credential.email_verified,
      role: roleName,
    },
    tokens,
  };
}

/**
 * Verify email with token.
 */
export async function verifyEmail(token: string): Promise<void> {
  const [credential] = await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.email_verification_token, token),
        gt(credentials.email_verification_expires, new Date()),
      ),
    )
    .limit(1);

  if (!credential) {
    throw new BadRequestError('Invalid or expired verification token', 'INVALID_TOKEN');
  }

  await db
    .update(credentials)
    .set({
      email_verified: true,
      email_verification_token: null,
      email_verification_expires: null,
      status: 'active',
      updated_at: new Date(),
    })
    .where(eq(credentials.id, credential.id));

  await createAuditLog({
    credentialId: credential.id,
    eventType: 'user.email.verified',
    userEmail: credential.email,
    action: 'verify_email',
    result: 'success',
    purpose: 'account_verification',
  });
}

/**
 * Generate a password reset token and store it on the credential.
 */
export async function forgotPassword(
  email: string,
  ipAddress: string,
): Promise<{ resetToken: string }> {
  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.email, email))
    .limit(1);

  // Always return success to prevent email enumeration
  if (!credential) {
    return { resetToken: '' };
  }

  const resetToken = crypto.randomBytes(64).toString('hex');
  const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db
    .update(credentials)
    .set({
      password_reset_token: resetToken,
      password_reset_expires: resetExpires,
      updated_at: new Date(),
    })
    .where(eq(credentials.id, credential.id));

  await createAuditLog({
    credentialId: credential.id,
    eventType: 'user.password.reset.requested',
    userEmail: email,
    ipAddress,
    action: 'forgot_password',
    result: 'success',
    purpose: 'password_reset',
  });

  return { resetToken };
}

/**
 * Reset password using a reset token.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  ipAddress: string,
): Promise<void> {
  const [credential] = await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.password_reset_token, token),
        gt(credentials.password_reset_expires, new Date()),
      ),
    )
    .limit(1);

  if (!credential) {
    throw new BadRequestError('Invalid or expired reset token', 'INVALID_TOKEN');
  }

  const passwordHash = await Bun.password.hash(newPassword, { algorithm: 'bcrypt', cost: 12 });

  await db
    .update(credentials)
    .set({
      password_hash: passwordHash,
      password_reset_token: null,
      password_reset_expires: null,
      last_password_change: new Date(),
      updated_at: new Date(),
    })
    .where(eq(credentials.id, credential.id));

  // A password reset is the recovery path from a compromise, so every session
  // and access token minted before it dies with it — the same invalidation
  // logout-all performs. Without this a stolen refresh token outlived the
  // reset by the full refresh lifetime.
  await revokeAllSessions(credential.id);
  await invalidateAllUserTokens(credential.id);

  await createAuditLog({
    credentialId: credential.id,
    eventType: 'user.password.reset',
    userEmail: credential.email,
    ipAddress,
    action: 'reset_password',
    result: 'success',
    purpose: 'password_reset',
  });
}

/**
 * Change password for an authenticated user.
 */
export async function changePassword(
  credentialId: string,
  currentPassword: string,
  newPassword: string,
  ipAddress: string,
  userAgent?: string,
): Promise<void> {
  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.id, credentialId))
    .limit(1);

  if (!credential || !credential.password_hash) {
    throw new NotFoundError('Credential');
  }

  const isValid = await Bun.password.verify(currentPassword, credential.password_hash);
  if (!isValid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const passwordHash = await Bun.password.hash(newPassword, { algorithm: 'bcrypt', cost: 12 });

  await db
    .update(credentials)
    .set({
      password_hash: passwordHash,
      last_password_change: new Date(),
      updated_at: new Date(),
    })
    .where(eq(credentials.id, credentialId));

  // Same reasoning as resetPassword: changing a password is how a user responds
  // to a suspected compromise, so outstanding sessions and access tokens go too.
  await revokeAllSessions(credentialId);
  await invalidateAllUserTokens(credentialId);

  await createAuditLog({
    credentialId,
    eventType: 'user.password.changed',
    userEmail: credential.email,
    ipAddress,
    userAgent,
    action: 'change_password',
    result: 'success',
    purpose: 'account_security',
  });
}
