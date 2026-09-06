CREATE TABLE IF NOT EXISTS "phi_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" varchar(64) NOT NULL,
	"actor_role" varchar(50),
	"profile_id" uuid,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50),
	"resource_id" varchar(64),
	"purpose" varchar(100) NOT NULL,
	"method" varchar(10) NOT NULL,
	"path" text NOT NULL,
	"status_code" integer NOT NULL,
	"success" boolean NOT NULL,
	"duration_ms" integer NOT NULL,
	"ip" varchar(64),
	"user_agent" text,
	"correlation_id" varchar(100),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_phi_access_log_profile_idx" ON "phi_access_log" USING btree ("profile_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_phi_access_log_actor_idx" ON "phi_access_log" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_phi_access_log_denied_idx" ON "phi_access_log" USING btree ("success","occurred_at");