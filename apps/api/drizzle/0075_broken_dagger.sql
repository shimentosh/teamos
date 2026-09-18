CREATE TABLE "workspace_notification_policy" (
	"workspace_id" text NOT NULL,
	"event_key" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_notification_policy_workspace_id_event_key_pk" PRIMARY KEY("workspace_id","event_key")
);
--> statement-breakpoint
ALTER TABLE "workspace_notification_policy" ADD CONSTRAINT "workspace_notification_policy_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace_notification_policy" ADD CONSTRAINT "workspace_notification_policy_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;