ALTER TABLE "bookings" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_profile_idx" ON "bookings" USING btree ("profile_id","start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_provider_profile_idx" ON "bookings" USING btree ("provider_id","profile_id");