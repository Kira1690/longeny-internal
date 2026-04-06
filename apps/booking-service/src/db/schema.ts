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
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────
// Enums — Booking
// ─────────────────────────────────────────────────────────────

export const sessionTypeEnum = pgEnum('session_type', ['consultation', 'followup', 'assessment', 'program_session', 'custom']);
export const bookingStatusEnum = pgEnum('booking_status', ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']);
export const cancelledByEnum = pgEnum('cancelled_by', ['user', 'provider', 'system']);
export const reminderTypeEnum = pgEnum('reminder_type', ['24h', '1h', '15min']);
export const reminderStatusEnum = pgEnum('reminder_status', ['pending', 'sent', 'failed', 'cancelled']);
export const calendarSyncStatusEnum = pgEnum('calendar_sync_status', ['active', 'disconnected', 'error', 'syncing']);
export const recurringBookingStatusEnum = pgEnum('recurring_booking_status', ['active', 'paused', 'cancelled', 'completed']);
export const waitlistStatusEnum = pgEnum('waitlist_status', ['waiting', 'notified', 'booked', 'expired']);

// ─────────────────────────────────────────────────────────────
// Enums — Notification
// ─────────────────────────────────────────────────────────────

export const notificationTypeEnum = pgEnum('notification_type', ['email', 'sms', 'push', 'in_app']);
export const notificationCategoryEnum = pgEnum('notification_category', ['booking', 'payment', 'system', 'marketing', 'reminder', 'document', 'provider', 'progress']);
export const notificationStatusEnum = pgEnum('notification_status', ['pending', 'queued', 'sent', 'delivered', 'failed', 'read']);
export const templateStatusEnum = pgEnum('template_status', ['active', 'draft', 'deprecated']);
export const pushPlatformEnum = pgEnum('push_platform', ['ios', 'android', 'web']);
export const scheduledNotificationStatusEnum = pgEnum('scheduled_notification_status', ['pending', 'sent', 'cancelled', 'failed']);

// ─────────────────────────────────────────────────────────────
// Tables — Booking
// ─────────────────────────────────────────────────────────────

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  provider_id: uuid('provider_id').notNull(),
  program_id: uuid('program_id'),
  session_type: sessionTypeEnum('session_type').default('consultation').notNull(),
  status: bookingStatusEnum('status').default('pending').notNull(),
  title: varchar('title', { length: 200 }),
  start_time: timestamp('start_time', { withTimezone: true }).notNull(),
  end_time: timestamp('end_time', { withTimezone: true }).notNull(),
  duration_minutes: integer('duration_minutes').notNull(),
  timezone: varchar('timezone', { length: 50 }).notNull(),
  notes: text('notes'),
  provider_notes: text('provider_notes'),
  meeting_link: text('meeting_link'),
  is_virtual: boolean('is_virtual').default(true).notNull(),
  location_address: text('location_address'),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).default('USD').notNull(),
  order_id: uuid('order_id'),
  cancellation_reason: text('cancellation_reason'),
  cancelled_by: cancelledByEnum('cancelled_by'),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  google_event_id: varchar('google_event_id', { length: 255 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const booking_reminders = pgTable('booking_reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  booking_id: uuid('booking_id').notNull(),
  user_id: uuid('user_id').notNull(),
  reminder_type: reminderTypeEnum('reminder_type').notNull(),
  message: text('message'),
  scheduled_at: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  sent_at: timestamp('sent_at', { withTimezone: true }),
  status: reminderStatusEnum('status').default('pending').notNull(),
  error_message: text('error_message'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const calendar_sync = pgTable('calendar_sync', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider_id: uuid('provider_id').notNull().unique(),
  google_calendar_id: varchar('google_calendar_id', { length: 255 }),
  google_access_token_encrypted: text('google_access_token_encrypted'),
  google_refresh_token_encrypted: text('google_refresh_token_encrypted'),
  sync_token: text('sync_token'),
  last_synced_at: timestamp('last_synced_at', { withTimezone: true }),
  status: calendarSyncStatusEnum('status').default('disconnected').notNull(),
  error_message: text('error_message'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const recurring_bookings = pgTable('recurring_bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  provider_id: uuid('provider_id').notNull(),
  program_id: uuid('program_id'),
  session_type: sessionTypeEnum('session_type').default('consultation').notNull(),
  recurrence_rule: varchar('recurrence_rule', { length: 255 }).notNull(),
  start_date: date('start_date').notNull(),
  end_date: date('end_date'),
  status: recurringBookingStatusEnum('status').default('active').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const waitlist = pgTable('waitlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  provider_id: uuid('provider_id').notNull(),
  preferred_date_start: date('preferred_date_start').notNull(),
  preferred_date_end: date('preferred_date_end').notNull(),
  session_type: sessionTypeEnum('session_type').default('consultation').notNull(),
  status: waitlistStatusEnum('status').default('waiting').notNull(),
  notified_at: timestamp('notified_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// Tables — Notification
// ─────────────────────────────────────────────────────────────

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  booking_id: uuid('booking_id'),
  type: notificationTypeEnum('type').notNull(),
  category: notificationCategoryEnum('category').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body').notNull(),
  body_html: text('body_html'),
  data: jsonb('data'),
  template_id: uuid('template_id'),
  status: notificationStatusEnum('status').default('pending').notNull(),
  priority: integer('priority').default(5).notNull(),
  external_message_id: varchar('external_message_id', { length: 200 }),
  error_message: text('error_message'),
  retry_count: integer('retry_count').default(0).notNull(),
  max_retries: integer('max_retries').default(3).notNull(),
  read_at: timestamp('read_at', { withTimezone: true }),
  sent_at: timestamp('sent_at', { withTimezone: true }),
  delivered_at: timestamp('delivered_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const notification_templates = pgTable('notification_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  type: notificationTypeEnum('type').notNull(),
  category: notificationCategoryEnum('category').notNull(),
  subject: varchar('subject', { length: 200 }),
  body_template: text('body_template').notNull(),
  body_html_template: text('body_html_template'),
  variables: jsonb('variables').default([]).notNull(),
  status: templateStatusEnum('status').default('active').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const notification_preferences = pgTable('notification_preferences', {
  user_id: uuid('user_id').primaryKey(),
  booking_email: boolean('booking_email').default(false).notNull(),
  booking_sms: boolean('booking_sms').default(false).notNull(),
  booking_push: boolean('booking_push').default(false).notNull(),
  payment_email: boolean('payment_email').default(false).notNull(),
  payment_sms: boolean('payment_sms').default(false).notNull(),
  payment_push: boolean('payment_push').default(false).notNull(),
  reminder_email: boolean('reminder_email').default(false).notNull(),
  reminder_sms: boolean('reminder_sms').default(false).notNull(),
  reminder_push: boolean('reminder_push').default(false).notNull(),
  document_email: boolean('document_email').default(false).notNull(),
  document_push: boolean('document_push').default(false).notNull(),
  provider_email: boolean('provider_email').default(false).notNull(),
  provider_push: boolean('provider_push').default(false).notNull(),
  progress_push: boolean('progress_push').default(false).notNull(),
  marketing_email: boolean('marketing_email').default(false).notNull(),
  marketing_sms: boolean('marketing_sms').default(false).notNull(),
  system_email: boolean('system_email').default(true).notNull(),
  system_push: boolean('system_push').default(true).notNull(),
  quiet_hours_start: varchar('quiet_hours_start', { length: 8 }),
  quiet_hours_end: varchar('quiet_hours_end', { length: 8 }),
  timezone: varchar('timezone', { length: 50 }).default('America/New_York').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const push_tokens = pgTable('push_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  device_id: varchar('device_id', { length: 200 }).notNull(),
  token: text('token').notNull(),
  platform: pushPlatformEnum('platform').notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  last_used_at: timestamp('last_used_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const scheduled_notifications = pgTable('scheduled_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  notification_id: uuid('notification_id'),
  user_id: uuid('user_id').notNull(),
  template_id: uuid('template_id'),
  type: notificationTypeEnum('type').notNull(),
  category: notificationCategoryEnum('category').notNull(),
  template_data: jsonb('template_data'),
  scheduled_at: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  sent_at: timestamp('sent_at', { withTimezone: true }),
  status: scheduledNotificationStatusEnum('status').default('pending').notNull(),
  reference_type: varchar('reference_type', { length: 50 }),
  reference_id: uuid('reference_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// Shared — Idempotency
// ─────────────────────────────────────────────────────────────

export const processed_events = pgTable('processed_events', {
  event_id: uuid('event_id').primaryKey(),
  event_type: varchar('event_type', { length: 100 }).notNull(),
  processed_at: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
});
