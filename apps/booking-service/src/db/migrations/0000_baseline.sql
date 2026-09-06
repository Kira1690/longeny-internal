CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."calendar_sync_status" AS ENUM('active', 'disconnected', 'error', 'syncing');--> statement-breakpoint
CREATE TYPE "public"."cancelled_by" AS ENUM('user', 'provider', 'system');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('booking', 'payment', 'system', 'marketing', 'reminder', 'document', 'provider', 'progress');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'queued', 'sent', 'delivered', 'failed', 'read');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('email', 'sms', 'push', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."push_platform" AS ENUM('ios', 'android', 'web');--> statement-breakpoint
CREATE TYPE "public"."recurring_booking_status" AS ENUM('active', 'paused', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('pending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reminder_type" AS ENUM('24h', '1h', '15min');--> statement-breakpoint
CREATE TYPE "public"."scheduled_notification_status" AS ENUM('pending', 'sent', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."session_type" AS ENUM('consultation', 'followup', 'assessment', 'program_session', 'custom');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('active', 'draft', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('waiting', 'notified', 'booked', 'expired');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reminder_type" "reminder_type" NOT NULL,
	"message" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"status" "reminder_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"program_id" uuid,
	"session_type" "session_type" DEFAULT 'consultation' NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"title" varchar(200),
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"timezone" varchar(50) NOT NULL,
	"notes" text,
	"provider_notes" text,
	"meeting_link" text,
	"is_virtual" boolean DEFAULT true NOT NULL,
	"location_address" text,
	"price" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"order_id" uuid,
	"cancellation_reason" text,
	"cancelled_by" "cancelled_by",
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"google_event_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"google_calendar_id" varchar(255),
	"google_access_token_encrypted" text,
	"google_refresh_token_encrypted" text,
	"sync_token" text,
	"last_synced_at" timestamp with time zone,
	"status" "calendar_sync_status" DEFAULT 'disconnected' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_sync_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"booking_email" boolean DEFAULT false NOT NULL,
	"booking_sms" boolean DEFAULT false NOT NULL,
	"booking_push" boolean DEFAULT false NOT NULL,
	"payment_email" boolean DEFAULT false NOT NULL,
	"payment_sms" boolean DEFAULT false NOT NULL,
	"payment_push" boolean DEFAULT false NOT NULL,
	"reminder_email" boolean DEFAULT false NOT NULL,
	"reminder_sms" boolean DEFAULT false NOT NULL,
	"reminder_push" boolean DEFAULT false NOT NULL,
	"document_email" boolean DEFAULT false NOT NULL,
	"document_push" boolean DEFAULT false NOT NULL,
	"provider_email" boolean DEFAULT false NOT NULL,
	"provider_push" boolean DEFAULT false NOT NULL,
	"progress_push" boolean DEFAULT false NOT NULL,
	"marketing_email" boolean DEFAULT false NOT NULL,
	"marketing_sms" boolean DEFAULT false NOT NULL,
	"system_email" boolean DEFAULT true NOT NULL,
	"system_push" boolean DEFAULT true NOT NULL,
	"quiet_hours_start" varchar(8),
	"quiet_hours_end" varchar(8),
	"timezone" varchar(50) DEFAULT 'America/New_York' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" "notification_type" NOT NULL,
	"category" "notification_category" NOT NULL,
	"subject" varchar(200),
	"body_template" text NOT NULL,
	"body_html_template" text,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "template_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"booking_id" uuid,
	"type" "notification_type" NOT NULL,
	"category" "notification_category" NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"body_html" text,
	"data" jsonb,
	"template_id" uuid,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"external_message_id" varchar(200),
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" varchar(200) NOT NULL,
	"token" text NOT NULL,
	"platform" "push_platform" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"program_id" uuid,
	"session_type" "session_type" DEFAULT 'consultation' NOT NULL,
	"recurrence_rule" varchar(255) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "recurring_booking_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid,
	"user_id" uuid NOT NULL,
	"template_id" uuid,
	"type" "notification_type" NOT NULL,
	"category" "notification_category" NOT NULL,
	"template_data" jsonb,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"status" "scheduled_notification_status" DEFAULT 'pending' NOT NULL,
	"reference_type" varchar(50),
	"reference_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"preferred_date_start" date NOT NULL,
	"preferred_date_end" date NOT NULL,
	"session_type" "session_type" DEFAULT 'consultation' NOT NULL,
	"status" "waitlist_status" DEFAULT 'waiting' NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
