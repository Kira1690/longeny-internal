CREATE TYPE "public"."AccessGrantedToType" AS ENUM('user', 'provider');--> statement-breakpoint
CREATE TYPE "public"."AccessPermission" AS ENUM('view', 'download');--> statement-breakpoint
CREATE TYPE "public"."AccessType" AS ENUM('view', 'download', 'share', 'revoke', 'upload', 'delete');--> statement-breakpoint
CREATE TYPE "public"."AiDocumentStatus" AS ENUM('draft', 'pending_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."AiDocumentType" AS ENUM('prescription', 'nutrition_plan', 'training_plan');--> statement-breakpoint
CREATE TYPE "public"."AiRequestStatus" AS ENUM('pending', 'completed', 'failed', 'cached');--> statement-breakpoint
CREATE TYPE "public"."AiRequestType" AS ENUM('recommendation', 'health_analysis', 'document_gen', 'embedding');--> statement-breakpoint
CREATE TYPE "public"."DocOwnerType" AS ENUM('user', 'provider');--> statement-breakpoint
CREATE TYPE "public"."DocStatus" AS ENUM('processing', 'active', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."DocumentType" AS ENUM('lab_report', 'prescription', 'imaging', 'insurance', 'certificate', 'other');--> statement-breakpoint
CREATE TYPE "public"."EmbeddingEntityType" AS ENUM('provider', 'program', 'product', 'user_profile');--> statement-breakpoint
CREATE TYPE "public"."PromptSafetyLevel" AS ENUM('low', 'standard', 'high');--> statement-breakpoint
CREATE TYPE "public"."PromptStatus" AS ENUM('draft', 'active', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."RecommendationType" AS ENUM('providers', 'programs', 'products', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."SafetyFlagCategory" AS ENUM('harmful_health_advice', 'inappropriate_content', 'pii_leak', 'prompt_injection');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"request_type" "AiRequestType" NOT NULL,
	"model" varchar(50) NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"status" "AiRequestStatus" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"correlation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"model_id" varchar(50) NOT NULL,
	"purpose" varchar(100),
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"granted_to_id" uuid NOT NULL,
	"granted_to_type" "AccessGrantedToType" NOT NULL,
	"permission" "AccessPermission" DEFAULT 'view' NOT NULL,
	"granted_by" uuid NOT NULL,
	"consent_id" uuid,
	"notes" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_access_document_id_granted_to_id_unique" UNIQUE("document_id","granted_to_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"accessed_by" uuid NOT NULL,
	"access_type" "AccessType" NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"metadata" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"category" varchar(50),
	"created_by" uuid,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"file_key" varchar(500) NOT NULL,
	"file_size" bigint NOT NULL,
	"changes_summary" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_document_id_version_number_unique" UNIQUE("document_id","version_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_type" "DocOwnerType" NOT NULL,
	"document_type" "DocumentType" NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text,
	"file_key" varchar(500) NOT NULL,
	"file_name" varchar(300) NOT NULL,
	"file_size" bigint NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"encryption_key_id" varchar(200),
	"checksum" varchar(64),
	"tags" json DEFAULT '[]'::json NOT NULL,
	"metadata" json DEFAULT '{}'::json NOT NULL,
	"thumbnail_key" varchar(500),
	"status" "DocStatus" DEFAULT 'active' NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"ai_document_id" uuid,
	"version_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "EmbeddingEntityType" NOT NULL,
	"entity_id" uuid NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"metadata" json DEFAULT '{}'::json NOT NULL,
	"model_version" varchar(50) DEFAULT 'amazon.titan-embed-text-v2' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embeddings_entity_type_entity_id_unique" UNIQUE("entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generated_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"prompt_template_id" uuid,
	"ai_request_id" uuid,
	"document_type" "AiDocumentType" NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" json NOT NULL,
	"raw_ai_response" text,
	"status" "AiDocumentStatus" DEFAULT 'draft' NOT NULL,
	"ai_model" varchar(50) NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"approved_at" timestamp with time zone,
	"s3_file_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"category" varchar(50) NOT NULL,
	"system_prompt" text NOT NULL,
	"user_prompt_template" text NOT NULL,
	"output_schema" json,
	"variables" json DEFAULT '[]'::json NOT NULL,
	"max_tokens" integer DEFAULT 2000 NOT NULL,
	"temperature" numeric(2, 1) DEFAULT '0.7' NOT NULL,
	"safety_level" "PromptSafetyLevel" DEFAULT 'standard' NOT NULL,
	"status" "PromptStatus" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recommendation_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"recommendation_type" "RecommendationType" NOT NULL,
	"results" json NOT NULL,
	"score_breakdown" json,
	"query_context" json,
	"model_used" varchar(50),
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recommendation_cache_user_id_recommendation_type_unique" UNIQUE("user_id","recommendation_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "safety_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_request_id" uuid,
	"user_id" uuid,
	"input_text_hash" varchar(64),
	"output_flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" varchar(200),
	"flag_category" "SafetyFlagCategory",
	"input_filtered" boolean DEFAULT false NOT NULL,
	"output_modified" boolean DEFAULT false NOT NULL,
	"disclaimer_injected" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid,
	"review_status" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_requests_user_idx" ON "ai_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_requests_type_idx" ON "ai_requests" USING btree ("request_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_requests_created_idx" ON "ai_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_access_doc_idx" ON "document_access" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_access_granted_idx" ON "document_access" USING btree ("granted_to_id","granted_to_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_log_doc_idx" ON "document_access_log" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_log_accessed_by_idx" ON "document_access_log" USING btree ("accessed_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_log_created_idx" ON "document_access_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_versions_doc_idx" ON "document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_owner_idx" ON "documents" USING btree ("owner_id","owner_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_entity_idx" ON "embeddings" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gen_docs_user_idx" ON "generated_documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gen_docs_provider_idx" ON "generated_documents" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gen_docs_status_idx" ON "generated_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rec_cache_user_idx" ON "recommendation_cache" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rec_cache_expires_idx" ON "recommendation_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "safety_logs_request_idx" ON "safety_logs" USING btree ("ai_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "safety_logs_created_idx" ON "safety_logs" USING btree ("created_at");