-- Chat channels used to be open to everyone in the workspace: anyone could
-- create one, and only its creator (or workspace:manage_settings) could delete
-- it. They are now covered by the `channel` resource, so grant it to the
-- default roles that had those abilities before. Roles an owner already
-- configured for `channel` are left as is, as are custom roles: an admin turns
-- the new toggles on for those in Settings > Roles. Unparseable rows are
-- skipped.
DO $$
DECLARE
  r RECORD;
  grants jsonb := '{
    "member": ["create"],
    "manager": ["create", "update", "delete"],
    "admin": ["create", "update", "delete"]
  }'::jsonb;
  current jsonb;
BEGIN
  FOR r IN
    SELECT "id", "role", "permission" FROM "workspace_role"
    WHERE "role" IN ('member', 'manager', 'admin')
  LOOP
    BEGIN
      current := r."permission"::jsonb;
      IF NOT (current ? 'channel') THEN
        current := current || jsonb_build_object('channel', grants -> r."role");
        UPDATE "workspace_role" SET "permission" = current::text WHERE "id" = r."id";
      END IF;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipping workspace_role % with unparseable permission', r."id";
    END;
  END LOOP;
END $$;
