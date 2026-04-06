// Event payload interfaces for each event type

// ── User Events ──

export interface UserRegisteredPayload {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  registeredAt: string;
}

export interface UserLoginPayload {
  userId: string;
  email: string;
  ipAddress: string;
  userAgent?: string;
  loginAt: string;
}

export interface UserUpdatedPayload {
  userId: string;
  updatedFields: string[];
  updatedAt: string;
}

export interface UserDeactivatedPayload {
  userId: string;
  email: string;
  reason?: string;
  deactivatedAt: string;
}

export interface UserGdprErasureRequestedPayload {
  userId: string;
  email: string;
  requestedAt: string;
}

// ── Consent Events ──

export interface ConsentGrantedPayload {
  userId: string;
  consentType: string;
  version: string;
  grantedAt: string;
}

export interface ConsentRevokedPayload {
  userId: string;
  consentType: string;
  revokedAt: string;
}

export interface ConsentChangedPayload {
  userId: string;
  consentType: string;
  previousVersion?: string;
  newVersion: string;
  changedAt: string;
}

// ── Provider Events ──

export interface ProviderRegisteredPayload {
  providerId: string;
  userId: string;
  businessName: string;
  registeredAt: string;
}

export interface ProviderVerifiedPayload {
  providerId: string;
  verifiedAt: string;
}

export interface ProviderSuspendedPayload {
  providerId: string;
  reason: string;
  suspendedAt: string;
}

// ── Booking Events ──

export interface BookingCreatedPayload {
  bookingId: string;
  userId: string;
  providerId: string;
  programId?: string;
  scheduledAt: string;
  createdAt: string;
}

export interface BookingConfirmedPayload {
  bookingId: string;
  userId: string;
  providerId: string;
  confirmedAt: string;
}

export interface BookingCancelledPayload {
  bookingId: string;
  userId: string;
  providerId: string;
  cancelledBy: string;
  reason?: string;
  cancelledAt: string;
}

export interface BookingCompletedPayload {
  bookingId: string;
  userId: string;
  providerId: string;
  completedAt: string;
}

export interface BookingRescheduledPayload {
  bookingId: string;
  userId: string;
  providerId: string;
  previousScheduledAt: string;
  newScheduledAt: string;
  rescheduledAt: string;
}

export interface BookingReminderPayload {
  bookingId: string;
  userId: string;
  providerId: string;
  scheduledAt: string;
  reminderType: string;
}

// ── Payment Events ──

export interface PaymentCompletedPayload {
  paymentId: string;
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  gateway: string;
  completedAt: string;
}

export interface PaymentFailedPayload {
  paymentId: string;
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  gateway: string;
  failureReason: string;
  failedAt: string;
}

export interface PaymentRefundedPayload {
  paymentId: string;
  orderId: string;
  userId: string;
  refundAmount: number;
  currency: string;
  reason?: string;
  refundedAt: string;
}

// ── Subscription Events ──

export interface SubscriptionCreatedPayload {
  subscriptionId: string;
  userId: string;
  planId: string;
  interval: string;
  amount: number;
  currency: string;
  createdAt: string;
}

export interface SubscriptionCancelledPayload {
  subscriptionId: string;
  userId: string;
  reason?: string;
  cancelledAt: string;
}

// ── Document Events ──

export interface DocumentGeneratedPayload {
  documentId: string;
  userId: string;
  documentType: string;
  generatedAt: string;
}

export interface DocumentSharedPayload {
  documentId: string;
  sharedBy: string;
  sharedWith: string;
  permission: string;
  sharedAt: string;
}

// ── AI Events ──

export interface AiRecommendationGeneratedPayload {
  recommendationId: string;
  userId: string;
  recommendationType: string;
  resultCount: number;
  generatedAt: string;
}
