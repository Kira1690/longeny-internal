import { EventPublisher } from '@longeny/events';
import { EVENT_NAMES } from '@longeny/types';
import { createLogger } from '@longeny/utils';
import { redisUrl } from '../config/index.js';

const logger = createLogger('ai-content:publisher');

let publisher: EventPublisher | null = null;

export function getPublisher(): EventPublisher {
  if (!publisher) {
    publisher = new EventPublisher(redisUrl, 'ai-content-service');
  }
  return publisher;
}

// ── Event payloads ──

export interface RecommendationGeneratedPayload {
  userId: string;
  recommendationType: string;
  resultCount: number;
  modelUsed: string;
  isMock: boolean;
  cachedAt: string;
}

export interface AiDocumentGeneratedPayload {
  documentId: string;
  userId: string;
  providerId: string;
  documentType: string;
  title: string;
  modelUsed: string;
  isMock: boolean;
}

export interface DocumentUploadedPayload {
  documentId: string;
  ownerId: string;
  ownerType: string;
  documentType: string;
  title: string;
  fileName: string;
  fileSize: number;
}

export interface DocumentSharedPayload {
  documentId: string;
  ownerId: string;
  grantedToId: string;
  grantedToType: string;
  permission: string;
}

export interface PatientOnboardingCompletedPayload {
  // JWT `sub` of the patient = users.auth_id in user-provider-service.
  authId: string;
  sessionId: string;
  /**
   * Subject of care the session was about. Absent on events published before
   * sessions carried a profile; the subscriber falls back to the account
   * owner's own profile for those, which is what they meant at the time.
   */
  profileId?: string;
  // The full BackendMatchPayload emitted by the AI onboarding agent (finalize_match).
  finalPayload: Record<string, unknown>;
}

// ── Publisher functions ──

export async function publishRecommendationGenerated(
  payload: RecommendationGeneratedPayload,
  correlationId?: string,
): Promise<void> {
  try {
    await getPublisher().publish(EVENT_NAMES.AI_RECOMMENDATION_GENERATED, payload, correlationId);
    logger.debug(
      { eventType: EVENT_NAMES.AI_RECOMMENDATION_GENERATED, userId: payload.userId },
      'Event published',
    );
  } catch (error) {
    logger.error(
      { error, eventType: EVENT_NAMES.AI_RECOMMENDATION_GENERATED },
      'Failed to publish event',
    );
  }
}

export async function publishAiDocumentGenerated(
  payload: AiDocumentGeneratedPayload,
  correlationId?: string,
): Promise<void> {
  try {
    await getPublisher().publish(EVENT_NAMES.AI_DOCUMENT_GENERATED, payload, correlationId);
    logger.debug(
      { eventType: EVENT_NAMES.AI_DOCUMENT_GENERATED, documentId: payload.documentId },
      'Event published',
    );
  } catch (error) {
    logger.error(
      { error, eventType: EVENT_NAMES.AI_DOCUMENT_GENERATED },
      'Failed to publish event',
    );
  }
}

export async function publishDocumentUploaded(
  payload: DocumentUploadedPayload,
  correlationId?: string,
): Promise<void> {
  try {
    await getPublisher().publish(EVENT_NAMES.DOCUMENT_UPLOADED, payload, correlationId);
    logger.debug(
      { eventType: EVENT_NAMES.DOCUMENT_UPLOADED, documentId: payload.documentId },
      'Event published',
    );
  } catch (error) {
    logger.error({ error, eventType: EVENT_NAMES.DOCUMENT_UPLOADED }, 'Failed to publish event');
  }
}

export async function publishDocumentShared(
  payload: DocumentSharedPayload,
  correlationId?: string,
): Promise<void> {
  try {
    await getPublisher().publish(EVENT_NAMES.DOCUMENT_SHARED, payload, correlationId);
    logger.debug(
      { eventType: EVENT_NAMES.DOCUMENT_SHARED, documentId: payload.documentId },
      'Event published',
    );
  } catch (error) {
    logger.error({ error, eventType: EVENT_NAMES.DOCUMENT_SHARED }, 'Failed to publish event');
  }
}

export async function publishPatientOnboardingCompleted(
  payload: PatientOnboardingCompletedPayload,
  correlationId?: string,
): Promise<void> {
  try {
    await getPublisher().publish(EVENT_NAMES.PATIENT_ONBOARDING_COMPLETED, payload, correlationId);
    logger.debug(
      {
        eventType: EVENT_NAMES.PATIENT_ONBOARDING_COMPLETED,
        authId: payload.authId,
        sessionId: payload.sessionId,
      },
      'Event published',
    );
  } catch (error) {
    logger.error(
      { error, eventType: EVENT_NAMES.PATIENT_ONBOARDING_COMPLETED },
      'Failed to publish event',
    );
  }
}

export async function disconnectPublisher(): Promise<void> {
  if (publisher) {
    await publisher.disconnect();
    publisher = null;
  }
}
