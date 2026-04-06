import { EventPublisher } from '@longeny/events';
import { EVENT_NAMES } from '@longeny/types';
import { redisUrl } from '../config/index.js';

let publisher: EventPublisher;

export function initPublisher(): EventPublisher {
  publisher = new EventPublisher(redisUrl, 'auth-service');
  return publisher;
}

export function getPublisher(): EventPublisher {
  return publisher;
}

export async function publishUserRegistered(
  credentialId: string,
  email: string,
  firstName: string,
  lastName: string,
  correlationId?: string,
): Promise<void> {
  await publisher.publish(
    EVENT_NAMES.USER_REGISTERED,
    { credentialId, email, firstName, lastName },
    correlationId,
  );
}

export async function publishUserLogin(
  credentialId: string,
  email: string,
  ipAddress: string,
  correlationId?: string,
): Promise<void> {
  await publisher.publish(
    EVENT_NAMES.USER_LOGIN,
    { credentialId, email, ipAddress, loginAt: new Date().toISOString() },
    correlationId,
  );
}

export async function publishConsentGranted(
  credentialId: string,
  consentType: string,
  version: string,
  correlationId?: string,
): Promise<void> {
  await publisher.publish(
    EVENT_NAMES.CONSENT_GRANTED,
    { credentialId, consentType, version },
    correlationId,
  );
}

export async function publishConsentRevoked(
  credentialId: string,
  consentType: string,
  correlationId?: string,
): Promise<void> {
  await publisher.publish(
    EVENT_NAMES.CONSENT_REVOKED,
    { credentialId, consentType },
    correlationId,
  );
}

export async function publishConsentChanged(
  credentialId: string,
  consentType: string,
  granted: boolean,
  version: string,
  correlationId?: string,
): Promise<void> {
  await publisher.publish(
    EVENT_NAMES.CONSENT_CHANGED,
    { credentialId, consentType, granted, version },
    correlationId,
  );
}
