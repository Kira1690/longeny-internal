import { BadRequestError, ServiceUnavailableError, UnauthorizedError } from '@longeny/errors';
import { and, eq } from 'drizzle-orm';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { credentials, oauth_accounts, roles, user_roles } from '../db/schema.js';
import { createAuditLog } from './audit.service.js';
import { resolveIdentity } from './identity.service.js';
import { type TokenPair, generateTokenPair } from './token.service.js';

export function initOauthService(_unused: unknown): void {
  // no-op — Drizzle db is a module-level singleton
}

type Credential = typeof credentials.$inferSelect;

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

/** Google's tokeninfo/userinfo payloads: every field is attacker-influenced, so
 *  nothing is assumed present and `email_verified` arrives as a string on the
 *  tokeninfo endpoint and a boolean on userinfo. */
interface GoogleClaims {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
}

export interface GoogleAuthResult {
  credential: {
    id: string;
    email: string;
    status: Credential['status'];
    emailVerified: boolean;
    role: string;
  };
  tokens: TokenPair;
  isNewUser: boolean;
}

/**
 * An unset client id used to skip the audience check, which meant an id_token
 * minted for any other Google application was accepted as a login here. OAuth
 * now fails closed instead: no configured audience, no Google sign-in.
 */
function requireGoogleClientId(): string {
  if (!config.GOOGLE_CLIENT_ID) {
    throw new ServiceUnavailableError('google-oauth');
  }
  return config.GOOGLE_CLIENT_ID;
}

function normaliseClaims(data: GoogleClaims): GoogleUserInfo {
  if (!data.sub || !data.email) {
    throw new UnauthorizedError('Google account is missing a subject or email');
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

async function verifyGoogleIdToken(idToken: string): Promise<GoogleUserInfo> {
  const expectedAudience = requireGoogleClientId();

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );

  if (!response.ok) {
    throw new UnauthorizedError('Invalid Google ID token');
  }

  const data = (await response.json()) as GoogleClaims;

  if (data.aud !== expectedAudience) {
    throw new UnauthorizedError('Google token audience mismatch');
  }

  return normaliseClaims(data);
}

async function exchangeGoogleAuthCode(code: string): Promise<GoogleUserInfo> {
  const clientId = requireGoogleClientId();

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: clientId,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: config.GOOGLE_CALLBACK_URL,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    throw new UnauthorizedError('Failed to exchange Google auth code');
  }

  const tokenData = (await tokenResponse.json()) as GoogleTokenResponse;

  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userInfoResponse.ok) {
    throw new UnauthorizedError('Failed to fetch Google user info');
  }

  return normaliseClaims((await userInfoResponse.json()) as GoogleClaims);
}

/** Either an id_token or an auth code must be present; the caller validates
 *  that one of them is set, and this turns the remaining maybe-undefined into a
 *  named error instead of a non-null assertion. */
function requireAuthCode(code: string | undefined): string {
  if (!code) throw new BadRequestError('Either idToken or code is required');
  return code;
}

/**
 * A credential that already exists must clear the same status bar as password
 * login before Google can sign it in — otherwise suspending an account only
 * closed the password door.
 */
function assertSignInAllowed(credential: Credential): void {
  if (credential.status === 'suspended' || credential.status === 'deactivated') {
    throw new UnauthorizedError('Account is disabled');
  }
  if (credential.locked_until && credential.locked_until > new Date()) {
    throw new UnauthorizedError('Account is disabled');
  }
}

/**
 * Binding Google to an account that already exists is an account takeover if the
 * email is not proven: anyone able to mint a Google identity for
 * victim@example.com would inherit the victim's password account. Google must
 * have verified the address, and the account must be fully active — a
 * half-provisioned or suspended credential is never adopted this way.
 */
async function assertBindingAllowed(
  credential: Credential,
  googleUser: GoogleUserInfo,
  ipAddress: string,
  userAgent?: string,
): Promise<void> {
  const deny = async (reason: string): Promise<never> => {
    await createAuditLog({
      credentialId: credential.id,
      eventType: 'user.oauth.link.denied',
      userEmail: credential.email,
      ipAddress,
      userAgent,
      action: 'link_oauth',
      result: 'denied',
      purpose: 'authentication',
      metadata: { provider: 'google', reason },
    });
    throw new UnauthorizedError('Google sign-in cannot be linked to this account');
  };

  if (!googleUser.email_verified) {
    await deny('google_email_not_verified');
  }
  if (credential.status !== 'active') {
    await deny(`credential_status_${credential.status}`);
  }
}

export async function googleAuth(
  params: { idToken?: string; code?: string },
  ipAddress: string,
  userAgent?: string,
): Promise<GoogleAuthResult> {
  if (!params.idToken && !params.code) {
    throw new UnauthorizedError('Either idToken or code is required');
  }

  const googleUser = params.idToken
    ? await verifyGoogleIdToken(params.idToken)
    : await exchangeGoogleAuthCode(requireAuthCode(params.code));

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

  let credentialData: Credential;

  if (oauthAccount) {
    // Existing OAuth account — use its credential
    const [cred] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.id, oauthAccount.credential_id))
      .limit(1);

    if (!cred) {
      throw new UnauthorizedError('Linked account no longer exists');
    }

    assertSignInAllowed(cred);
    credentialData = cred;
  } else {
    // Check if a credential with this email already exists
    const [existingCred] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.email, googleUser.email))
      .limit(1);

    if (existingCred) {
      assertSignInAllowed(existingCred);
      await assertBindingAllowed(existingCred, googleUser, ipAddress, userAgent);
      credentialData = existingCred;
    } else {
      // Create new credential
      const [newCred] = await db
        .insert(credentials)
        .values({
          email: googleUser.email,
          email_verified: googleUser.email_verified,
          status: googleUser.email_verified ? 'active' : 'pending_verification',
        })
        .returning();

      credentialData = newCred;

      // Assign 'user' role
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
        credential_id: newCred.id,
        role_id: userRole.id,
      });

      isNewUser = true;
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

    if (!isNewUser) {
      await createAuditLog({
        credentialId: credentialData.id,
        eventType: 'user.oauth.linked',
        userEmail: credentialData.email,
        ipAddress,
        userAgent,
        action: 'link_oauth',
        result: 'success',
        purpose: 'authentication',
        metadata: { provider: 'google' },
      });
    }
  }

  // Update last login
  await db
    .update(credentials)
    .set({
      last_login_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(credentials.id, credentialData.id));

  const identity = await resolveIdentity(credentialData.id);

  const tokens = await generateTokenPair(
    credentialData.id,
    credentialData.email,
    identity,
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
      role: identity.primaryRole,
    },
    tokens,
    isNewUser,
  };
}
