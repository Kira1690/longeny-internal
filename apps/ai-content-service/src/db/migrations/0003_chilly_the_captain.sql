CREATE TABLE IF NOT EXISTS "onboarding_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(128) NOT NULL,
	"auth_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_session_auth_idx" ON "onboarding_sessions" USING btree ("auth_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_session_profile_idx" ON "onboarding_sessions" USING btree ("profile_id");