ALTER TABLE "orders" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_profile_idx" ON "orders" USING btree ("profile_id","created_at");