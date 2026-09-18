CREATE TABLE "expense_category" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT 'Tag' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "task_id" text;--> statement-breakpoint
ALTER TABLE "expense_category" ADD CONSTRAINT "expense_category_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expense_category" ADD CONSTRAINT "expense_category_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_category_workspace_name_idx" ON "expense_category" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "expense_taskId_idx" ON "expense" USING btree ("task_id");