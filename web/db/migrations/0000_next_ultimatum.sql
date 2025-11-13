DROP TYPE IF EXISTS "public"."story_status" CASCADE;
DROP TYPE IF EXISTS "public"."media_type" CASCADE;
DROP TYPE IF EXISTS "public"."generation_job_status" CASCADE;
DROP TYPE IF EXISTS "public"."generation_job_type" CASCADE;
DROP TYPE IF EXISTS "public"."user_role" CASCADE;

CREATE TYPE "public"."story_status" AS ENUM('draft', 'scheduled', 'processing', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('image', 'audio', 'video');--> statement-breakpoint
CREATE TYPE "public"."generation_job_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."generation_job_type" AS ENUM('story_script', 'translation', 'vocabulary', 'image', 'audio', 'video');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('parent', 'admin');--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title_en" varchar(200) NOT NULL,
	"title_zh" varchar(200) NOT NULL,
	"theme" varchar(120) NOT NULL,
	"status" "story_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"age_range" varchar(20) DEFAULT '0-6' NOT NULL,
	"created_by" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"page_number" smallint NOT NULL,
	"text_en" text NOT NULL,
	"text_zh" text NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"media_asset_id" uuid,
	"audio_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"page_id" uuid,
	"type" "media_type" NOT NULL,
	"uri" text NOT NULL,
	"format" varchar(50) NOT NULL,
	"duration" varchar(20),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generation_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocab_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"word" varchar(120) NOT NULL,
	"part_of_speech" varchar(60),
	"definition_en" text NOT NULL,
	"definition_zh" text NOT NULL,
	"example_sentence" text,
	"example_translation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"job_type" "generation_job_type" NOT NULL,
	"status" "generation_job_status" DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_uri" varchar(512),
	"failure_reason" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_date" timestamp with time zone NOT NULL,
	"story_count" smallint DEFAULT 2 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failed_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_job_id" uuid NOT NULL,
	"error_code" text,
	"error_message" text NOT NULL,
	"resolved" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(120) NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'parent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_pages" ADD CONSTRAINT "story_pages_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_pages" ADD CONSTRAINT "story_pages_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_pages" ADD CONSTRAINT "story_pages_audio_asset_id_media_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_page_id_story_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."story_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocab_entries" ADD CONSTRAINT "vocab_entries_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failed_jobs" ADD CONSTRAINT "failed_jobs_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;