ALTER TABLE "habit_checkins" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "habit_checkins_profile_idx" ON "habit_checkins" USING btree ("profile_id","date");