CREATE TABLE "instance_role" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"permission" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instance_role_role_unique" UNIQUE("role")
);
--> statement-breakpoint
ALTER TABLE "instance_role" ADD CONSTRAINT "instance_role_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "instance_role_role_idx" ON "instance_role" USING btree ("role");