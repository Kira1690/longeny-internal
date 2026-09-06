import type { NotificationChannel, ProfileRelation, RroState } from '@longeny/types';
import {
  boolean,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────
// Enums — User Module
// ─────────────────────────────────────────────────────────────

export const userStatusEnum = pgEnum('user_status', [
  'active',
  'inactive',
  'suspended',
  'deactivated',
]);
export const genderEnum = pgEnum('gender', ['male', 'female', 'non_binary', 'prefer_not_to_say']);
export const fitnessLevelEnum = pgEnum('fitness_level', [
  'beginner',
  'intermediate',
  'advanced',
  'elite',
]);

// ─────────────────────────────────────────────────────────────
// Enums — Provider Module
// ─────────────────────────────────────────────────────────────

export const providerStatusEnum = pgEnum('provider_status', [
  'pending',
  'verified',
  'suspended',
  'rejected',
  'deactivated',
]);
export const verificationStatusEnum = pgEnum('verification_status', [
  'pending',
  'approved',
  'rejected',
]);
export const programStatusEnum = pgEnum('program_status', [
  'draft',
  'active',
  'paused',
  'archived',
]);
export const productStatusEnum = pgEnum('product_status', [
  'draft',
  'active',
  'out_of_stock',
  'archived',
]);
export const priceTypeEnum = pgEnum('price_type', [
  'one_time',
  'subscription_monthly',
  'subscription_yearly',
  'per_session',
  'free',
]);
export const dayOfWeekEnum = pgEnum('day_of_week', [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

// ─────────────────────────────────────────────────────────────
// Enums — Provider Onboarding Module
// ─────────────────────────────────────────────────────────────

export const onboardingStatusEnum = pgEnum('onboarding_status', [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
]);

export const sectionStatusEnum = pgEnum('section_status', [
  'not_started',
  'in_progress',
  'completed',
]);

// ─────────────────────────────────────────────────────────────
// Enums — Marketplace Module
// ─────────────────────────────────────────────────────────────

export const entityTypeEnum = pgEnum('entity_type', ['provider', 'program', 'product']);
export const listingStatusEnum = pgEnum('listing_status', [
  'active',
  'inactive',
  'featured',
  'archived',
]);

// ─────────────────────────────────────────────────────────────
// Enums — Admin Module
// ─────────────────────────────────────────────────────────────

export const adminActionTypeEnum = pgEnum('admin_action_type', [
  'verify_provider',
  'suspend_provider',
  'reactivate_provider',
  'suspend_user',
  'reactivate_user',
  'delete_user',
  'moderate_content',
  'update_settings',
  'export_data',
  'approve_refund',
  'reject_refund',
]);
export const moderationStatusEnum = pgEnum('moderation_status', [
  'pending',
  'approved',
  'rejected',
  'escalated',
]);
export const flagTypeEnum = pgEnum('flag_type', [
  'inappropriate',
  'spam',
  'fake',
  'harmful',
  'copyright',
  'other',
]);
export const flagStatusEnum = pgEnum('flag_status', ['open', 'reviewing', 'resolved', 'dismissed']);

// ─────────────────────────────────────────────────────────────
// Enums — Progress Module
// ─────────────────────────────────────────────────────────────

export const metricTypeEnum = pgEnum('metric_type', [
  'weight',
  'steps',
  'sleep_hours',
  'water_oz',
  'calories',
  'mood',
  'energy',
  'stress',
  'custom',
]);
export const habitFrequencyEnum = pgEnum('habit_frequency', ['DAILY', 'WEEKLY', 'CUSTOM']);
export const reviewTargetTypeEnum = pgEnum('review_target_type', [
  'PROVIDER',
  'PROGRAM',
  'PRODUCT',
]);
export const reviewStatusEnum = pgEnum('review_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'FLAGGED',
]);
export const goalStatusEnum = pgEnum('goal_status', [
  'pending',
  'in_progress',
  'completed',
  'abandoned',
]);
export const reminderCategoryEnum = pgEnum('reminder_category', [
  'habit',
  'goal',
  'wellness',
  'custom',
]);

// ─────────────────────────────────────────────────────────────
// Enums — GDPR Module
// ─────────────────────────────────────────────────────────────

export const erasureStatusEnum = pgEnum('erasure_status', [
  'pending',
  'processing',
  'completed',
  'cancelled',
]);
export const exportTypeEnum = pgEnum('export_type', ['dsar', 'portable']);
export const exportStatusEnum = pgEnum('export_status', [
  'pending',
  'processing',
  'completed',
  'failed',
  'expired',
]);
export const breachSeverityEnum = pgEnum('breach_severity', ['low', 'medium', 'high', 'critical']);
export const remediationStatusEnum = pgEnum('remediation_status', [
  'investigating',
  'contained',
  'remediated',
  'closed',
]);

// ─────────────────────────────────────────────────────────────
// Tables — User Module
// ─────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  auth_id: uuid('auth_id').notNull().unique(),
  email: text('email').notNull().unique(),
  first_name: varchar('first_name', { length: 100 }).notNull(),
  last_name: varchar('last_name', { length: 100 }).notNull(),
  phone_encrypted: text('phone_encrypted'),
  // Keyed HMAC-SHA256 of the phone number — see services/lookup-hash.ts.
  phone_hash: text('phone_hash'),
  avatar_url: text('avatar_url'),
  date_of_birth_encrypted: text('date_of_birth_encrypted'),
  gender: genderEnum('gender'),
  timezone: varchar('timezone', { length: 50 }).default('America/New_York').notNull(),
  status: userStatusEnum('status').default('active').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const user_profiles = pgTable('user_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().unique(),
  bio: text('bio'),
  address_encrypted: text('address_encrypted'),
  country: varchar('country', { length: 2 }).default('US').notNull(),
  health_goals: jsonb('health_goals').default([]).notNull(),
  dietary_preferences: jsonb('dietary_preferences').default([]).notNull(),
  fitness_level: fitnessLevelEnum('fitness_level'),
  wellness_interests: jsonb('wellness_interests').default([]).notNull(),
  preferred_session_type: varchar('preferred_session_type', { length: 50 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const health_profiles = pgTable('health_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().unique(),
  profile_id: uuid('profile_id'), // RRO scoping — null = account owner's self record
  height_cm: decimal('height_cm', { precision: 5, scale: 1 }),
  weight_kg: decimal('weight_kg', { precision: 5, scale: 1 }),
  blood_type: varchar('blood_type', { length: 5 }),
  allergies_encrypted: text('allergies_encrypted'),
  medical_conditions_encrypted: text('medical_conditions_encrypted'),
  medications_encrypted: text('medications_encrypted'),
  emergency_contact_encrypted: text('emergency_contact_encrypted'),
  notes: text('notes'),
  last_checkup_date: date('last_checkup_date'),
  consent_health_sharing: boolean('consent_health_sharing').default(false).notNull(),
  consent_ai_analysis: boolean('consent_ai_analysis').default(false).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const onboarding_state = pgTable(
  'onboarding_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Not unique on its own any more: one paying account now holds one intake
    // per subject of care. The account-wide unique made the second profile's
    // first save fail with a constraint violation instead of creating its row.
    user_id: uuid('user_id').notNull(),
    profile_id: uuid('profile_id'), // RRO scoping — null = account owner's self record
    current_step: integer('current_step').default(1).notNull(),
    total_steps: integer('total_steps').default(5).notNull(),
    completed_steps: jsonb('completed_steps').default([]).notNull(),
    step_data: jsonb('step_data').default({}).notNull(),
    is_completed: boolean('is_completed').default(false).notNull(),
    started_at: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('onboarding_state_profile_idx').on(table.profile_id),
    // Postgres treats NULLs as distinct, so this does not constrain rows left
    // unscoped by the backfill. Every write in the onboarding path sets profile_id.
    unique('onboarding_state_user_profile_unique').on(table.user_id, table.profile_id),
  ],
);

export const user_preferences = pgTable('user_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().unique(),
  notification_email: boolean('notification_email').default(false).notNull(),
  notification_sms: boolean('notification_sms').default(false).notNull(),
  notification_push: boolean('notification_push').default(false).notNull(),
  language: varchar('language', { length: 5 }).default('en').notNull(),
  theme: varchar('theme', { length: 10 }).default('light').notNull(),
  newsletter: boolean('newsletter').default(false).notNull(),
  booking_reminders_hours: integer('booking_reminders_hours').default(24).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// Tables — Provider Module
// ─────────────────────────────────────────────────────────────

export const provider_categories = pgTable('provider_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  description: text('description'),
  parent_id: uuid('parent_id'),
  icon_url: text('icon_url'),
  sort_order: integer('sort_order').default(0).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const specialties = pgTable('specialties', {
  id: uuid('id').primaryKey().defaultRandom(),
  category_id: uuid('category_id'),
  name: varchar('name', { length: 100 }).notNull().unique(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().unique(),
  business_name: varchar('business_name', { length: 200 }).notNull(),
  display_name: varchar('display_name', { length: 200 }),
  bio: text('bio'),
  specialties: jsonb('specialties').default([]).notNull(),
  credentials: jsonb('credentials').default([]).notNull(),
  years_experience: integer('years_experience'),
  hourly_rate: decimal('hourly_rate', { precision: 8, scale: 2 }),
  currency: varchar('currency', { length: 3 }).default('USD').notNull(),
  location: jsonb('location'),
  service_area_radius_miles: integer('service_area_radius_miles'),
  offers_virtual: boolean('offers_virtual').default(true).notNull(),
  offers_in_person: boolean('offers_in_person').default(false).notNull(),
  status: providerStatusEnum('status').default('pending').notNull(),
  rating_avg: decimal('rating_avg', { precision: 3, scale: 2 }).default('0').notNull(),
  review_count: integer('review_count').default(0).notNull(),
  total_bookings: integer('total_bookings').default(0).notNull(),
  website_url: text('website_url'),
  social_links: jsonb('social_links'),
  cancellation_policy: text('cancellation_policy'),
  cancellation_hours: integer('cancellation_hours').default(24).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const provider_verification = pgTable('provider_verification', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider_id: uuid('provider_id').notNull(),
  document_type: varchar('document_type', { length: 50 }).notNull(),
  document_url: text('document_url').notNull(),
  status: verificationStatusEnum('status').default('pending').notNull(),
  reviewer_id: uuid('reviewer_id'),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const programs = pgTable('programs', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider_id: uuid('provider_id').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').notNull(),
  short_description: varchar('short_description', { length: 500 }),
  category: varchar('category', { length: 100 }).notNull(),
  subcategory: varchar('subcategory', { length: 100 }),
  duration_weeks: integer('duration_weeks'),
  session_count: integer('session_count'),
  session_duration_minutes: integer('session_duration_minutes').default(60).notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  price_type: priceTypeEnum('price_type').default('one_time').notNull(),
  max_participants: integer('max_participants'),
  current_participants: integer('current_participants').default(0).notNull(),
  prerequisites: text('prerequisites'),
  what_to_expect: text('what_to_expect'),
  outcomes: jsonb('outcomes'),
  tags: jsonb('tags').default([]).notNull(),
  image_url: text('image_url'),
  is_featured: boolean('is_featured').default(false).notNull(),
  status: programStatusEnum('status').default('draft').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider_id: uuid('provider_id').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').notNull(),
  short_description: varchar('short_description', { length: 500 }),
  category: varchar('category', { length: 100 }).notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  compare_at_price: decimal('compare_at_price', { precision: 10, scale: 2 }),
  inventory_count: integer('inventory_count').default(0).notNull(),
  sku: varchar('sku', { length: 50 }),
  image_urls: jsonb('image_urls').default([]).notNull(),
  tags: jsonb('tags').default([]).notNull(),
  attributes: jsonb('attributes'),
  is_digital: boolean('is_digital').default(false).notNull(),
  digital_file_url: text('digital_file_url'),
  status: productStatusEnum('status').default('draft').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const availability_rules = pgTable('availability_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider_id: uuid('provider_id').notNull(),
  day_of_week: dayOfWeekEnum('day_of_week').notNull(),
  start_time: time('start_time').notNull(),
  end_time: time('end_time').notNull(),
  timezone: varchar('timezone', { length: 50 }).default('America/New_York').notNull(),
  slot_duration_minutes: integer('slot_duration_minutes').default(60).notNull(),
  buffer_minutes: integer('buffer_minutes').default(15).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const availability_overrides = pgTable('availability_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider_id: uuid('provider_id').notNull(),
  date: date('date').notNull(),
  start_time: time('start_time'),
  end_time: time('end_time'),
  is_blocked: boolean('is_blocked').default(false).notNull(),
  reason: varchar('reason', { length: 200 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// Tables — Provider Onboarding Module
// ─────────────────────────────────────────────────────────────

export const provider_onboarding = pgTable('provider_onboarding', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider_id: uuid('provider_id').notNull().unique(),
  status: onboardingStatusEnum('status').default('draft').notNull(),

  basic_identity: jsonb('basic_identity'),
  basic_identity_status: sectionStatusEnum('basic_identity_status')
    .default('not_started')
    .notNull(),
  professional_credentials: jsonb('professional_credentials'),
  professional_credentials_status: sectionStatusEnum('professional_credentials_status')
    .default('not_started')
    .notNull(),
  license_verification: jsonb('license_verification'),
  license_verification_status: sectionStatusEnum('license_verification_status')
    .default('not_started')
    .notNull(),
  practice_services: jsonb('practice_services'),
  practice_services_status: sectionStatusEnum('practice_services_status')
    .default('not_started')
    .notNull(),
  scheduling_setup: jsonb('scheduling_setup'),
  scheduling_setup_status: sectionStatusEnum('scheduling_setup_status')
    .default('not_started')
    .notNull(),
  marketplace_profile: jsonb('marketplace_profile'),
  marketplace_profile_status: sectionStatusEnum('marketplace_profile_status')
    .default('not_started')
    .notNull(),
  banking_commercial: jsonb('banking_commercial'),
  banking_commercial_status: sectionStatusEnum('banking_commercial_status')
    .default('not_started')
    .notNull(),
  platform_readiness: jsonb('platform_readiness'),
  platform_readiness_status: sectionStatusEnum('platform_readiness_status')
    .default('not_started')
    .notNull(),
  document_capability: jsonb('document_capability'),
  document_capability_status: sectionStatusEnum('document_capability_status')
    .default('not_started')
    .notNull(),
  compliance_consents: jsonb('compliance_consents'),
  compliance_consents_status: sectionStatusEnum('compliance_consents_status')
    .default('not_started')
    .notNull(),
  legal_declarations: jsonb('legal_declarations'),
  legal_declarations_status: sectionStatusEnum('legal_declarations_status')
    .default('not_started')
    .notNull(),
  trust_layer: jsonb('trust_layer'),
  trust_layer_status: sectionStatusEnum('trust_layer_status').default('not_started').notNull(),

  completed_sections: integer('completed_sections').default(0).notNull(),
  total_sections: integer('total_sections').default(12).notNull(),
  submitted_at: timestamp('submitted_at', { withTimezone: true }),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  reviewer_notes: text('reviewer_notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const provider_admin_checks = pgTable('provider_admin_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider_id: uuid('provider_id').notNull(),
  onboarding_id: uuid('onboarding_id').notNull(),
  check_key: varchar('check_key', { length: 50 }).notNull(),
  is_checked: boolean('is_checked').default(false).notNull(),
  checked_by: uuid('checked_by'),
  checked_at: timestamp('checked_at', { withTimezone: true }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// Tables — Marketplace Module
// ─────────────────────────────────────────────────────────────

export const search_index = pgTable('search_index', {
  id: uuid('id').primaryKey().defaultRandom(),
  entity_type: entityTypeEnum('entity_type').notNull(),
  entity_id: uuid('entity_id').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }),
  subcategory: varchar('subcategory', { length: 100 }),
  tags: jsonb('tags').default([]).notNull(),
  specialties: jsonb('specialties').default([]).notNull(),
  location_city: varchar('location_city', { length: 100 }),
  location_state: varchar('location_state', { length: 50 }),
  location_lat: decimal('location_lat', { precision: 10, scale: 7 }),
  location_lng: decimal('location_lng', { precision: 10, scale: 7 }),
  price_min: decimal('price_min', { precision: 10, scale: 2 }),
  price_max: decimal('price_max', { precision: 10, scale: 2 }),
  rating_avg: decimal('rating_avg', { precision: 3, scale: 2 }).default('0').notNull(),
  review_count: integer('review_count').default(0).notNull(),
  provider_id: uuid('provider_id'),
  provider_name: varchar('provider_name', { length: 200 }),
  provider_verified: boolean('provider_verified').default(false).notNull(),
  offers_virtual: boolean('offers_virtual').default(false).notNull(),
  offers_in_person: boolean('offers_in_person').default(false).notNull(),
  ai_relevance_score: decimal('ai_relevance_score', { precision: 5, scale: 4 }),
  popularity_score: integer('popularity_score').default(0).notNull(),
  image_url: text('image_url'),
  status: listingStatusEnum('status').default('active').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const featured_listings = pgTable('featured_listings', {
  id: uuid('id').primaryKey().defaultRandom(),
  entity_type: entityTypeEnum('entity_type').notNull(),
  entity_id: uuid('entity_id').notNull(),
  position: integer('position').default(0).notNull(),
  start_date: date('start_date').notNull(),
  end_date: date('end_date').notNull(),
  status: listingStatusEnum('status').default('active').notNull(),
  created_by: uuid('created_by'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  description: text('description'),
  parent_id: uuid('parent_id'),
  icon_url: text('icon_url'),
  listing_count: integer('listing_count').default(0).notNull(),
  sort_order: integer('sort_order').default(0).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const saved_items = pgTable('saved_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  entity_type: entityTypeEnum('entity_type').notNull(),
  entity_id: uuid('entity_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// Tables — Admin Module
// ─────────────────────────────────────────────────────────────

export const admin_actions = pgTable('admin_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  admin_id: uuid('admin_id').notNull(),
  action_type: adminActionTypeEnum('action_type').notNull(),
  target_type: varchar('target_type', { length: 50 }).notNull(),
  target_id: uuid('target_id').notNull(),
  details: jsonb('details'),
  reason: text('reason'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const moderation_queue = pgTable('moderation_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  entity_type: varchar('entity_type', { length: 50 }).notNull(),
  entity_id: uuid('entity_id').notNull(),
  reason: text('reason').notNull(),
  reported_by: uuid('reported_by'),
  auto_flagged: boolean('auto_flagged').default(false).notNull(),
  auto_flag_source: varchar('auto_flag_source', { length: 50 }),
  priority: integer('priority').default(5).notNull(),
  status: moderationStatusEnum('status').default('pending').notNull(),
  assigned_to: uuid('assigned_to'),
  reviewed_by: uuid('reviewed_by'),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  review_notes: text('review_notes'),
  action_taken: varchar('action_taken', { length: 100 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const platform_settings = pgTable('platform_settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  description: text('description'),
  is_sensitive: boolean('is_sensitive').default(false).notNull(),
  updated_by: uuid('updated_by'),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const analytics_snapshots = pgTable('analytics_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  metric_type: varchar('metric_type', { length: 100 }).notNull(),
  metric_value: decimal('metric_value', { precision: 15, scale: 2 }).notNull(),
  dimensions: jsonb('dimensions'),
  period_start: timestamp('period_start', { withTimezone: true }).notNull(),
  period_end: timestamp('period_end', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const content_flags = pgTable('content_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  entity_type: varchar('entity_type', { length: 50 }).notNull(),
  entity_id: uuid('entity_id').notNull(),
  flag_type: flagTypeEnum('flag_type').notNull(),
  description: text('description'),
  reported_by: uuid('reported_by').notNull(),
  evidence_urls: jsonb('evidence_urls'),
  status: flagStatusEnum('status').default('open').notNull(),
  resolved_by: uuid('resolved_by'),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  resolution_notes: text('resolution_notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// Tables — Progress Module
// ─────────────────────────────────────────────────────────────

export const progress_entries = pgTable(
  'progress_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id').notNull(),
    profile_id: uuid('profile_id'), // RRO scoping — null = account owner's self record
    type: metricTypeEnum('type').notNull(),
    metric: varchar('metric', { length: 100 }),
    value: real('value').notNull(),
    unit: varchar('unit', { length: 20 }),
    notes: text('notes'),
    date: date('date').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('progress_entries_profile_idx').on(table.profile_id, table.date)],
);

export const habits = pgTable(
  'habits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id').notNull(),
    profile_id: uuid('profile_id'), // RRO scoping — null = account owner's self record
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    category: varchar('category', { length: 50 }),
    frequency: habitFrequencyEnum('frequency').default('DAILY').notNull(),
    target_count: integer('target_count').default(1).notNull(),
    unit: varchar('unit', { length: 20 }),
    reminder_time: time('reminder_time'),
    is_active: boolean('is_active').default(true).notNull(),
    streak: integer('streak').default(0).notNull(),
    longest_streak: integer('longest_streak').default(0).notNull(),
    total_completions: integer('total_completions').default(0).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('habits_profile_idx').on(table.profile_id)],
);

export const habit_checkins = pgTable(
  'habit_checkins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    habit_id: uuid('habit_id').notNull(),
    user_id: uuid('user_id').notNull(),
    profile_id: uuid('profile_id'), // RRO scoping — null = account owner's self record
    date: date('date').notNull(),
    count: integer('count').default(1).notNull(),
    completed: boolean('completed').default(true).notNull(),
    notes: text('notes'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Denormalised from the parent habit so a per-profile, per-day count is one
  // indexed predicate rather than an IN (…) over every habit the profile owns.
  (table) => [index('habit_checkins_profile_idx').on(table.profile_id, table.date)],
);

export const achievements = pgTable('achievements', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  type: varchar('type', { length: 100 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  icon: varchar('icon', { length: 50 }),
  earned_at: timestamp('earned_at', { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb('metadata'),
});

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  target_type: reviewTargetTypeEnum('target_type').notNull(),
  target_id: uuid('target_id').notNull(),
  rating: integer('rating').notNull(),
  title: varchar('title', { length: 200 }),
  comment: text('comment'),
  is_verified: boolean('is_verified').default(false).notNull(),
  is_moderated: boolean('is_moderated').default(false).notNull(),
  moderated_by: uuid('moderated_by'),
  moderated_at: timestamp('moderated_at', { withTimezone: true }),
  status: reviewStatusEnum('status').default('PENDING').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const review_responses = pgTable('review_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  review_id: uuid('review_id').notNull().unique(),
  provider_id: uuid('provider_id').notNull(),
  response_text: text('response_text').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const review_helpful_votes = pgTable('review_helpful_votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  review_id: uuid('review_id').notNull(),
  user_id: uuid('user_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// Tables — GDPR Module
// ─────────────────────────────────────────────────────────────

export const gdpr_erasure_requests = pgTable('gdpr_erasure_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  status: erasureStatusEnum('status').default('pending').notNull(),
  requested_at: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  grace_period_ends: timestamp('grace_period_ends', { withTimezone: true }).notNull(),
  services_completed: jsonb('services_completed').default({}).notNull(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const data_export_requests = pgTable('data_export_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  export_type: exportTypeEnum('export_type').notNull(),
  status: exportStatusEnum('status').default('pending').notNull(),
  requested_at: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  file_url: text('file_url'),
  file_key: text('file_key'),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  downloaded_at: timestamp('downloaded_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const data_breach_register = pgTable('data_breach_register', {
  id: uuid('id').primaryKey().defaultRandom(),
  breach_type: varchar('breach_type', { length: 100 }).notNull(),
  severity: breachSeverityEnum('severity').notNull(),
  description: text('description').notNull(),
  detected_at: timestamp('detected_at', { withTimezone: true }).notNull(),
  data_categories_affected: jsonb('data_categories_affected').notNull(),
  estimated_users_affected: integer('estimated_users_affected').default(0).notNull(),
  containment_actions: text('containment_actions'),
  dpa_notified: boolean('dpa_notified').default(false).notNull(),
  dpa_notified_at: timestamp('dpa_notified_at', { withTimezone: true }),
  users_notified: boolean('users_notified').default(false).notNull(),
  users_notified_at: timestamp('users_notified_at', { withTimezone: true }),
  remediation_status: remediationStatusEnum('remediation_status')
    .default('investigating')
    .notNull(),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  post_mortem_url: text('post_mortem_url'),
  reported_by: uuid('reported_by'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// Tables — Goals, Engagement & Misc
// ─────────────────────────────────────────────────────────────

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id').notNull(),
    profile_id: uuid('profile_id'), // RRO scoping — null = account owner's self record
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    target_value: decimal('target_value', { precision: 10, scale: 2 }),
    current_value: decimal('current_value', { precision: 10, scale: 2 }).default('0').notNull(),
    unit: varchar('unit', { length: 50 }),
    category: varchar('category', { length: 100 }),
    status: goalStatusEnum('status').default('pending').notNull(),
    start_date: date('start_date').notNull(),
    target_date: date('target_date'),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('goals_profile_idx').on(table.profile_id)],
);

export const engagement_scores = pgTable('engagement_scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  score: decimal('score', { precision: 5, scale: 2 }).notNull(),
  login_count: integer('login_count').default(0).notNull(),
  booking_count: integer('booking_count').default(0).notNull(),
  progress_count: integer('progress_count').default(0).notNull(),
  last_active_at: timestamp('last_active_at', { withTimezone: true }).notNull(),
  calculated_at: timestamp('calculated_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const reminders = pgTable('reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  message: text('message'),
  reminder_type: reminderCategoryEnum('reminder_type').notNull(),
  related_id: uuid('related_id'),
  scheduled_at: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  sent_at: timestamp('sent_at', { withTimezone: true }),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const search_history = pgTable('search_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  query: varchar('query', { length: 500 }).notNull(),
  filters: jsonb('filters').default({}).notNull(),
  results_count: integer('results_count').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const processed_events = pgTable('processed_events', {
  event_id: uuid('event_id').primaryKey(),
  event_type: varchar('event_type', { length: 100 }).notNull(),
  processed_at: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// Enums — Multi-Profile / Family (RRO) Module
// ─────────────────────────────────────────────────────────────

export const profileRelationEnum = pgEnum('profile_relation', [
  'self',
  'father',
  'mother',
  'spouse',
  'child',
  'sibling',
  'other',
]);
export const profileStatusEnum = pgEnum('profile_status', ['active', 'inactive']);
// The Postgres type name must not collide with the rro_state TABLE — Postgres
// creates a composite type per table. Values come from the shared taxonomy so a
// state cannot be added to the model without reaching the database.
export const rroStateEnum = pgEnum('rro_state_value', ['intake', 'reverse', 'restore', 'optimise']);
export const consentStatusEnum = pgEnum('caregiver_consent_status', ['granted', 'revoked']);
export const notificationChannelEnum = pgEnum('notification_channel', ['sms', 'email', 'calendar']);
export const notificationStatusEnum = pgEnum('notification_status', ['queued', 'sent', 'failed']);

// ── Taxonomy drift guard ─────────────────────────────────────────────────────
// The values above are literals on purpose: drizzle-kit loads this file through
// a CJS require, and a runtime import from @longeny/types breaks migration
// generation. These assertions fail to compile if a database enum and the
// shared taxonomy ever disagree, which is the drift the literals would
// otherwise allow.
// Checked in both directions: one alone would allow the database to hold a
// value the taxonomy does not know, or the taxonomy to grow one the database
// cannot store.
type MustExtend<Sub extends Super, Super> = Sub;

type _DbStatesInTaxonomy = MustExtend<(typeof rroStateEnum.enumValues)[number], RroState>;
type _TaxonomyStatesInDb = MustExtend<RroState, (typeof rroStateEnum.enumValues)[number]>;

type _DbRelationsInTaxonomy = MustExtend<
  (typeof profileRelationEnum.enumValues)[number],
  ProfileRelation
>;
type _TaxonomyRelationsInDb = MustExtend<
  ProfileRelation,
  (typeof profileRelationEnum.enumValues)[number]
>;

type _DbChannelsInTaxonomy = MustExtend<
  (typeof notificationChannelEnum.enumValues)[number],
  NotificationChannel
>;
type _TaxonomyChannelsInDb = MustExtend<
  NotificationChannel,
  (typeof notificationChannelEnum.enumValues)[number]
>;

// ─────────────────────────────────────────────────────────────
// Tables — Multi-Profile / Family (RRO) Module
//
// One authenticated account (users row) owns many profiles. A profile is the
// SUBJECT of care (self, a parent, a child). Parent profiles have NO login /
// credentials — they receive care indirectly and are reached only via
// notification_targets (SMS / email / calendar). All health data is scoped by
// profile_id; a null profile_id on legacy user-scoped rows means "the account
// owner's own (self) record".
// ─────────────────────────────────────────────────────────────

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Owning authenticated account (users.id — the main/actor user).
    account_user_id: uuid('account_user_id').notNull(),
    relation: profileRelationEnum('relation').notNull(),
    is_self: boolean('is_self').default(false).notNull(),
    first_name: varchar('first_name', { length: 100 }).notNull(),
    last_name: varchar('last_name', { length: 100 }),
    // Parent/dependent contact — no auth account, reached via these + notification_targets.
    email: text('email'),
    phone_encrypted: text('phone_encrypted'),
    // Keyed HMAC-SHA256 of the phone number, never the number itself — see
    // services/lookup-hash.ts. Deterministic so a lookup needs no decryption;
    // keyed so a dump of this column is not a rainbow table away from plaintext.
    phone_hash: text('phone_hash'),
    date_of_birth_encrypted: text('date_of_birth_encrypted'),
    gender: genderEnum('gender'),
    avatar_url: text('avatar_url'),
    notes: text('notes'),
    status: profileStatusEnum('status').default('active').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('profiles_account_idx').on(table.account_user_id),
    index('profiles_account_status_idx').on(table.account_user_id, table.status),
  ],
);

export const caregiver_consent = pgTable(
  'caregiver_consent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_id: uuid('profile_id').notNull(),
    // The account that granted consent on the profile's behalf (users.id).
    account_user_id: uuid('account_user_id').notNull(),
    // e.g. 'health_data' | 'ai_analysis' | 'care_coordination' | 'notifications'
    consent_type: varchar('consent_type', { length: 100 }).notNull(),
    status: consentStatusEnum('status').default('granted').notNull(),
    granted_by: uuid('granted_by').notNull(),
    granted_at: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    document_url: text('document_url'),
    notes: text('notes'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('caregiver_consent_profile_idx').on(table.profile_id),
    index('caregiver_consent_account_idx').on(table.account_user_id),
  ],
);

export const caregiver_consent_audit = pgTable(
  'caregiver_consent_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consent_id: uuid('consent_id').notNull(),
    profile_id: uuid('profile_id').notNull(),
    action: varchar('action', { length: 20 }).notNull(), // 'granted' | 'revoked' | 'updated'
    actor_user_id: uuid('actor_user_id').notNull(),
    metadata: jsonb('metadata'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('caregiver_consent_audit_profile_idx').on(table.profile_id, table.created_at)],
);

export const rro_state = pgTable('rro_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  profile_id: uuid('profile_id').notNull().unique(),
  current_state: rroStateEnum('current_state').default('intake').notNull(),
  goal: text('goal'),
  entered_at: timestamp('entered_at', { withTimezone: true }).defaultNow().notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const rro_transition = pgTable(
  'rro_transition',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_id: uuid('profile_id').notNull(),
    from_state: rroStateEnum('from_state'),
    to_state: rroStateEnum('to_state').notNull(),
    reason: text('reason'),
    source: varchar('source', { length: 50 }).default('system').notNull(), // 'ai_classifier' | 'clinician' | 'system'
    metadata: jsonb('metadata'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('rro_transition_profile_idx').on(table.profile_id, table.created_at)],
);

export const notification_targets = pgTable(
  'notification_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_id: uuid('profile_id').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    destination_encrypted: text('destination_encrypted').notNull(),
    // Keyed HMAC-SHA256 of the destination — see services/lookup-hash.ts.
    destination_hash: text('destination_hash'),
    calendar_id: varchar('calendar_id', { length: 255 }),
    is_verified: boolean('is_verified').default(false).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('notification_targets_profile_idx').on(table.profile_id)],
);

export const notification_log = pgTable(
  'notification_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_id: uuid('profile_id').notNull(),
    target_id: uuid('target_id'),
    channel: notificationChannelEnum('channel').notNull(),
    subject: varchar('subject', { length: 255 }),
    body: text('body'),
    status: notificationStatusEnum('status').default('queued').notNull(),
    sent_at: timestamp('sent_at', { withTimezone: true }),
    error: text('error'),
    metadata: jsonb('metadata'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('notification_log_profile_idx').on(table.profile_id, table.created_at)],
);

// ─────────────────────────────────────────────────────────────
// PHI ACCESS LOG
// ─────────────────────────────────────────────────────────────
// Append-only record of who touched whose health data, including denied
// attempts. There is no update or delete path for this table by design: an
// access review is only trustworthy if the rows cannot be edited after the
// fact.
// ─────────────────────────────────────────────────────────────

export const phi_access_log = pgTable(
  'phi_access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Authenticated account, or 'anonymous' for an unauthenticated attempt.
    actor_id: varchar('actor_id', { length: 64 }).notNull(),
    actor_role: varchar('actor_role', { length: 50 }),
    // Subject of care whose data was touched, when the route names one.
    profile_id: uuid('profile_id'),
    action: varchar('action', { length: 100 }).notNull(),
    resource_type: varchar('resource_type', { length: 50 }),
    resource_id: varchar('resource_id', { length: 64 }),
    purpose: varchar('purpose', { length: 100 }).notNull(),
    method: varchar('method', { length: 10 }).notNull(),
    path: text('path').notNull(),
    status_code: integer('status_code').notNull(),
    success: boolean('success').notNull(),
    duration_ms: integer('duration_ms').notNull(),
    ip: varchar('ip', { length: 64 }),
    user_agent: text('user_agent'),
    correlation_id: varchar('correlation_id', { length: 100 }),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('phi_access_log_profile_idx').on(table.profile_id, table.occurred_at),
    index('phi_access_log_actor_idx').on(table.actor_id, table.occurred_at),
    // Denials are what an access review looks for first.
    index('phi_access_log_denied_idx').on(table.success, table.occurred_at),
  ],
);

// ─────────────────────────────────────────────────────────────
// D7 — weekly check-ins and adherence
//
// Created this week per the plan sheet; the endpoints that write them are
// Week 9. Scoped by profile, like everything else in the care model: a
// check-in is submitted by an account but is about one subject of care.
// ─────────────────────────────────────────────────────────────

export const checkInStatusEnum = pgEnum('check_in_status', ['submitted', 'reviewed']);

export const check_ins = pgTable(
  'check_ins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_id: uuid('profile_id').notNull(),
    /** Account that submitted it — the JWT sub. Kept for audit, never for scoping. */
    submitted_by_auth_id: uuid('submitted_by_auth_id').notNull(),
    /** Monday of the week the check-in covers, so one profile has one row per week. */
    week_starting: timestamp('week_starting', { withTimezone: true }).notNull(),
    /** Free-form answers; the question set is versioned with the care plan. */
    responses: jsonb('responses').default({}).notNull(),
    /** 0–10 self-reported, kept separate because every report trends it. */
    energy_score: integer('energy_score'),
    sleep_score: integer('sleep_score'),
    symptom_score: integer('symptom_score'),
    notes: text('notes'),
    status: checkInStatusEnum('status').default('submitted').notNull(),
    reviewed_by: uuid('reviewed_by'),
    reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('check_in_profile_week_unique').on(table.profile_id, table.week_starting),
    index('check_in_profile_idx').on(table.profile_id, table.week_starting),
  ],
);

/**
 * One adherence row per profile per week per plan item. Computed, not
 * submitted — a check-in says what happened, this says how much of the plan it
 * covered.
 */
export const adherence = pgTable(
  'adherence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_id: uuid('profile_id').notNull(),
    care_plan_id: uuid('care_plan_id'),
    week_starting: timestamp('week_starting', { withTimezone: true }).notNull(),
    /** What the plan asked for, and what was actually done. */
    item_key: varchar('item_key', { length: 120 }).notNull(),
    target_count: integer('target_count').notNull(),
    completed_count: integer('completed_count').default(0).notNull(),
    /** 0–100, stored so reports do not recompute it per read. */
    adherence_pct: integer('adherence_pct').default(0).notNull(),
    computed_at: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('adherence_profile_week_item_unique').on(
      table.profile_id,
      table.week_starting,
      table.item_key,
    ),
    index('adherence_profile_idx').on(table.profile_id, table.week_starting),
  ],
);
