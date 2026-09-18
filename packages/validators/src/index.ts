// Common schemas
export {
  uuidSchema,
  emailSchema,
  passwordSchema,
  phoneSchema,
  paginationSchema,
} from './common.js';

// Auth schemas
export {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  consentSchema,
  googleAuthSchema,
} from './auth.js';

// User & Provider schemas
export {
  updateProfileSchema,
  healthProfileSchema,
  onboardingSchema,
  preferencesSchema,
  providerRegisterSchema,
  programSchema,
  productSchema,
  availabilityRuleSchema,
  reviewSchema,
  habitSchema,
  habitCheckinSchema,
  progressEntrySchema,
} from './user.js';

// Booking schemas
export {
  calendarInviteSchema,
  createBookingSchema,
  cancelBookingSchema,
  rescheduleSchema,
  updateBookingSchema,
  notificationPreferencesSchema,
  registerPushTokenSchema,
} from './booking.js';

// Payment schemas
export {
  createCheckoutSchema,
  createSubscriptionSchema,
  requestRefundSchema,
  createOrderSchema,
  payOrderSchema,
  createPaymentIntentSchema,
  createSetupIntentSchema,
  updateSubscriptionSchema,
  cancelSubscriptionSchema,
} from './payment.js';

// RRO intake — one shape, shared by the endpoint and the classifier contract
export { intakeSchema, submitIntakeSchema, isEmptyIntake } from './intake.js';
export type { Intake, SubmitIntake } from './intake.js';

// RRO AI contracts (plan item A6) — the boundary between backend and model
export {
  RRO_CONTRACT_VERSION,
  RRO_GUARDRAILS,
  RRO_MIN_CLASSIFIER_CONFIDENCE,
  mayTransitionState,
  rroClassifierInputSchema,
  rroClassifierOutputSchema,
  rroClassifierResponseSchema,
  rroRefusalSchema,
  rroSummaryInputSchema,
  rroSummaryOutputSchema,
  rroSummaryResponseSchema,
} from './rro-ai.js';
export type {
  RroClassifierInput,
  RroClassifierOutput,
  RroRefusal,
  RroSummaryInput,
  RroSummaryOutput,
} from './rro-ai.js';

// Biomarker readings — values typed in from a lab report
export {
  correctReadingSchema,
  markerCodeSchema,
  readingEntrySchema,
  submitReadingsSchema,
} from './readings.js';
export type { CorrectReading, ReadingEntry, SubmitReadings } from './readings.js';

// Document upload — the declaration signed into the presigned upload link
export {
  DOCUMENT_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOAD_MIME_TYPES,
  uploadDocumentSchema,
} from './documents.js';
export type { UploadDocument } from './documents.js';

// Report extraction — what a model proposes from a lab report
export {
  READING_EXTRACTION_CONTRACT,
  extractedReadingSchema,
  readingExtractionOutputSchema,
} from './readings-extraction.js';
export type { ExtractedReading, ReadingExtractionOutput } from './readings-extraction.js';
