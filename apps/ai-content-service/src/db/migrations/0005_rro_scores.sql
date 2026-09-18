CREATE TABLE IF NOT EXISTS "rro_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"scoring_version" varchar(40) NOT NULL,
	"overall" numeric(4, 1),
	"result" json NOT NULL,
	"input_fingerprint" varchar(64) NOT NULL,
	"provisional" boolean NOT NULL,
	"computed_by_auth_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rro_score_profile_idx" ON "rro_scores" USING btree ("profile_id","created_at");