// Re-export event names from @longeny/types
export { EVENT_NAMES } from '@longeny/types';

// Additional convenience constants for event name strings
export const EventNames = {
  // User
  USER_REGISTERED: 'user.registered',
  USER_LOGIN: 'user.login',
  USER_UPDATED: 'user.updated',
  USER_DEACTIVATED: 'user.deactivated',
  USER_GDPR_ERASURE_REQUESTED: 'user.gdpr.erasure.requested',

  // Consent
  CONSENT_GRANTED: 'consent.granted',
  CONSENT_REVOKED: 'consent.revoked',
  CONSENT_CHANGED: 'consent.changed',

  // Provider
  PROVIDER_REGISTERED: 'provider.registered',
  PROVIDER_VERIFIED: 'provider.verified',
  PROVIDER_SUSPENDED: 'provider.suspended',

  // Booking
  BOOKING_CREATED: 'booking.created',
  BOOKING_CONFIRMED: 'booking.confirmed',
  BOOKING_CANCELLED: 'booking.cancelled',
  BOOKING_COMPLETED: 'booking.completed',
  BOOKING_RESCHEDULED: 'booking.rescheduled',
  BOOKING_REMINDER: 'booking.reminder',

  // Payment
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',

  // Subscription
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',

  // Document
  DOCUMENT_GENERATED: 'document.generated',
  DOCUMENT_SHARED: 'document.shared',

  // AI
  AI_RECOMMENDATION_GENERATED: 'ai.recommendation.generated',
} as const;

export type EventName = (typeof EventNames)[keyof typeof EventNames];
