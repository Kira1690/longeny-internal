import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  decimal,
  date,
  time,
  real,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────
// Enums — User Module
// ─────────────────────────────────────────────────────────────

export const userStatusEnum = pgEnum('user_status', ['active', 'inactive', 'suspended', 'deactivated']);
export const genderEnum = pgEnum('gender', ['male', 'female', 'non_binary', 'prefer_not_to_say']);
export const fitnessLevelEnum = pgEnum('fitness_level', ['beginner', 'intermediate', 'advanced', 'elite']);

// ─────────────────────────────────────────────────────────────
// Enums — Provider Module
// ─────────────────────────────────────────────────────────────

export const providerStatusEnum = pgEnum('provider_status', ['pending', 'verified', 'suspended', 'rejected', 'deactivated']);
export const verificationStatusEnum = pgEnum('verification_status', ['pending', 'approved', 'rejected']);
export const programStatusEnum = pgEnum('program_status', ['draft', 'active', 'paused', 'archived']);
export const productStatusEnum = pgEnum('product_status', ['draft', 'active', 'out_of_stock', 'archived']);
export const priceTypeEnum = pgEnum('price_type', ['one_time', 'subscription_monthly', 'subscription_yearly', 'per_session', 'free']);
export const dayOfWeekEnum = pgEnum('day_of_week', ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

// ─────────────────────────────────────────────────────────────
// Enums — Marketplace Module
// ─────────────────────────────────────────────────────────────

export const entityTypeEnum = pgEnum('entity_type', ['provider', 'program', 'product']);
export const listingStatusEnum = pgEnum('listing_status', ['active', 'inactive', 'featured', 'archived']);

// ─────────────────────────────────────────────────────────────
// Enums — Admin Module
// ─────────────────────────────────────────────────────────────

export const adminActionTypeEnum = pgEnum('admin_action_type', [
  'verify_provider', 'suspend_provider', 'reactivate_provider',
  'suspend_user', 'reactivate_user', 'delete_user',
  'moderate_content', 'update_settings', 'export_data',
  'approve_refund', 'reject_refund',
]);
export const moderationStatusEnum = pgEnum('moderation_status', ['pending', 'approved', 'rejected', 'escalated']);
export const flagTypeEnum = pgEnum('flag_type', ['inappropriate', 'spam', 'fake', 'harmful', 'copyright', 'other']);
export const flagStatusEnum = pgEnum('flag_status', ['open', 'reviewing', 'resolved', 'dismissed']);

// ─────────────────────────────────────────────────────────────
// Enums — Progress Module
// ─────────────────────────────────────────────────────────────

export const metricTypeEnum = pgEnum('metric_type', ['weight', 'steps', 'sleep_hours', 'water_oz', 'calories', 'mood', 'energy', 'stress', 'custom']);
export const habitFrequencyEnum = pgEnum('habit_frequency', ['DAILY', 'WEEKLY', 'CUSTOM']);
export const reviewTargetTypeEnum = pgEnum('review_target_type', ['PROVIDER', 'PROGRAM', 'PRODUCT']);
export const reviewStatusEnum = pgEnum('review_status', ['PENDING', 'APPROVED', 'REJECTED', 'FLAGGED']);
export const goalStatusEnum = pgEnum('goal_status', ['pending', 'in_progress', 'completed', 'abandoned']);
export const reminderCategoryEnum = pgEnum('reminder_category', ['habit', 'goal', 'wellness', 'custom']);

// ─────────────────────────────────────────────────────────────
// Enums — GDPR Module
// ─────────────────────────────────────────────────────────────

export const erasureStatusEnum = pgEnum('erasure_status', ['pending', 'processing', 'completed', 'cancelled']);
export const exportTypeEnum = pgEnum('export_type', ['dsar', 'portable']);
export const exportStatusEnum = pgEnum('export_status', ['pending', 'processing', 'completed', 'failed', 'expired']);
export const breachSeverityEnum = pgEnum('breach_severity', ['low', 'medium', 'high', 'critical']);
export const remediationStatusEnum = pgEnum('remediation_status', ['investigating', 'contained', 'remediated', 'closed']);

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

export const onboarding_state = pgTable('onboarding_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().unique(),
  current_step: integer('current_step').default(1).notNull(),
  total_steps: integer('total_steps').default(5).notNull(),
  completed_steps: jsonb('completed_steps').default([]).notNull(),
  step_data: jsonb('step_data').default({}).notNull(),
  is_completed: boolean('is_completed').default(false).notNull(),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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

export const progress_entries = pgTable('progress_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  type: metricTypeEnum('type').notNull(),
  metric: varchar('metric', { length: 100 }),
  value: real('value').notNull(),
  unit: varchar('unit', { length: 20 }),
  notes: text('notes'),
  date: date('date').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const habits = pgTable('habits', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
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
});

export const habit_checkins = pgTable('habit_checkins', {
  id: uuid('id').primaryKey().defaultRandom(),
  habit_id: uuid('habit_id').notNull(),
  user_id: uuid('user_id').notNull(),
  date: date('date').notNull(),
  count: integer('count').default(1).notNull(),
  completed: boolean('completed').default(true).notNull(),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

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
  remediation_status: remediationStatusEnum('remediation_status').default('investigating').notNull(),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  post_mortem_url: text('post_mortem_url'),
  reported_by: uuid('reported_by'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// Tables — Goals, Engagement & Misc
// ─────────────────────────────────────────────────────────────

export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
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
});

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
