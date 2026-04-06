// ── Auth ──
export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  DEACTIVATED = 'deactivated',
}

export enum UserRole {
  USER = 'user',
  PROVIDER = 'provider',
  ADMIN = 'admin',
}

export enum OAuthProvider {
  GOOGLE = 'google',
}

export enum ConsentType {
  TERMS_OF_SERVICE = 'terms_of_service',
  PRIVACY_POLICY = 'privacy_policy',
  HEALTH_DATA_PROCESSING = 'health_data_processing',
  AI_PROFILING = 'ai_profiling',
  DATA_SHARING_PROVIDERS = 'data_sharing_providers',
  MARKETING_EMAIL = 'marketing_email',
  MARKETING_SMS = 'marketing_sms',
}

// ── Provider ──
export enum ProviderStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  INACTIVE = 'inactive',
}

export enum VerificationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum ProgramStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  ARCHIVED = 'archived',
}

export enum ProductStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  OUT_OF_STOCK = 'out_of_stock',
  ARCHIVED = 'archived',
}

export enum PriceType {
  ONE_TIME = 'one_time',
  PER_SESSION = 'per_session',
  SUBSCRIPTION = 'subscription',
}

export enum DayOfWeek {
  MONDAY = 'monday',
  TUESDAY = 'tuesday',
  WEDNESDAY = 'wednesday',
  THURSDAY = 'thursday',
  FRIDAY = 'friday',
  SATURDAY = 'saturday',
  SUNDAY = 'sunday',
}

// ── Booking ──
export enum BookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

export enum SessionType {
  ONE_ON_ONE = 'one_on_one',
  GROUP = 'group',
  CONSULTATION = 'consultation',
  FOLLOW_UP = 'follow_up',
}

export enum CancelledBy {
  USER = 'user',
  PROVIDER = 'provider',
  SYSTEM = 'system',
}

export enum ReminderType {
  TWENTY_FOUR_HOUR = '24h',
  ONE_HOUR = '1h',
  FIFTEEN_MIN = '15min',
}

export enum NotificationType {
  EMAIL = 'email',
  SMS = 'sms',
  PUSH = 'push',
  IN_APP = 'in_app',
}

export enum NotificationCategory {
  BOOKING = 'booking',
  PAYMENT = 'payment',
  SYSTEM = 'system',
  MARKETING = 'marketing',
  REMINDER = 'reminder',
  DOCUMENT = 'document',
  PROVIDER = 'provider',
  PROGRESS = 'progress',
}

// ── Payment ──
export enum PaymentGateway {
  STRIPE = 'stripe',
  RAZORPAY = 'razorpay',
}

export enum OrderType {
  SESSION = 'session',
  PROGRAM = 'program',
  PRODUCT = 'product',
  SUBSCRIPTION = 'subscription',
}

export enum OrderStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FULFILLED = 'fulfilled',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum SubscriptionStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELLED = 'cancelled',
  PAUSED = 'paused',
}

export enum SubscriptionInterval {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly',
}

export enum RefundStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  PAID = 'paid',
  VOID = 'void',
  OVERDUE = 'overdue',
}

// ── AI ──
export enum AiRequestType {
  RECOMMENDATION = 'recommendation',
  HEALTH_ANALYSIS = 'health_analysis',
  DOCUMENT_GEN = 'document_gen',
  EMBEDDING = 'embedding',
}

export enum AiDocumentType {
  PRESCRIPTION = 'prescription',
  NUTRITION_PLAN = 'nutrition_plan',
  TRAINING_PLAN = 'training_plan',
}

export enum AiDocumentStatus {
  DRAFT = 'draft',
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum DocumentType {
  LAB_REPORT = 'lab_report',
  PRESCRIPTION = 'prescription',
  IMAGING = 'imaging',
  INSURANCE = 'insurance',
  CERTIFICATE = 'certificate',
  OTHER = 'other',
}

export enum DocumentStatus {
  PROCESSING = 'processing',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  DELETED = 'deleted',
}

export enum AccessPermission {
  VIEW = 'view',
  DOWNLOAD = 'download',
}

// ── GDPR ──
export enum GdprErasureStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum DataExportType {
  DSAR = 'dsar',
  PORTABLE = 'portable',
}

export enum DataExportStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  DOWNLOADED = 'downloaded',
  EXPIRED = 'expired',
}

export enum BreachSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// ── Moderation ──
export enum ModerationStatus {
  PENDING = 'pending',
  IN_REVIEW = 'in_review',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

export enum FlagType {
  INAPPROPRIATE = 'inappropriate',
  SPAM = 'spam',
  FAKE = 'fake',
  HARMFUL = 'harmful',
  COPYRIGHT = 'copyright',
  OTHER = 'other',
}

export enum ReviewStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  FLAGGED = 'FLAGGED',
}

// ── Fitness ──
export enum FitnessLevel {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
  ELITE = 'elite',
}

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  NON_BINARY = 'non_binary',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

export enum HabitFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  CUSTOM = 'CUSTOM',
}
