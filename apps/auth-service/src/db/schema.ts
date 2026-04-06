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
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

export const authStatusEnum = pgEnum('auth_status', [
  'active',
  'pending_verification',
  'locked',
  'suspended',
  'deactivated',
]);

export const oauthProviderEnum = pgEnum('oauth_provider', ['google', 'apple']);

export const consentTypeEnum = pgEnum('consent_type', [
  'terms_of_service',
  'privacy_policy',
  'health_data_processing',
  'ai_profiling',
  'data_sharing_providers',
  'marketing_email',
  'marketing_sms',
]);

export const auditResultEnum = pgEnum('audit_result', ['success', 'failure', 'denied']);

// ─────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────

export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  password_hash: varchar('password_hash', { length: 255 }),
  status: authStatusEnum('status').default('pending_verification').notNull(),
  email_verified: boolean('email_verified').default(false).notNull(),
  email_verification_token: varchar('email_verification_token', { length: 128 }),
  email_verification_expires: timestamp('email_verification_expires', { withTimezone: true }),
  password_reset_token: varchar('password_reset_token', { length: 128 }),
  password_reset_expires: timestamp('password_reset_expires', { withTimezone: true }),
  mfa_enabled: boolean('mfa_enabled').default(false).notNull(),
  mfa_secret: varchar('mfa_secret', { length: 255 }),
  failed_login_attempts: integer('failed_login_attempts').default(0).notNull(),
  locked_until: timestamp('locked_until', { withTimezone: true }),
  last_login_at: timestamp('last_login_at', { withTimezone: true }),
  last_password_change: timestamp('last_password_change', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  credential_id: uuid('credential_id').notNull(),
  refresh_token_hash: varchar('refresh_token_hash', { length: 128 }).notNull().unique(),
  device_info: jsonb('device_info'),
  ip_address: text('ip_address').notNull(),
  user_agent: text('user_agent'),
  is_active: boolean('is_active').default(true).notNull(),
  last_used_at: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const oauth_accounts = pgTable('oauth_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  credential_id: uuid('credential_id').notNull(),
  provider: oauthProviderEnum('provider').notNull(),
  provider_user_id: varchar('provider_user_id', { length: 255 }).notNull(),
  provider_email: varchar('provider_email', { length: 255 }),
  access_token_encrypted: text('access_token_encrypted'),
  refresh_token_encrypted: text('refresh_token_encrypted'),
  token_expires_at: timestamp('token_expires_at', { withTimezone: true }),
  profile_data: jsonb('profile_data'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: text('description'),
  is_system: boolean('is_system').default(true).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  resource: varchar('resource', { length: 50 }).notNull(),
  action: varchar('action', { length: 50 }).notNull(),
  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const role_permissions = pgTable('role_permissions', {
  role_id: uuid('role_id').notNull(),
  permission_id: uuid('permission_id').notNull(),
});

export const user_roles = pgTable('user_roles', {
  credential_id: uuid('credential_id').notNull(),
  role_id: uuid('role_id').notNull(),
  assigned_by: uuid('assigned_by'),
  assigned_at: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
});

export const audit_logs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  credential_id: uuid('credential_id'),
  event_type: varchar('event_type', { length: 100 }).notNull(),
  user_role: varchar('user_role', { length: 50 }),
  user_email: varchar('user_email', { length: 255 }),
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  resource_type: varchar('resource_type', { length: 50 }),
  resource_id: uuid('resource_id'),
  resource_owner_id: uuid('resource_owner_id'),
  action: varchar('action', { length: 50 }).notNull(),
  result: auditResultEnum('result').notNull(),
  purpose: varchar('purpose', { length: 100 }),
  previous_hash: varchar('previous_hash', { length: 64 }),
  hash: varchar('hash', { length: 64 }),
  metadata: jsonb('metadata'),
  correlation_id: uuid('correlation_id'),
  service_name: varchar('service_name', { length: 50 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const consents = pgTable('consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  credential_id: uuid('credential_id').notNull(),
  consent_type: consentTypeEnum('consent_type').notNull(),
  version: varchar('version', { length: 20 }).notNull(),
  granted: boolean('granted').notNull(),
  ip_address: text('ip_address').notNull(),
  user_agent: text('user_agent'),
  policy_url: text('policy_url'),
  collection_point: varchar('collection_point', { length: 50 }),
  granted_at: timestamp('granted_at', { withTimezone: true }),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const processed_events = pgTable('processed_events', {
  event_id: uuid('event_id').primaryKey(),
  event_type: varchar('event_type', { length: 100 }).notNull(),
  processed_at: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
});
