ALTER TABLE "ai_change_set" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "ai_change_set" ADD COLUMN "claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_change_set" ADD CONSTRAINT "ai_change_set_device_id_agent_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."agent_device"("id") ON DELETE set null ON UPDATE cascade;