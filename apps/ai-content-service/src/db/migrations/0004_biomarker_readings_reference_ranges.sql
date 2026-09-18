CREATE TYPE "public"."range_sex" AS ENUM('any', 'male', 'female');--> statement-breakpoint
CREATE TYPE "public"."reading_entry_method" AS ENUM('manual', 'extracted');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biomarker_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"marker_code" varchar(64) NOT NULL,
	"value" numeric(12, 4) NOT NULL,
	"unit" varchar(32) NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"entry_method" "reading_entry_method" NOT NULL,
	"entered_by_auth_id" uuid NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "biomarker_reading_supersedes_unique" UNIQUE("supersedes_id"),
	CONSTRAINT "biomarker_reading_marker_code_format" CHECK ("biomarker_readings"."marker_code" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marker_code" varchar(64) NOT NULL,
	"marker_name" varchar(120) NOT NULL,
	"unit" varchar(32) NOT NULL,
	"sex" "range_sex" DEFAULT 'any' NOT NULL,
	"age_min_years" integer,
	"age_max_years" integer,
	"normal_low" numeric(12, 4),
	"normal_high" numeric(12, 4),
	"optimal_low" numeric(12, 4),
	"optimal_high" numeric(12, 4),
	"pillar" "rro_pillar",
	"source" text NOT NULL,
	"is_placeholder" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_range_marker_code_format" CHECK ("reference_ranges"."marker_code" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "reference_range_has_a_bound" CHECK ("reference_ranges"."normal_low" IS NOT NULL OR "reference_ranges"."normal_high" IS NOT NULL),
	CONSTRAINT "reference_range_normal_ordered" CHECK ("reference_ranges"."normal_low" IS NULL OR "reference_ranges"."normal_high" IS NULL OR "reference_ranges"."normal_low" <= "reference_ranges"."normal_high"),
	CONSTRAINT "reference_range_optimal_inside_normal" CHECK (("reference_ranges"."optimal_low" IS NULL OR "reference_ranges"."normal_low" IS NULL OR "reference_ranges"."optimal_low" >= "reference_ranges"."normal_low")
        AND ("reference_ranges"."optimal_high" IS NULL OR "reference_ranges"."normal_high" IS NULL OR "reference_ranges"."optimal_high" <= "reference_ranges"."normal_high")
        AND ("reference_ranges"."optimal_low" IS NULL OR "reference_ranges"."optimal_high" IS NULL OR "reference_ranges"."optimal_low" <= "reference_ranges"."optimal_high")),
	CONSTRAINT "reference_range_age_ordered" CHECK ("reference_ranges"."age_min_years" IS NULL OR "reference_ranges"."age_max_years" IS NULL OR "reference_ranges"."age_min_years" <= "reference_ranges"."age_max_years"),
	CONSTRAINT "reference_range_source_named" CHECK (length(trim("reference_ranges"."source")) > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "biomarker_readings" ADD CONSTRAINT "biomarker_readings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "biomarker_readings" ADD CONSTRAINT "biomarker_readings_supersedes_id_biomarker_readings_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."biomarker_readings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biomarker_reading_profile_marker_idx" ON "biomarker_readings" USING btree ("profile_id","marker_code","measured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biomarker_reading_document_idx" ON "biomarker_readings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reference_range_marker_idx" ON "reference_ranges" USING btree ("marker_code","retired_at");