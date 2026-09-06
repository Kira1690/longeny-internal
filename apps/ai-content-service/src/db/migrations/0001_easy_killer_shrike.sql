CREATE TYPE "public"."ai_provider" AS ENUM('bedrock', 'rules');--> statement-breakpoint
CREATE TYPE "public"."care_plan_status" AS ENUM('draft', 'pending_approval', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."rro_pillar" AS ENUM('nutrition', 'movement', 'sleep', 'stress', 'environment');--> statement-breakpoint
CREATE TYPE "public"."rro_state_value" AS ENUM('intake', 'reverse', 'restore', 'optimise');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "care_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"state_at_creation" "rro_state_value",
	"pillars" json DEFAULT '[]'::json NOT NULL,
	"status" "care_plan_status" DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intake_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"submitted_by_auth_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"symptoms" json DEFAULT '[]'::json NOT NULL,
	"goals" json DEFAULT '[]'::json NOT NULL,
	"conditions" json DEFAULT '[]'::json NOT NULL,
	"medications" json DEFAULT '[]'::json NOT NULL,
	"pillar_priorities" json DEFAULT '[]'::json NOT NULL,
	"notes" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_profile_version_unique" UNIQUE("profile_id","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"care_plan_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content" json DEFAULT '{}'::json NOT NULL,
	"change_summary" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_version_unique" UNIQUE("care_plan_id","version_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rro_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"intake_id" uuid,
	"intake_version" integer,
	"provider" "ai_provider" NOT NULL,
	"model_id" varchar(100),
	"contract_version" varchar(10) NOT NULL,
	"prompt_version" varchar(20) NOT NULL,
	"state" "rro_state_value",
	"confidence" numeric(4, 3),
	"pillar_priorities" json DEFAULT '[]'::json NOT NULL,
	"rationale" text,
	"missing_data" json DEFAULT '[]'::json NOT NULL,
	"refused_reason" varchar(40),
	"refused_detail" text,
	"transitioned" boolean DEFAULT false NOT NULL,
	"not_transitioned_reason" varchar(60),
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rro_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"intake_id" uuid,
	"intake_version" integer,
	"provider" "ai_provider" NOT NULL,
	"model_id" varchar(100),
	"contract_version" varchar(10) NOT NULL,
	"prompt_version" varchar(20) NOT NULL,
	"current_state" "rro_state_value",
	"concerns" json DEFAULT '[]'::json NOT NULL,
	"missing_data" json DEFAULT '[]'::json NOT NULL,
	"red_flags" json DEFAULT '[]'::json NOT NULL,
	"suggested_questions" json DEFAULT '[]'::json NOT NULL,
	"sufficient_data" boolean DEFAULT false NOT NULL,
	"refused_reason" varchar(40),
	"refused_detail" text,
	"latency_ms" integer,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "reported_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_plan_profile_idx" ON "care_plans" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_plan_status_idx" ON "care_plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_profile_idx" ON "intake_submissions" USING btree ("profile_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_submitted_idx" ON "intake_submissions" USING btree ("profile_id","submitted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_version_plan_idx" ON "plan_versions" USING btree ("care_plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rro_classification_profile_idx" ON "rro_classifications" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rro_classification_intake_idx" ON "rro_classifications" USING btree ("intake_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rro_summary_profile_idx" ON "rro_summaries" USING btree ("profile_id","generated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_profile_idx" ON "documents" USING btree ("profile_id","reported_at");