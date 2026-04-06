import { NotFoundError, BadRequestError } from '@longeny/errors';
import { db } from '../db/index.js';
import { consents } from '../db/schema.js';
import { eq, and, isNull, gt, or, desc } from 'drizzle-orm';
import { createAuditLog } from './audit.service.js';

type ConsentType =
  | 'terms_of_service'
  | 'privacy_policy'
  | 'health_data_processing'
  | 'ai_profiling'
  | 'data_sharing_providers'
  | 'marketing_email'
  | 'marketing_sms';

const VALID_CONSENT_TYPES: ConsentType[] = [
  'terms_of_service',
  'privacy_policy',
  'health_data_processing',
  'ai_profiling',
  'data_sharing_providers',
  'marketing_email',
  'marketing_sms',
];

export function initConsentService(_unused: unknown): void {
  // no-op — Drizzle db is a module-level singleton
}

/**
 * List all consents for a user.
 */
export async function listConsents(credentialId: string) {
  return db
    .select()
    .from(consents)
    .where(eq(consents.credential_id, credentialId))
    .orderBy(desc(consents.created_at));
}

/**
 * Grant consent of a given type and version.
 */
export async function grantConsent(
  credentialId: string,
  consentType: string,
  version: string,
  ipAddress: string,
  userAgent?: string,
) {
  if (!VALID_CONSENT_TYPES.includes(consentType as ConsentType)) {
    throw new BadRequestError(`Invalid consent type: ${consentType}`, 'INVALID_CONSENT_TYPE');
  }

  const [consent] = await db.insert(consents).values({
    credential_id: credentialId,
    consent_type: consentType as ConsentType,
    version,
    granted: true,
    ip_address: ipAddress,
    user_agent: userAgent,
    granted_at: new Date(),
  }).returning();

  await createAuditLog({
    credentialId,
    eventType: 'consent.granted',
    action: 'grant_consent',
    result: 'success',
    purpose: 'consent_management',
    resourceType: 'consent',
    resourceId: consent.id,
    ipAddress,
    userAgent,
    metadata: { consentType, version },
  });

  return consent;
}

/**
 * Revoke consent of a given type.
 */
export async function revokeConsent(
  credentialId: string,
  consentType: string,
  ipAddress: string,
  userAgent?: string,
) {
  // Find the most recent active consent of this type
  const [consent] = await db
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.credential_id, credentialId),
        eq(consents.consent_type, consentType as ConsentType),
        eq(consents.granted, true),
        isNull(consents.revoked_at),
      ),
    )
    .orderBy(desc(consents.created_at))
    .limit(1);

  if (!consent) {
    throw new NotFoundError('Consent', consentType);
  }

  const [updated] = await db
    .update(consents)
    .set({
      granted: false,
      revoked_at: new Date(),
    })
    .where(eq(consents.id, consent.id))
    .returning();

  await createAuditLog({
    credentialId,
    eventType: 'consent.revoked',
    action: 'revoke_consent',
    result: 'success',
    purpose: 'consent_management',
    resourceType: 'consent',
    resourceId: consent.id,
    ipAddress,
    userAgent,
    metadata: { consentType },
  });

  return updated;
}

/**
 * Check a user's active consents (for internal use by consent middleware).
 */
export async function getActiveConsents(credentialId: string) {
  return db
    .select({
      consent_type: consents.consent_type,
      version: consents.version,
      granted_at: consents.granted_at,
      expires_at: consents.expires_at,
    })
    .from(consents)
    .where(
      and(
        eq(consents.credential_id, credentialId),
        eq(consents.granted, true),
        isNull(consents.revoked_at),
        or(isNull(consents.expires_at), gt(consents.expires_at, new Date())),
      ),
    );
}
