CREATE TABLE "project_member" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "project_member_user_idx" ON "project_member" USING btree ("user_id");--> statement-breakpoint
-- task:read_all is new: without it a member sees only the tasks assigned to
-- them. Every role that could read tasks keeps seeing all of them, except the
-- built-in member role, which now sees its own. Unparseable rows are skipped
-- rather than failing the upgrade.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT "id", "permission" FROM "workspace_role"
    WHERE "role" <> 'member'
  LOOP
    BEGIN
      IF (r."permission"::jsonb -> 'task') ? 'read'
        AND NOT ((r."permission"::jsonb -> 'task') ? 'read_all') THEN
        UPDATE "workspace_role"
        SET "permission" = jsonb_set(
          r."permission"::jsonb,
          '{task}',
          (r."permission"::jsonb -> 'task') || '["read_all"]'::jsonb
        )::text
        WHERE "id" = r."id";
      END IF;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipping workspace_role % with unparseable permission', r."id";
    END;
  END LOOP;
END $$;
