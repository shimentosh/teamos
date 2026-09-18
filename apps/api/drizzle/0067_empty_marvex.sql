CREATE TABLE "user_storage" (
	"user_id" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"bucket" text NOT NULL,
	"region" text DEFAULT 'auto' NOT NULL,
	"access_key_id" text NOT NULL,
	"secret_access_key" text NOT NULL,
	"key_prefix" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stored_file" ADD COLUMN "storage_owner_id" text;--> statement-breakpoint
ALTER TABLE "user_storage" ADD CONSTRAINT "user_storage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_storage_owner_id_user_id_fk" FOREIGN KEY ("storage_owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
-- Move each workspace bucket to its owner's account. An owner with several
-- bucketed workspaces keeps the most recently updated one.
INSERT INTO "user_storage" ("user_id", "endpoint", "bucket", "region", "access_key_id", "secret_access_key", "key_prefix", "updated_at")
SELECT DISTINCT ON (wm."user_id")
  wm."user_id", ws."endpoint", ws."bucket", ws."region", ws."access_key_id", ws."secret_access_key", ws."key_prefix", ws."updated_at"
FROM "workspace_storage" ws
JOIN "workspace_member" wm ON wm."workspace_id" = ws."workspace_id" AND wm."role" = 'owner'
ORDER BY wm."user_id", ws."updated_at" DESC
ON CONFLICT ("user_id") DO NOTHING;--> statement-breakpoint
-- Files in a bucket that moved now point at the owner's account.
UPDATE "stored_file" sf
SET "storage_owner_id" = us."user_id"
FROM "workspace_storage" ws
JOIN "workspace_member" wm ON wm."workspace_id" = ws."workspace_id" AND wm."role" = 'owner'
JOIN "user_storage" us ON us."user_id" = wm."user_id"
  AND us."endpoint" = ws."endpoint" AND us."bucket" = ws."bucket" AND us."key_prefix" = ws."key_prefix"
WHERE sf."workspace_id" = ws."workspace_id" AND sf."storage" = 's3';--> statement-breakpoint
-- Workspace rows that moved are gone; a clashing one stays and keeps working.
DELETE FROM "workspace_storage" ws
USING "workspace_member" wm, "user_storage" us
WHERE wm."workspace_id" = ws."workspace_id" AND wm."role" = 'owner'
  AND us."user_id" = wm."user_id"
  AND us."endpoint" = ws."endpoint" AND us."bucket" = ws."bucket" AND us."key_prefix" = ws."key_prefix";
