import { UnauthorizedError } from '@longeny/errors';
import { db } from '../db/index.js';
import { credentials, oauth_accounts, roles, user_roles, role_permissions, permissions } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { generateTokenPair, type TokenPair } from './token.service.js';
import { createAuditLog } from './audit.service.js';
import { config } from '../config/index.js';

export function initOauthService(_unused: unknown): void {
  // no-op — Drizzle db is a module-level singleton
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);

  if (!response.ok) {
    throw new UnauthorizedError('Invalid Google ID token');
  }

  const data = (await response.json()) as any;

  if (config.GOOGLE_CLIENT_ID && data.aud !== config.GOOGLE_CLIENT_ID) {
    throw new UnauthorizedError('Google token audience mismatch');
  }

  return {
    sub: data.sub,
    email: data.email,
    email_verified: data.email_verified === 'true' || data.email_verified === true,
    name: data.name,
    given_name: data.given_name,
    family_name: data.family_name,
    picture: data.picture,
  };
}

async function exchangeGoogleAuthCode(code: string): Promise<GoogleUserInfo> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: config.GOOGLE_CALLBACK_URL,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    throw new UnauthorizedError('Failed to exchange Google auth code');
  }

  const tokenData = (await tokenResponse.json()) as any;

  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userInfoResponse.ok) {
    throw new UnauthorizedError('Failed to fetch Google user info');
  }

  return (await userInfoResponse.json()) as GoogleUserInfo;
}

export async function googleAuth(
  params: { idToken?: string; code?: string },
  ipAddress: string,
  userAgent?: string,
): Promise<{ credential: any; tokens: TokenPair; isNewUser: boolean }> {
  if (!params.idToken && !params.code) {
    throw new UnauthorizedError('Either idToken or code is required');
  }

  const googleUser = params.idToken
    ? await verifyGoogleIdToken(params.idToken)
    : await exchangeGoogleAuthCode(params.code!);

  if (!googleUser.email) {
    throw new UnauthorizedError('Google account has no email');
  }

  let isNewUser = false;

  // Check if OAuth account already exists
  const [oauthAccount] = await db
    .select()
    .from(oauth_accounts)
    .where(
      and(
        eq(oauth_accounts.provider, 'google'),
        eq(oauth_accounts.provider_user_id, googleUser.sub),
      ),
    )
    .limit(1);

  let credentialData: any;

  if (oauthAccount) {
    // Existing OAuth account — use its credential
    const [cred] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.id, oauthAccount.credential_id))
      .limit(1);
    credentialData = cred;
  } else {
    // Check if a credential with this email already exists
    const [existingCred] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.email, googleUser.email))
      .limit(1);

    if (!existingCred) {
      // Create new credential
      const [newCred] = await db.insert(credentials).values({
        email: googleUser.email,
        email_verified: googleUser.email_verified,
        status: googleUser.email_verified ? 'active' : 'pending_verification',
      }).returning();

      credentialData = newCred;

      // Assign 'user' role
      let [userRole] = await db.select().from(roles).where(eq(roles.name, 'user')).limit(1);
      if (!userRole) {
        [userRole] = await db.insert(roles).values({
          name: 'user',
          description: 'Default user role',
          is_system: true,
        }).returning();
      }

      await db.insert(user_roles).values({
        credential_id: newCred.id,
        role_id: userRole.id,
      });

      isNewUser = true;
    } else {
      credentialData = existingCred;
    }

    // Link OAuth account
    await db.insert(oauth_accounts).values({
      credential_id: credentialData.id,
      provider: 'google',
      provider_user_id: googleUser.sub,
      provider_email: googleUser.email,
      profile_data: {
        name: googleUser.name,
        given_name: googleUser.given_name,
        family_name: googleUser.family_name,
        picture: googleUser.picture,
      },
    });
  }

  // Update last login
  await db.update(credentials).set({
    last_login_at: new Date(),
    updated_at: new Date(),
  }).where(eq(credentials.id, credentialData.id));

  // Get role and permissions
  const [userRoleRow] = await db
    .select({ roleName: roles.name, roleId: roles.id })
    .from(user_roles)
    .innerJoin(roles, eq(user_roles.role_id, roles.id))
    .where(eq(user_roles.credential_id, credentialData.id))
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

  const tokens = await generateTokenPair(
    credentialData.id,
    credentialData.email,
    roleName,
    permsArray,
    ipAddress,
    userAgent,
  );

  await createAuditLog({
    credentialId: credentialData.id,
    eventType: isNewUser ? 'user.registered.oauth' : 'user.login.oauth',
    userEmail: credentialData.email,
    ipAddress,
    userAgent,
    action: isNewUser ? 'register' : 'login',
    result: 'success',
    purpose: 'authentication',
    metadata: { provider: 'google' },
  });

  return {
    credential: {
      id: credentialData.id,
      email: credentialData.email,
      status: credentialData.status,
      emailVerified: credentialData.email_verified,
      role: roleName,
    },
    tokens,
    isNewUser,
  };
}
