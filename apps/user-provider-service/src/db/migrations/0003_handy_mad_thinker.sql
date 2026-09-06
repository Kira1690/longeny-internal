CREATE TYPE "public"."check_in_status" AS ENUM('submitted', 'reviewed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "adherence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"care_plan_id" uuid,
	"week_starting" timestamp with time zone NOT NULL,
	"item_key" varchar(120) NOT NULL,
	"target_count" integer NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"adherence_pct" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adherence_profile_week_item_unique" UNIQUE("profile_id","week_starting","item_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"submitted_by_auth_id" uuid NOT NULL,
	"week_starting" timestamp with time zone NOT NULL,
	"responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"energy_score" integer,
	"sleep_score" integer,
	"symptom_score" integer,
	"notes" text,
	"status" "check_in_status" DEFAULT 'submitted' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_in_profile_week_unique" UNIQUE("profile_id","week_starting")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adherence_profile_idx" ON "adherence" USING btree ("profile_id","week_starting");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "check_in_profile_idx" ON "check_ins" USING btree ("profile_id","week_starting");