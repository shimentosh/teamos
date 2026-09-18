CREATE TABLE "ai_teammate" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"instructions" text,
	"time" text DEFAULT '09:00' NOT NULL,
	"days" text DEFAULT '1,2,3,4,5' NOT NULL,
	"mode" text DEFAULT 'suggest' NOT NULL,
	"channel_id" text,
	"last_run_at" timestamp,
	"last_run_day" text,
	"last_change_set_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_teammate" ADD CONSTRAINT "ai_teammate_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_teammate" ADD CONSTRAINT "ai_teammate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_teammate_workspace_user_kind_idx" ON "ai_teammate" USING btree ("workspace_id","user_id","kind");