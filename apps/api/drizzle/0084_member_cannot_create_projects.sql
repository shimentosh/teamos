-- Projects are no longer opened by everyone. A member works inside the
-- projects they are on the team of and sees only the tasks assigned to them,
-- so `project:create` leaves the default `member` role; an admin (or any role
-- given the permission in Settings > Roles) creates projects.
--
-- The compiled-in default only reaches a fresh install, so existing rows have
-- to be edited too: the catalog, and the `workspace_role` mirror that Better
-- Auth reads. Other roles and other resources are left alone, as are rows
-- whose permission JSON cannot be parsed.
--
-- Idempotent: removing an element that is already gone is a no-op.
DO $$
DECLARE
  r RECORD;
  current jsonb;
  remaining jsonb;
BEGIN
  FOR r IN
    SELECT 'instance_role' AS tbl, "id", "permission" FROM "instance_role" WHERE "role" = 'member'
    UNION ALL
    SELECT 'workspace_role' AS tbl, "id", "permission" FROM "workspace_role" WHERE "role" = 'member'
  LOOP
    BEGIN
      current := r."permission"::jsonb;
      IF current ? 'project' AND current -> 'project' @> '["create"]'::jsonb THEN
        remaining := (
          SELECT coalesce(jsonb_agg(value), '[]'::jsonb)
          FROM jsonb_array_elements(current -> 'project')
          WHERE value <> '"create"'::jsonb
        );
        current := jsonb_set(current, '{project}', remaining);
        IF r.tbl = 'instance_role' THEN
          UPDATE "instance_role" SET "permission" = current::text WHERE "id" = r."id";
        ELSE
          UPDATE "workspace_role" SET "permission" = current::text WHERE "id" = r."id";
        END IF;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipping % row % with unparseable permission', r.tbl, r."id";
    END;
  END LOOP;
END $$;
