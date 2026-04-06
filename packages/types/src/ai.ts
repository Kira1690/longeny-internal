import {
  AiRequestType,
  AiDocumentType,
  AiDocumentStatus,
  DocumentType,
  DocumentStatus,
  AccessPermission,
} from './enums.js';

export interface Embedding {
  id: string;
  entity_type: string;
  entity_id: string;
  /** pgvector vector(1024) — represented as number array at the application layer */
  embedding: number[];
  /** JSONB object containing entity metadata (title, category, specialties, tags) */
  metadata: Record<string, unknown>;
  model_version: string;
  created_at: Date;
  updated_at: Date;
}

export interface RecommendationCache {
  id: string;
  user_id: string;
  recommendation_type: string;
  /** JSONB array of recommendation results [{ entityType, entityId, score, explanation }] */
  results: Record<string, unknown> | unknown[];
  /** JSONB object containing score breakdown (profile_match, rating, availability) */
  score_breakdown: Record<string, unknown> | null;
  /** JSONB object containing anonymized user profile snapshot used for the query */
  query_context: Record<string, unknown> | null;
  model_used: string | null;
  generated_at: Date;
  expires_at: Date;
}

export interface AiRequest {
  id: string;
  user_id: string | null;
  request_type: AiRequestType;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  latency_ms: number | null;
  status: string;
  error_message: string | null;
  cache_hit: boolean;
  correlation_id: string | null;
  created_at: Date;
}

export interface PromptTemplate {
  id: string;
  name: string;
  version: number;
  category: string;
  system_prompt: string;
  user_prompt_template: string;
  /** JSONB object describing the expected JSON output structure */
  output_schema: Record<string, unknown> | null;
  /** JSONB array of variable definitions [{ name, type, required, description }] */
  variables: Record<string, unknown> | unknown[];
  max_tokens: number;
  temperature: number;
  safety_level: string;
  status: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface GeneratedDocument {
  id: string;
  user_id: string;
  provider_id: string;
  prompt_template_id: string | null;
  ai_request_id: string | null;
  document_type: AiDocumentType;
  title: string;
  /** JSONB object containing document content (sections, recommendations, disclaimers) */
  content: Record<string, unknown>;
  raw_ai_response: string | null;
  status: AiDocumentStatus;
  ai_model: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_notes: string | null;
  approved_at: Date | null;
  s3_file_key: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SafetyLog {
  id: string;
  ai_request_id: string | null;
  user_id: string | null;
  /** SHA-256 hash of the input text — raw text is never stored */
  input_text_hash: string | null;
  output_flagged: boolean;
  flag_reason: string | null;
  flag_category: string | null;
  input_filtered: boolean;
  output_modified: boolean;
  disclaimer_injected: boolean;
  reviewed_by: string | null;
  review_status: string | null;
  created_at: Date;
}

export interface Document {
  id: string;
  owner_id: string;
  owner_type: string;
  document_type: DocumentType;
  title: string;
  description: string | null;
  /** S3 object key for the stored file */
  file_key: string;
  file_name: string;
  /** File size in bytes */
  file_size: number;
  mime_type: string;
  /** KMS key ARN/ID used for encryption */
  encryption_key_id: string | null;
  /** SHA-256 checksum of the file */
  checksum: string | null;
  /** JSONB array of tag strings */
  tags: Record<string, unknown> | unknown[];
  /** JSONB object containing document metadata (labName, testDate, providerName) */
  metadata: Record<string, unknown>;
  thumbnail_key: string | null;
  status: DocumentStatus;
  ai_generated: boolean;
  ai_document_id: string | null;
  version_count: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface DocumentAccess {
  id: string;
  document_id: string;
  granted_to_id: string;
  granted_to_type: string;
  permission: AccessPermission;
  granted_by: string;
  /** Cross-DB FK: auth_db.consents.id */
  consent_id: string | null;
  notes: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export interface DocumentAccessLog {
  id: string;
  document_id: string;
  accessed_by: string;
  access_type: string;
  ip_address: string | null;
  user_agent: string | null;
  /** JSONB object containing additional access event metadata */
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface DocumentTag {
  id: string;
  name: string;
  category: string | null;
  created_by: string | null;
  usage_count: number;
  created_at: Date;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  /** S3 object key for this version of the file */
  file_key: string;
  file_name: string;
  /** File size in bytes */
  file_size: number;
  mime_type: string;
  /** SHA-256 checksum of this version */
  checksum: string | null;
  uploaded_by: string;
  change_notes: string | null;
  created_at: Date;
}
