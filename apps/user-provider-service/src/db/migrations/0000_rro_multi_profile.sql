CREATE TYPE "public"."admin_action_type" AS ENUM('verify_provider', 'suspend_provider', 'reactivate_provider', 'suspend_user', 'reactivate_user', 'delete_user', 'moderate_content', 'update_settings', 'export_data', 'approve_refund', 'reject_refund');--> statement-breakpoint
CREATE TYPE "public"."breach_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."caregiver_consent_status" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."day_of_week" AS ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('provider', 'program', 'product');--> statement-breakpoint
CREATE TYPE "public"."erasure_status" AS ENUM('pending', 'processing', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."export_type" AS ENUM('dsar', 'portable');--> statement-breakpoint
CREATE TYPE "public"."fitness_level" AS ENUM('beginner', 'intermediate', 'advanced', 'elite');--> statement-breakpoint
CREATE TYPE "public"."flag_status" AS ENUM('open', 'reviewing', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."flag_type" AS ENUM('inappropriate', 'spam', 'fake', 'harmful', 'copyright', 'other');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'non_binary', 'prefer_not_to_say');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('pending', 'in_progress', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."habit_frequency" AS ENUM('DAILY', 'WEEKLY', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'inactive', 'featured', 'archived');--> statement-breakpoint
CREATE TYPE "public"."metric_type" AS ENUM('weight', 'steps', 'sleep_hours', 'water_oz', 'calories', 'mood', 'energy', 'stress', 'custom');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('pending', 'approved', 'rejected', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('sms', 'email', 'calendar');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."onboarding_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."price_type" AS ENUM('one_time', 'subscription_monthly', 'subscription_yearly', 'per_session', 'free');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'out_of_stock', 'archived');--> statement-breakpoint
CREATE TYPE "public"."profile_relation" AS ENUM('self', 'father', 'mother', 'spouse', 'child', 'sibling', 'other');--> statement-breakpoint
CREATE TYPE "public"."profile_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."program_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."provider_status" AS ENUM('pending', 'verified', 'suspended', 'rejected', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."remediation_status" AS ENUM('investigating', 'contained', 'remediated', 'closed');--> statement-breakpoint
CREATE TYPE "public"."reminder_category" AS ENUM('habit', 'goal', 'wellness', 'custom');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'FLAGGED');--> statement-breakpoint
CREATE TYPE "public"."review_target_type" AS ENUM('PROVIDER', 'PROGRAM', 'PRODUCT');--> statement-breakpoint
CREATE TYPE "public"."rro_state_value" AS ENUM('intake', 'reverse', 'restore', 'optimise');--> statement-breakpoint
CREATE TYPE "public"."section_status" AS ENUM('not_started', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(100) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"icon" varchar(50),
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action_type" "admin_action_type" NOT NULL,
	"target_type" varchar(50) NOT NULL,
	"target_id" uuid NOT NULL,
	"details" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_type" varchar(100) NOT NULL,
	"metric_value" numeric(15, 2) NOT NULL,
	"dimensions" jsonb,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "availability_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"day_of_week" "day_of_week" NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"timezone" varchar(50) DEFAULT 'America/New_York' NOT NULL,
	"slot_duration_minutes" integer DEFAULT 60 NOT NULL,
	"buffer_minutes" integer DEFAULT 15 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"account_user_id" uuid NOT NULL,
	"consent_type" varchar(100) NOT NULL,
	"status" "caregiver_consent_status" DEFAULT 'granted' NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"document_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_consent_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consent_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"action" varchar(20) NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"parent_id" uuid,
	"icon_url" text,
	"listing_count" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name"),
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"flag_type" "flag_type" NOT NULL,
	"description" text,
	"reported_by" uuid NOT NULL,
	"evidence_urls" jsonb,
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_breach_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"breach_type" varchar(100) NOT NULL,
	"severity" "breach_severity" NOT NULL,
	"description" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"data_categories_affected" jsonb NOT NULL,
	"estimated_users_affected" integer DEFAULT 0 NOT NULL,
	"containment_actions" text,
	"dpa_notified" boolean DEFAULT false NOT NULL,
	"dpa_notified_at" timestamp with time zone,
	"users_notified" boolean DEFAULT false NOT NULL,
	"users_notified_at" timestamp with time zone,
	"remediation_status" "remediation_status" DEFAULT 'investigating' NOT NULL,
	"resolved_at" timestamp with time zone,
	"post_mortem_url" text,
	"reported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_export_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"export_type" "export_type" NOT NULL,
	"status" "export_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_url" text,
	"file_key" text,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"downloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "engagement_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"login_count" integer DEFAULT 0 NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"progress_count" integer DEFAULT 0 NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "featured_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gdpr_erasure_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "erasure_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grace_period_ends" timestamp with time zone NOT NULL,
	"services_completed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid,
	"title" varchar(200) NOT NULL,
	"description" text,
	"target_value" numeric(10, 2),
	"current_value" numeric(10, 2) DEFAULT '0' NOT NULL,
	"unit" varchar(50),
	"category" varchar(100),
	"status" "goal_status" DEFAULT 'pending' NOT NULL,
	"start_date" date NOT NULL,
	"target_date" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "habit_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"habit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"completed" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid,
	"title" varchar(200) NOT NULL,
	"description" text,
	"category" varchar(50),
	"frequency" "habit_frequency" DEFAULT 'DAILY' NOT NULL,
	"target_count" integer DEFAULT 1 NOT NULL,
	"unit" varchar(20),
	"reminder_time" time,
	"is_active" boolean DEFAULT true NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"total_completions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "health_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid,
	"height_cm" numeric(5, 1),
	"weight_kg" numeric(5, 1),
	"blood_type" varchar(5),
	"allergies_encrypted" text,
	"medical_conditions_encrypted" text,
	"medications_encrypted" text,
	"emergency_contact_encrypted" text,
	"notes" text,
	"last_checkup_date" date,
	"consent_health_sharing" boolean DEFAULT false NOT NULL,
	"consent_ai_analysis" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "moderation_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"reported_by" uuid,
	"auto_flagged" boolean DEFAULT false NOT NULL,
	"auto_flag_source" varchar(50),
	"priority" integer DEFAULT 5 NOT NULL,
	"status" "moderation_status" DEFAULT 'pending' NOT NULL,
	"assigned_to" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"action_taken" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"target_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"subject" varchar(255),
	"body" text,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"destination_encrypted" text NOT NULL,
	"destination_hash" text,
	"calendar_id" varchar(255),
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid,
	"current_step" integer DEFAULT 1 NOT NULL,
	"total_steps" integer DEFAULT 5 NOT NULL,
	"completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"step_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS "platform_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"category" varchar(50) NOT NULL,
	"description" text,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"short_description" varchar(500),
	"category" varchar(100) NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"compare_at_price" numeric(10, 2),
	"inventory_count" integer DEFAULT 0 NOT NULL,
	"sku" varchar(50),
	"image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributes" jsonb,
	"is_digital" boolean DEFAULT false NOT NULL,
	"digital_file_url" text,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_user_id" uuid NOT NULL,
	"relation" "profile_relation" NOT NULL,
	"is_self" boolean DEFAULT false NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100),
	"email" text,
	"phone_encrypted" text,
	"phone_hash" text,
	"date_of_birth_encrypted" text,
	"gender" "gender",
	"avatar_url" text,
	"notes" text,
	"status" "profile_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"short_description" varchar(500),
	"category" varchar(100) NOT NULL,
	"subcategory" varchar(100),
	"duration_weeks" integer,
	"session_count" integer,
	"session_duration_minutes" integer DEFAULT 60 NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"price_type" "price_type" DEFAULT 'one_time' NOT NULL,
	"max_participants" integer,
	"current_participants" integer DEFAULT 0 NOT NULL,
	"prerequisites" text,
	"what_to_expect" text,
	"outcomes" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_url" text,
	"is_featured" boolean DEFAULT false NOT NULL,
	"status" "program_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "progress_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid,
	"type" "metric_type" NOT NULL,
	"metric" varchar(100),
	"value" real NOT NULL,
	"unit" varchar(20),
	"notes" text,
	"date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_admin_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"onboarding_id" uuid NOT NULL,
	"check_key" varchar(50) NOT NULL,
	"is_checked" boolean DEFAULT false NOT NULL,
	"checked_by" uuid,
	"checked_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"parent_id" uuid,
	"icon_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_categories_name_unique" UNIQUE("name"),
	CONSTRAINT "provider_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_onboarding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"status" "onboarding_status" DEFAULT 'draft' NOT NULL,
	"basic_identity" jsonb,
	"basic_identity_status" "section_status" DEFAULT 'not_started' NOT NULL,
	"professional_credentials" jsonb,
	"professional_credentials_status" "section_status" DEFAULT 'not_started' NOT NULL,
	"license_verification" jsonb,
	"license_verification_status" "section_status" DEFAULT 'not_started' NOT NULL,
	"practice_services" jsonb,
	"practice_services_status" "section_status" DEFAULT 'not_started' NOT NULL,
	"scheduling_setup" jsonb,
	"scheduling_setup_status" "section_status" DEFAULT 'not_started' NOT NULL,
	"marketplace_profile" jsonb,
	"marketplace_profile_status" "section_status" DEFAULT 'not_started' NOT NULL,
	"banking_commercial" jsonb,
	"banking_commercial_status" "section_status" DEFAULT 'not_started' NOT NULL,
	"platform_readiness" jsonb,
	"platform_readiness_status" "section_status" DEFAULT 'not_started' NOT NULL,
	"document_capability" jsonb,
	"document_capability_status" "section_status" DEFAULT 'not_started' NOT NULL,
	"compliance_consents" jsonb,
	"compliance_consents_status" "section_status" DEFAULT 'not_started' NOT NULL,
	"legal_declarations" jsonb,
	"legal_declarations_status" "section_status" DEFAULT 'not_started' NOT NULL,
	"trust_layer" jsonb,
	"trust_layer_status" "section_status" DEFAULT 'not_started' NOT NULL,
	"completed_sections" integer DEFAULT 0 NOT NULL,
	"total_sections" integer DEFAULT 12 NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewer_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_onboarding_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"document_type" varchar(50) NOT NULL,
	"document_url" text NOT NULL,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"reviewed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_name" varchar(200) NOT NULL,
	"display_name" varchar(200),
	"bio" text,
	"specialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credentials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"years_experience" integer,
	"hourly_rate" numeric(8, 2),
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"location" jsonb,
	"service_area_radius_miles" integer,
	"offers_virtual" boolean DEFAULT true NOT NULL,
	"offers_in_person" boolean DEFAULT false NOT NULL,
	"status" "provider_status" DEFAULT 'pending' NOT NULL,
	"rating_avg" numeric(3, 2) DEFAULT '0' NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"total_bookings" integer DEFAULT 0 NOT NULL,
	"website_url" text,
	"social_links" jsonb,
	"cancellation_policy" text,
	"cancellation_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"message" text,
	"reminder_type" "reminder_category" NOT NULL,
	"related_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_helpful_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"response_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_responses_review_id_unique" UNIQUE("review_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" "review_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"title" varchar(200),
	"comment" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_moderated" boolean DEFAULT false NOT NULL,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"status" "review_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rro_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"current_state" "rro_state_value" DEFAULT 'intake' NOT NULL,
	"goal" text,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rro_state_profile_id_unique" UNIQUE("profile_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rro_transition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"from_state" "rro_state_value",
	"to_state" "rro_state_value" NOT NULL,
	"reason" text,
	"source" varchar(50) DEFAULT 'system' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "search_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"query" varchar(500) NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"results_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "search_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"category" varchar(100),
	"subcategory" varchar(100),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"specialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location_city" varchar(100),
	"location_state" varchar(50),
	"location_lat" numeric(10, 7),
	"location_lng" numeric(10, 7),
	"price_min" numeric(10, 2),
	"price_max" numeric(10, 2),
	"rating_avg" numeric(3, 2) DEFAULT '0' NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"provider_id" uuid,
	"provider_name" varchar(200),
	"provider_verified" boolean DEFAULT false NOT NULL,
	"offers_virtual" boolean DEFAULT false NOT NULL,
	"offers_in_person" boolean DEFAULT false NOT NULL,
	"ai_relevance_score" numeric(5, 4),
	"popularity_score" integer DEFAULT 0 NOT NULL,
	"image_url" text,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "specialties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specialties_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_email" boolean DEFAULT false NOT NULL,
	"notification_sms" boolean DEFAULT false NOT NULL,
	"notification_push" boolean DEFAULT false NOT NULL,
	"language" varchar(5) DEFAULT 'en' NOT NULL,
	"theme" varchar(10) DEFAULT 'light' NOT NULL,
	"newsletter" boolean DEFAULT false NOT NULL,
	"booking_reminders_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bio" text,
	"address_encrypted" text,
	"country" varchar(2) DEFAULT 'US' NOT NULL,
	"health_goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dietary_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fitness_level" "fitness_level",
	"wellness_interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_session_type" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_id" uuid NOT NULL,
	"email" text NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"phone_encrypted" text,
	"phone_hash" text,
	"avatar_url" text,
	"date_of_birth_encrypted" text,
	"gender" "gender",
	"timezone" varchar(50) DEFAULT 'America/New_York' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_id_unique" UNIQUE("auth_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_consent_profile_idx" ON "caregiver_consent" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_consent_account_idx" ON "caregiver_consent" USING btree ("account_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_consent_audit_profile_idx" ON "caregiver_consent_audit" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_profile_idx" ON "goals" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "habits_profile_idx" ON "habits" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_log_profile_idx" ON "notification_log" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_targets_profile_idx" ON "notification_targets" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_state_profile_idx" ON "onboarding_state" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phi_access_log_profile_idx" ON "phi_access_log" USING btree ("profile_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phi_access_log_actor_idx" ON "phi_access_log" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phi_access_log_denied_idx" ON "phi_access_log" USING btree ("success","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profiles_account_idx" ON "profiles" USING btree ("account_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profiles_account_status_idx" ON "profiles" USING btree ("account_user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "progress_entries_profile_idx" ON "progress_entries" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rro_transition_profile_idx" ON "rro_transition" USING btree ("profile_id","created_at");