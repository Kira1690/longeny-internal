// Event names
export const EVENT_NAMES = {
  // Auth
  USER_REGISTERED: 'user.registered',
  USER_LOGIN: 'user.login',
  USER_PASSWORD_RESET: 'user.password.reset',
  CONSENT_GRANTED: 'consent.granted',
  CONSENT_REVOKED: 'consent.revoked',
  CONSENT_CHANGED: 'consent.changed',
  // User & Provider
  USER_UPDATED: 'user.updated',
  USER_DEACTIVATED: 'user.deactivated',
  PROVIDER_REGISTERED: 'provider.registered',
  PROVIDER_VERIFIED: 'provider.verified',
  PROVIDER_UPDATED: 'provider.updated',
  PROVIDER_PROGRAM_CREATED: 'provider.program.created',
  PROVIDER_PROGRAM_UPDATED: 'provider.program.updated',
  PROVIDER_PRODUCT_CREATED: 'provider.product.created',
  // Booking
  BOOKING_CREATED: 'booking.created',
  BOOKING_CONFIRMED: 'booking.confirmed',
  BOOKING_CANCELLED: 'booking.cancelled',
  BOOKING_COMPLETED: 'booking.completed',
  BOOKING_REMINDER_DUE: 'booking.reminder.due',
  // Payment
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  REFUND_PROCESSED: 'refund.processed',
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  // AI & Content
  AI_RECOMMENDATION_GENERATED: 'ai.recommendation.generated',
  AI_DOCUMENT_GENERATED: 'ai.document.generated',
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_SHARED: 'document.shared',
  // GDPR
  GDPR_ERASURE_REQUESTED: 'user.gdpr.erasure.requested',
  GDPR_EXPORT_READY: 'user.gdpr.export.ready',
} as const;

// Event envelope
export interface EventEnvelope<T = unknown> {
  eventType: string;
  payload: T;
  timestamp: string;
  correlationId: string;
  source: string;
}

// Event handler type
export type EventHandler<T = unknown> = (event: EventEnvelope<T>) => Promise<void>;
