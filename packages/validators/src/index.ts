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
  createBookingSchema,
  cancelBookingSchema,
  rescheduleSchema,
  notificationPreferencesSchema,
} from './booking.js';

// Payment schemas
export {
  createCheckoutSchema,
  createSubscriptionSchema,
  requestRefundSchema,
} from './payment.js';
