CREATE TYPE "public"."report_processing_status" AS ENUM('awaiting_upload', 'uploaded', 'reading', 'read', 'failed', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."report_read_method" AS ENUM('text_layer', 'ocr', 'mixed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"method" "report_read_method" NOT NULL,
	"text" text NOT NULL,
	"tables" json DEFAULT '[]'::json NOT NULL,
	"ocr_confidence" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_pages_document_page_unique" UNIQUE("document_id","page_number"),
	CONSTRAINT "report_pages_page_number_positive" CHECK ("report_pages"."page_number" >= 1),
	CONSTRAINT "report_pages_method_not_mixed" CHECK ("report_pages"."method" <> 'mixed')
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "rro_state_at_upload" "rro_state_value";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processing_status" "report_processing_status" DEFAULT 'awaiting_upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "read_method" "report_read_method";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processing_error" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processing_note" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_pages" ADD CONSTRAINT "report_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_processing_queue_idx" ON "documents" USING btree ("processing_status","claimed_at") WHERE "documents"."processing_status" IN ('uploaded', 'reading');--> statement-breakpoint
-- Rows written before processing existed. A patient's readable report is queued
-- to be read once; medical imaging and practice-owned files are never read.
UPDATE "documents" SET "processing_status" = 'uploaded'
  WHERE "owner_type" = 'user'
    AND "profile_id" IS NOT NULL
    AND "status" <> 'deleted'
    AND "mime_type" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/tiff');--> statement-breakpoint
UPDATE "documents" SET "processing_status" = 'not_applicable'
  WHERE "processing_status" = 'awaiting_upload';
