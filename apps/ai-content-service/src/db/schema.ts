import type { RangeSex, ReadingEntryMethod, RroPillar, RroState } from '@longeny/types';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  json,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────
// pgvector custom type
// ─────────────────────────────────────────────────────────────

const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config: unknown) {
    const dimensions = (config as { dimensions?: number } | undefined)?.dimensions;
    return dimensions ? `vector(${dimensions})` : 'vector';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(Number);
  },
});

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

export const embeddingEntityTypeEnum = pgEnum('EmbeddingEntityType', [
  'provider',
  'program',
  'product',
  'user_profile',
]);

export const recommendationTypeEnum = pgEnum('RecommendationType', [
  'providers',
  'programs',
  'products',
  'mixed',
]);

export const aiRequestTypeEnum = pgEnum('AiRequestType', [
  'recommendation',
  'health_analysis',
  'document_gen',
  'embedding',
]);

export const aiRequestStatusEnum = pgEnum('AiRequestStatus', [
  'pending',
  'completed',
  'failed',
  'cached',
]);

export const promptSafetyLevelEnum = pgEnum('PromptSafetyLevel', ['low', 'standard', 'high']);

export const promptStatusEnum = pgEnum('PromptStatus', ['draft', 'active', 'deprecated']);

export const aiDocumentTypeEnum = pgEnum('AiDocumentType', [
  'prescription',
  'nutrition_plan',
  'training_plan',
]);

export const aiDocumentStatusEnum = pgEnum('AiDocumentStatus', [
  'draft',
  'pending_review',
  'approved',
  'rejected',
]);

export const safetyFlagCategoryEnum = pgEnum('SafetyFlagCategory', [
  'harmful_health_advice',
  'inappropriate_content',
  'pii_leak',
  'prompt_injection',
]);

export const docOwnerTypeEnum = pgEnum('DocOwnerType', ['user', 'provider']);

export const documentTypeEnum = pgEnum('DocumentType', [
  'lab_report',
  'prescription',
  'imaging',
  'insurance',
  'certificate',
  'other',
]);

export const docStatusEnum = pgEnum('DocStatus', ['processing', 'active', 'archived', 'deleted']);

export const accessPermissionEnum = pgEnum('AccessPermission', ['view', 'download']);

export const accessGrantedToTypeEnum = pgEnum('AccessGrantedToType', ['user', 'provider']);

export const accessTypeEnum = pgEnum('AccessType', [
  'view',
  'download',
  'share',
  'revoke',
  'upload',
  'delete',
]);

// ─────────────────────────────────────────────────────────────
// AI Module Tables
// ─────────────────────────────────────────────────────────────

export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entity_type: embeddingEntityTypeEnum('entity_type').notNull(),
    entity_id: uuid('entity_id').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    metadata: json('metadata').default({}).notNull(),
    model_version: varchar('model_version', { length: 50 })
      .default('amazon.titan-embed-text-v2')
      .notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    unique_entity: unique().on(t.entity_type, t.entity_id),
    idx_entity: index('embeddings_entity_idx').on(t.entity_type, t.entity_id),
  }),
);

export const recommendation_cache = pgTable(
  'recommendation_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id').notNull(),
    recommendation_type: recommendationTypeEnum('recommendation_type').notNull(),
    results: json('results').notNull(),
    score_breakdown: json('score_breakdown'),
    query_context: json('query_context'),
    model_used: varchar('model_used', { length: 50 }),
    generated_at: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    unique_user_type: unique().on(t.user_id, t.recommendation_type),
    idx_user: index('rec_cache_user_idx').on(t.user_id),
    idx_expires: index('rec_cache_expires_idx').on(t.expires_at),
  }),
);

export const ai_requests = pgTable(
  'ai_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id'),
    request_type: aiRequestTypeEnum('request_type').notNull(),
    model: varchar('model', { length: 50 }).notNull(),
    prompt_tokens: integer('prompt_tokens').default(0).notNull(),
    completion_tokens: integer('completion_tokens').default(0).notNull(),
    total_tokens: integer('total_tokens').default(0).notNull(),
    estimated_cost: numeric('estimated_cost', { precision: 10, scale: 6 }).default('0').notNull(),
    latency_ms: integer('latency_ms'),
    status: aiRequestStatusEnum('status').default('pending').notNull(),
    error_message: text('error_message'),
    cache_hit: boolean('cache_hit').default(false).notNull(),
    correlation_id: uuid('correlation_id'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idx_user: index('ai_requests_user_idx').on(t.user_id),
    idx_type: index('ai_requests_type_idx').on(t.request_type),
    idx_created: index('ai_requests_created_idx').on(t.created_at),
  }),
);

export const prompt_templates = pgTable('prompt_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  version: integer('version').default(1).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  system_prompt: text('system_prompt').notNull(),
  user_prompt_template: text('user_prompt_template').notNull(),
  output_schema: json('output_schema'),
  variables: json('variables').default([]).notNull(),
  max_tokens: integer('max_tokens').default(2000).notNull(),
  temperature: numeric('temperature', { precision: 2, scale: 1 }).default('0.7').notNull(),
  safety_level: promptSafetyLevelEnum('safety_level').default('standard').notNull(),
  status: promptStatusEnum('status').default('draft').notNull(),
  created_by: uuid('created_by'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const generated_documents = pgTable(
  'generated_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id').notNull(),
    provider_id: uuid('provider_id').notNull(),
    prompt_template_id: uuid('prompt_template_id'),
    ai_request_id: uuid('ai_request_id'),
    document_type: aiDocumentTypeEnum('document_type').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    content: json('content').notNull(),
    raw_ai_response: text('raw_ai_response'),
    status: aiDocumentStatusEnum('status').default('draft').notNull(),
    ai_model: varchar('ai_model', { length: 50 }).notNull(),
    reviewed_by: uuid('reviewed_by'),
    reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
    review_notes: text('review_notes'),
    approved_at: timestamp('approved_at', { withTimezone: true }),
    s3_file_key: text('s3_file_key'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idx_user: index('gen_docs_user_idx').on(t.user_id),
    idx_provider: index('gen_docs_provider_idx').on(t.provider_id),
    idx_status: index('gen_docs_status_idx').on(t.status),
  }),
);

export const safety_logs = pgTable(
  'safety_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ai_request_id: uuid('ai_request_id'),
    user_id: uuid('user_id'),
    input_text_hash: varchar('input_text_hash', { length: 64 }),
    output_flagged: boolean('output_flagged').default(false).notNull(),
    flag_reason: varchar('flag_reason', { length: 200 }),
    flag_category: safetyFlagCategoryEnum('flag_category'),
    input_filtered: boolean('input_filtered').default(false).notNull(),
    output_modified: boolean('output_modified').default(false).notNull(),
    disclaimer_injected: boolean('disclaimer_injected').default(false).notNull(),
    reviewed_by: uuid('reviewed_by'),
    review_status: varchar('review_status', { length: 20 }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idx_request: index('safety_logs_request_idx').on(t.ai_request_id),
    idx_created: index('safety_logs_created_idx').on(t.created_at),
  }),
);

// ─────────────────────────────────────────────────────────────
// Document Module Tables
// ─────────────────────────────────────────────────────────────

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    owner_id: uuid('owner_id').notNull(),
    owner_type: docOwnerTypeEnum('owner_type').notNull(),
    /**
     * Subject of care this document belongs to. Nullable for rows written before
     * the multi-profile model existed; those are backfilled to the owner's own
     * `self` profile. A provider-owned document (owner_type: 'provider') has no
     * profile — it belongs to the practice, not to a patient.
     */
    profile_id: uuid('profile_id'),
    document_type: documentTypeEnum('document_type').notNull(),
    /** When the report was produced, which is not when it was uploaded. */
    reported_at: timestamp('reported_at', { withTimezone: true }),
    title: varchar('title', { length: 300 }).notNull(),
    description: text('description'),
    file_key: varchar('file_key', { length: 500 }).notNull(),
    file_name: varchar('file_name', { length: 300 }).notNull(),
    file_size: bigint('file_size', { mode: 'bigint' }).notNull(),
    mime_type: varchar('mime_type', { length: 100 }).notNull(),
    encryption_key_id: varchar('encryption_key_id', { length: 200 }),
    checksum: varchar('checksum', { length: 64 }),
    tags: json('tags').default([]).notNull(),
    metadata: json('metadata').default({}).notNull(),
    thumbnail_key: varchar('thumbnail_key', { length: 500 }),
    status: docStatusEnum('status').default('active').notNull(),
    ai_generated: boolean('ai_generated').default(false).notNull(),
    ai_document_id: uuid('ai_document_id'),
    version_count: integer('version_count').default(1).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    idx_owner: index('documents_owner_idx').on(t.owner_id, t.owner_type),
    idx_status: index('documents_status_idx').on(t.status),
    // The reports timeline reads one profile ordered by report date.
    idx_profile: index('documents_profile_idx').on(t.profile_id, t.reported_at),
  }),
);

export const document_versions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    document_id: uuid('document_id').notNull(),
    version_number: integer('version_number').notNull(),
    file_key: varchar('file_key', { length: 500 }).notNull(),
    file_size: bigint('file_size', { mode: 'bigint' }).notNull(),
    changes_summary: text('changes_summary'),
    created_by: uuid('created_by').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    unique_version: unique().on(t.document_id, t.version_number),
    idx_doc: index('doc_versions_doc_idx').on(t.document_id),
  }),
);

export const document_access = pgTable(
  'document_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    document_id: uuid('document_id').notNull(),
    granted_to_id: uuid('granted_to_id').notNull(),
    granted_to_type: accessGrantedToTypeEnum('granted_to_type').notNull(),
    permission: accessPermissionEnum('permission').default('view').notNull(),
    granted_by: uuid('granted_by').notNull(),
    consent_id: uuid('consent_id'),
    notes: text('notes'),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    unique_grant: unique().on(t.document_id, t.granted_to_id),
    idx_doc: index('doc_access_doc_idx').on(t.document_id),
    idx_granted: index('doc_access_granted_idx').on(t.granted_to_id, t.granted_to_type),
  }),
);

export const document_access_log = pgTable(
  'document_access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    document_id: uuid('document_id').notNull(),
    accessed_by: uuid('accessed_by').notNull(),
    access_type: accessTypeEnum('access_type').notNull(),
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    metadata: json('metadata'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idx_doc: index('access_log_doc_idx').on(t.document_id),
    idx_accessed_by: index('access_log_accessed_by_idx').on(t.accessed_by),
    idx_created: index('access_log_created_idx').on(t.created_at),
  }),
);

export const document_tags = pgTable('document_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  category: varchar('category', { length: 50 }),
  created_by: uuid('created_by'),
  usage_count: integer('usage_count').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// AI Usage Log (mapped from AiRequest in usage stats query)
// ─────────────────────────────────────────────────────────────

export const ai_usage_log = pgTable('ai_usage_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id'),
  model_id: varchar('model_id', { length: 50 }).notNull(),
  purpose: varchar('purpose', { length: 100 }),
  tokens_in: integer('tokens_in').default(0).notNull(),
  tokens_out: integer('tokens_out').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// Shared Tables
// ─────────────────────────────────────────────────────────────

export const processed_events = pgTable('processed_events', {
  event_id: uuid('event_id').primaryKey(),
  event_type: varchar('event_type', { length: 100 }).notNull(),
  processed_at: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// RRO Module — intake, AI classification, pre-consult summary, care plans
//
// This service holds the patient-facing clinical inputs and the model output
// derived from them. Profiles live in longeny_core, a different database, so
// every row here carries a profile_id that was resolved — and ownership-checked
// — through user-provider's /internal/profiles/resolve before the row was
// written. There is deliberately no foreign key: it would cross a database
// boundary, and the check that matters happens before the insert, not after.
// ─────────────────────────────────────────────────────────────

export const rroStateEnum = pgEnum('rro_state_value', ['intake', 'reverse', 'restore', 'optimise']);
export const rroPillarEnum = pgEnum('rro_pillar', [
  'nutrition',
  'movement',
  'sleep',
  'stress',
  'environment',
]);
/** Which implementation produced a classification. See plan/rro/week-07-ai-core.md D-2. */
export const aiProviderEnum = pgEnum('ai_provider', ['bedrock', 'rules']);
export const carePlanStatusEnum = pgEnum('care_plan_status', [
  'draft',
  'pending_approval',
  'approved',
  'superseded',
]);

// ── Taxonomy drift guard ─────────────────────────────────────────────────────
// Literals for the same reason as in user-provider: drizzle-kit loads this file
// through a CJS require and a runtime import from @longeny/types breaks
// migration generation. These assertions fail to compile if a database enum and
// the shared taxonomy disagree, in either direction.
type MustExtend<Sub extends Super, Super> = Sub;

type _DbStatesInTaxonomy = MustExtend<(typeof rroStateEnum.enumValues)[number], RroState>;
type _TaxonomyStatesInDb = MustExtend<RroState, (typeof rroStateEnum.enumValues)[number]>;

type _DbPillarsInTaxonomy = MustExtend<(typeof rroPillarEnum.enumValues)[number], RroPillar>;
type _TaxonomyPillarsInDb = MustExtend<RroPillar, (typeof rroPillarEnum.enumValues)[number]>;

/**
 * Intake is versioned, never updated in place.
 *
 * A stored classification has to stay explainable: it was derived from one
 * specific set of answers, and overwriting those answers would leave a clinical
 * decision with no visible input. A resubmission therefore writes version n+1
 * and leaves n where it is.
 */
export const intake_submissions = pgTable(
  'intake_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_id: uuid('profile_id').notNull(),
    /** Account that submitted it — the JWT sub, kept for audit, never for scoping. */
    submitted_by_auth_id: uuid('submitted_by_auth_id').notNull(),
    version: integer('version').notNull(),
    symptoms: json('symptoms').$type<string[]>().default([]).notNull(),
    goals: json('goals').$type<string[]>().default([]).notNull(),
    conditions: json('conditions').$type<string[]>().default([]).notNull(),
    medications: json('medications').$type<string[]>().default([]).notNull(),
    // Typed to the taxonomy, not string[], so a row read back feeds the AI
    // contract without a cast. Only validated writes reach this column.
    pillar_priorities: json('pillar_priorities').$type<RroPillar[]>().default([]).notNull(),
    notes: text('notes'),
    submitted_at: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    unique_version: unique('intake_profile_version_unique').on(t.profile_id, t.version),
    idx_profile: index('intake_profile_idx').on(t.profile_id, t.version),
    idx_submitted: index('intake_submitted_idx').on(t.profile_id, t.submitted_at),
  }),
);

/**
 * One row per classification attempt, including the ones that changed nothing.
 *
 * `transitioned` records whether this classification actually moved the profile.
 * A low-confidence result, or one whose target state the taxonomy forbids, is
 * stored with `transitioned: false` and the reason — the attempt is evidence
 * even when it was refused.
 */
export const rro_classifications = pgTable(
  'rro_classifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_id: uuid('profile_id').notNull(),
    intake_id: uuid('intake_id'),
    intake_version: integer('intake_version'),
    provider: aiProviderEnum('provider').notNull(),
    model_id: varchar('model_id', { length: 100 }),
    contract_version: varchar('contract_version', { length: 10 }).notNull(),
    prompt_version: varchar('prompt_version', { length: 20 }).notNull(),
    state: rroStateEnum('state'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    pillar_priorities: json('pillar_priorities').$type<RroPillar[]>().default([]).notNull(),
    rationale: text('rationale'),
    missing_data: json('missing_data').$type<string[]>().default([]).notNull(),
    /** Set when the model declined; mutually exclusive with `state`. */
    refused_reason: varchar('refused_reason', { length: 40 }),
    refused_detail: text('refused_detail'),
    transitioned: boolean('transitioned').default(false).notNull(),
    not_transitioned_reason: varchar('not_transitioned_reason', { length: 60 }),
    latency_ms: integer('latency_ms'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idx_profile: index('rro_classification_profile_idx').on(t.profile_id, t.created_at),
    idx_intake: index('rro_classification_intake_idx').on(t.intake_id),
  }),
);

/**
 * Pre-consult summary, stored so the Week 8 workspace can read it without
 * paying for the model again. Tied to the intake version it was derived from:
 * a summary whose input has since changed is stale, and the workspace has to be
 * able to tell.
 */
export const rro_summaries = pgTable(
  'rro_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_id: uuid('profile_id').notNull(),
    intake_id: uuid('intake_id'),
    intake_version: integer('intake_version'),
    provider: aiProviderEnum('provider').notNull(),
    model_id: varchar('model_id', { length: 100 }),
    contract_version: varchar('contract_version', { length: 10 }).notNull(),
    prompt_version: varchar('prompt_version', { length: 20 }).notNull(),
    current_state: rroStateEnum('current_state'),
    concerns: json('concerns').$type<string[]>().default([]).notNull(),
    missing_data: json('missing_data').$type<string[]>().default([]).notNull(),
    red_flags: json('red_flags').$type<unknown[]>().default([]).notNull(),
    suggested_questions: json('suggested_questions').$type<string[]>().default([]).notNull(),
    /** False means the model declined for lack of input. Never a clinical finding. */
    sufficient_data: boolean('sufficient_data').default(false).notNull(),
    refused_reason: varchar('refused_reason', { length: 40 }),
    refused_detail: text('refused_detail'),
    latency_ms: integer('latency_ms'),
    generated_at: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idx_profile: index('rro_summary_profile_idx').on(t.profile_id, t.generated_at),
  }),
);

/**
 * D6 — care plans and their versions. Created this week per the plan sheet;
 * the endpoints that write them are Week 9.
 */
export const care_plans = pgTable(
  'care_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_id: uuid('profile_id').notNull(),
    created_by: uuid('created_by').notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    state_at_creation: rroStateEnum('state_at_creation'),
    pillars: json('pillars').$type<string[]>().default([]).notNull(),
    status: carePlanStatusEnum('status').default('draft').notNull(),
    current_version: integer('current_version').default(1).notNull(),
    approved_by: uuid('approved_by'),
    approved_at: timestamp('approved_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idx_profile: index('care_plan_profile_idx').on(t.profile_id, t.created_at),
    idx_status: index('care_plan_status_idx').on(t.status),
  }),
);

export const plan_versions = pgTable(
  'plan_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    care_plan_id: uuid('care_plan_id').notNull(),
    version_number: integer('version_number').notNull(),
    content: json('content').$type<Record<string, unknown>>().default({}).notNull(),
    change_summary: text('change_summary'),
    created_by: uuid('created_by').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    unique_version: unique('plan_version_unique').on(t.care_plan_id, t.version_number),
    idx_plan: index('plan_version_plan_idx').on(t.care_plan_id),
  }),
);

/**
 * Health-data access trail for this service.
 *
 * user-provider has a table of the same shape. The two are deliberately not one
 * table: an audit row must be durable at the moment of the access, and routing
 * it through another service would mean losing rows whenever that service is
 * down — silently, because an audit write may never fail the request it records.
 * What is shared is the contract: both sinks are written from the same
 * `AuditEntry` type in `@longeny/middleware`, so an access review reads the same
 * columns in both databases.
 *
 * Append-only is enforced in the database (see db/enforce-append-only.sql).
 */
export const phi_access_log = pgTable(
  'phi_access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor_id: varchar('actor_id', { length: 64 }).notNull(),
    actor_role: varchar('actor_role', { length: 50 }),
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
  (t) => ({
    idx_profile: index('ai_phi_access_log_profile_idx').on(t.profile_id, t.occurred_at),
    idx_actor: index('ai_phi_access_log_actor_idx').on(t.actor_id, t.occurred_at),
    // Denials are what an access review looks for first.
    idx_denied: index('ai_phi_access_log_denied_idx').on(t.success, t.occurred_at),
  }),
);

/**
 * Who owns an AI onboarding session, and which profile it is about.
 *
 * The conversation itself lives in the Python onboarding agent, keyed by a
 * session id it generates. Nothing here recorded who that session belonged to,
 * so `GET /ai/onboarding/session/{id}` handed any authenticated caller any
 * session — and a session transcript carries symptoms and conditions.
 *
 * This table is the ownership record: written when a session starts, checked on
 * every read. It also carries the profile, so a session started for a parent
 * profile persists to that parent rather than to the account owner.
 */
export const onboarding_sessions = pgTable(
  'onboarding_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The agent's session id. Opaque to us, unique per conversation. */
    session_id: varchar('session_id', { length: 128 }).notNull().unique(),
    /** Account that started it — the JWT sub. */
    auth_id: uuid('auth_id').notNull(),
    /** Subject of care the session is about. */
    profile_id: uuid('profile_id').notNull(),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idx_auth: index('onboarding_session_auth_idx').on(t.auth_id, t.created_at),
    idx_profile: index('onboarding_session_profile_idx').on(t.profile_id),
  }),
);

// ─────────────────────────────────────────────────────────────
// Biomarkers — Week 8: readings, reference ranges, benchmarks
//
// A report used to be only a file. These tables give it a body: the values it
// contains, and the ranges those values are judged against. Scoring reads from
// here and never writes back to the care state (plan/rro/week-08 §4).
// ─────────────────────────────────────────────────────────────

export const readingEntryMethodEnum = pgEnum('reading_entry_method', ['manual', 'extracted']);
export const rangeSexEnum = pgEnum('range_sex', ['any', 'male', 'female']);

type _DbEntryInTaxonomy = MustExtend<
  (typeof readingEntryMethodEnum.enumValues)[number],
  ReadingEntryMethod
>;
type _TaxonomyEntryInDb = MustExtend<
  ReadingEntryMethod,
  (typeof readingEntryMethodEnum.enumValues)[number]
>;
type _DbSexInTaxonomy = MustExtend<(typeof rangeSexEnum.enumValues)[number], RangeSex>;
type _TaxonomySexInDb = MustExtend<RangeSex, (typeof rangeSexEnum.enumValues)[number]>;

/**
 * One measured value from one report.
 *
 * Never updated in place. A correction writes a new row naming the one it
 * replaces in `supersedes_id`; the current value for a marker is the newest row
 * that nothing supersedes. A benchmark or score computed yesterday therefore
 * still has the input it was computed from.
 *
 * `document_id` is required: a value with no source file cannot answer "where
 * did this number come from", which is the first question a clinician asks.
 */
export const biomarker_readings = pgTable(
  'biomarker_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_id: uuid('profile_id').notNull(),
    document_id: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    /** Lower-case code shared with reference_ranges, e.g. `hba1c`, `ldl_c`. */
    marker_code: varchar('marker_code', { length: 64 }).notNull(),
    value: numeric('value', { precision: 12, scale: 4 }).notNull(),
    /** As printed on the report. Compared to the range's unit, never converted. */
    unit: varchar('unit', { length: 32 }).notNull(),
    /** When the sample was taken, which is not when it was typed in. */
    measured_at: timestamp('measured_at', { withTimezone: true }).notNull(),
    entry_method: readingEntryMethodEnum('entry_method').notNull(),
    /** Account that entered or confirmed it — audit only, never scope. */
    entered_by_auth_id: uuid('entered_by_auth_id').notNull(),
    supersedes_id: uuid('supersedes_id').references((): AnyPgColumn => biomarker_readings.id),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idx_profile_marker: index('biomarker_reading_profile_marker_idx').on(
      t.profile_id,
      t.marker_code,
      t.measured_at,
    ),
    idx_document: index('biomarker_reading_document_idx').on(t.document_id),
    // A reading can be corrected once; a second correction corrects the correction.
    unique_supersedes: unique('biomarker_reading_supersedes_unique').on(t.supersedes_id),
    marker_code_format: check(
      'biomarker_reading_marker_code_format',
      sql`${t.marker_code} ~ '^[a-z][a-z0-9_]*$'`,
    ),
  }),
);

/**
 * What "normal" is for one marker, for one group of people, according to one
 * named source.
 *
 * `is_placeholder` defaults to true on purpose. Until the clinical ranges are
 * supplied (VG-W8-1), every row here is a test value, and a row has to be
 * deliberately marked real rather than accidentally left looking real. Every
 * benchmark computed against a placeholder row is returned as `provisional`.
 *
 * Either normal bound may be absent (LDL has only an upper limit), but not both.
 * The optimal band, when given, sits inside the normal band.
 */
export const reference_ranges = pgTable(
  'reference_ranges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marker_code: varchar('marker_code', { length: 64 }).notNull(),
    marker_name: varchar('marker_name', { length: 120 }).notNull(),
    unit: varchar('unit', { length: 32 }).notNull(),
    sex: rangeSexEnum('sex').default('any').notNull(),
    /** Inclusive. Null means no lower age limit. */
    age_min_years: integer('age_min_years'),
    /** Inclusive. Null means no upper age limit. */
    age_max_years: integer('age_max_years'),
    normal_low: numeric('normal_low', { precision: 12, scale: 4 }),
    normal_high: numeric('normal_high', { precision: 12, scale: 4 }),
    optimal_low: numeric('optimal_low', { precision: 12, scale: 4 }),
    optimal_high: numeric('optimal_high', { precision: 12, scale: 4 }),
    /** The pillar this marker feeds when scoring. Null until decided. */
    pillar: rroPillarEnum('pillar'),
    /** Lab or guideline body — the answer to "according to whom". */
    source: text('source').notNull(),
    is_placeholder: boolean('is_placeholder').default(true).notNull(),
    effective_from: timestamp('effective_from', { withTimezone: true }).defaultNow().notNull(),
    /** Set instead of deleting, so an old benchmark can still name its range. */
    retired_at: timestamp('retired_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idx_marker: index('reference_range_marker_idx').on(t.marker_code, t.retired_at),
    marker_code_format: check(
      'reference_range_marker_code_format',
      sql`${t.marker_code} ~ '^[a-z][a-z0-9_]*$'`,
    ),
    has_a_bound: check(
      'reference_range_has_a_bound',
      sql`${t.normal_low} IS NOT NULL OR ${t.normal_high} IS NOT NULL`,
    ),
    normal_ordered: check(
      'reference_range_normal_ordered',
      sql`${t.normal_low} IS NULL OR ${t.normal_high} IS NULL OR ${t.normal_low} <= ${t.normal_high}`,
    ),
    optimal_inside_normal: check(
      'reference_range_optimal_inside_normal',
      sql`(${t.optimal_low} IS NULL OR ${t.normal_low} IS NULL OR ${t.optimal_low} >= ${t.normal_low})
        AND (${t.optimal_high} IS NULL OR ${t.normal_high} IS NULL OR ${t.optimal_high} <= ${t.normal_high})
        AND (${t.optimal_low} IS NULL OR ${t.optimal_high} IS NULL OR ${t.optimal_low} <= ${t.optimal_high})`,
    ),
    age_ordered: check(
      'reference_range_age_ordered',
      sql`${t.age_min_years} IS NULL OR ${t.age_max_years} IS NULL OR ${t.age_min_years} <= ${t.age_max_years}`,
    ),
    source_named: check('reference_range_source_named', sql`length(trim(${t.source})) > 0`),
  }),
);

/**
 * A computed score, kept as it was shown.
 *
 * Scores are derived and could be recomputed at any time, but "what did the
 * score say when the clinician looked at it" is a question with one answer, and
 * this row is it: the rule version, the result with its full explanation, and a
 * fingerprint of exactly which readings and ranges went in. When the inputs
 * change, the fingerprint no longer matches and the stored score is stale.
 *
 * Advisory only. Nothing that writes this table touches the care state.
 */
export const rro_scores = pgTable(
  'rro_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_id: uuid('profile_id').notNull(),
    scoring_version: varchar('scoring_version', { length: 40 }).notNull(),
    overall: numeric('overall', { precision: 4, scale: 1 }),
    result: json('result').notNull(),
    /** sha256 over the scoring version and every input reading and range. */
    input_fingerprint: varchar('input_fingerprint', { length: 64 }).notNull(),
    provisional: boolean('provisional').notNull(),
    /** Account that asked for it — audit only. */
    computed_by_auth_id: uuid('computed_by_auth_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idx_profile: index('rro_score_profile_idx').on(t.profile_id, t.created_at),
  }),
);
