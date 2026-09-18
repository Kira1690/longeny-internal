import type {
  ReportPageMethod,
  ReportProcessingStatus,
  ReportReadMethod,
  RroPillar,
  RroState,
} from '@longeny/types';
import { sql } from 'drizzle-orm';
import {
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

/**
 * Care stage. Declared here, ahead of the RRO section that owns it, because a
 * report records the stage its subject was in when it was uploaded.
 */
export const rroStateEnum = pgEnum('rro_state_value', ['intake', 'reverse', 'restore', 'optimise']);

/** How far the reader has got with a report. See REPORT_PROCESSING_STATUSES. */
export const reportProcessingStatusEnum = pgEnum('report_processing_status', [
  'awaiting_upload',
  'uploaded',
  'reading',
  'read',
  'failed',
  'not_applicable',
]);
/** How a report's text was obtained. See REPORT_READ_METHODS. */
export const reportReadMethodEnum = pgEnum('report_read_method', ['text_layer', 'ocr', 'mixed']);

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

    // ── Report processing ──
    //
    // Separate from `status`, which says whether a document is visible. These
    // say what the reader has done with it.

    /** The subject's care stage when the report was declared. Never updated. */
    rro_state_at_upload: rroStateEnum('rro_state_at_upload'),
    processing_status: reportProcessingStatusEnum('processing_status')
      .default('awaiting_upload')
      .notNull(),
    read_method: reportReadMethodEnum('read_method'),
    /** A reason safe to show the person. Never a stack trace or a raw provider error. */
    processing_error: text('processing_error'),
    /** Something to know about a successful read — pages that had no text, pages not read. */
    processing_note: text('processing_note'),
    page_count: integer('page_count'),
    processed_at: timestamp('processed_at', { withTimezone: true }),
    /** Reader bookkeeping: how many times a read was started, and when the current one began. */
    processing_attempts: integer('processing_attempts').default(0).notNull(),
    claimed_at: timestamp('claimed_at', { withTimezone: true }),
  },
  (t) => ({
    idx_owner: index('documents_owner_idx').on(t.owner_id, t.owner_type),
    idx_status: index('documents_status_idx').on(t.status),
    // The reports timeline reads one profile ordered by report date.
    idx_profile: index('documents_profile_idx').on(t.profile_id, t.reported_at),
    // The reader's queue: only the rows it still has to pick up or reclaim.
    idx_processing: index('documents_processing_queue_idx')
      .on(t.processing_status, t.claimed_at)
      .where(sql`${t.processing_status} IN ('uploaded', 'reading')`),
  }),
);

/**
 * The text of one page of a report, as the reader obtained it.
 *
 * Health data, under the same access rule as the report it belongs to, and
 * never returned without that report's check. `profile_id` is copied from the
 * report so the check never needs a join. Text read by machine: it is never
 * treated as confirmed values.
 */
export const report_pages = pgTable(
  'report_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    document_id: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    profile_id: uuid('profile_id').notNull(),
    page_number: integer('page_number').notNull(),
    /** A single page is read one way or the other, never `mixed`. */
    method: reportReadMethodEnum('method').notNull(),
    text: text('text').notNull(),
    /** `[{ rows: string[][] }]` — tables as OCR found them. Empty for a text-layer page. */
    tables: json('tables').default([]).notNull(),
    /** Mean line confidence from OCR, 0–100. Null for a text-layer page. */
    ocr_confidence: numeric('ocr_confidence', { precision: 5, scale: 2 }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    unique_page: unique('report_pages_document_page_unique').on(t.document_id, t.page_number),
    page_positive: check('report_pages_page_number_positive', sql`${t.page_number} >= 1`),
    page_method: check('report_pages_method_not_mixed', sql`${t.method} <> 'mixed'`),
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

export const rroPillarEnum = pgEnum('rro_pillar', [
  'nutrition',
  'movement',
  'sleep',
  'stress',
  'environment',
]);
/** Which implementation produced a classification. */
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

type _DbProcessingInTaxonomy = MustExtend<
  (typeof reportProcessingStatusEnum.enumValues)[number],
  ReportProcessingStatus
>;
type _TaxonomyProcessingInDb = MustExtend<
  ReportProcessingStatus,
  (typeof reportProcessingStatusEnum.enumValues)[number]
>;
type _DbReadMethodInTaxonomy = MustExtend<
  (typeof reportReadMethodEnum.enumValues)[number],
  ReportReadMethod
>;
type _TaxonomyReadMethodInDb = MustExtend<
  ReportReadMethod,
  (typeof reportReadMethodEnum.enumValues)[number]
>;
type _PageMethodIsReadMethod = MustExtend<ReportPageMethod, ReportReadMethod>;

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
 * Pre-consult summary, stored so the clinician workspace can read it without
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
 * Care plans and their versions. The tables exist ahead of the endpoints that
 * write them.
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
