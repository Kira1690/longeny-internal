import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  bigint,
  numeric,
  timestamp,
  json,
  customType,
  unique,
  index,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────
// pgvector custom type
// ─────────────────────────────────────────────────────────────

const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config?: { dimensions?: number }) {
    return config?.dimensions ? `vector(${config.dimensions})` : 'vector';
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

export const docStatusEnum = pgEnum('DocStatus', [
  'processing',
  'active',
  'archived',
  'deleted',
]);

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
    model_version: varchar('model_version', { length: 50 }).default('amazon.titan-embed-text-v2').notNull(),
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
    document_type: documentTypeEnum('document_type').notNull(),
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
