-- Role definitions moved out of the workspace. They used to live as one
-- `workspace_role` row per workspace per role; they now live once in
-- `instance_role`, which every permission check reads. `workspace_role` stays
-- behind as a derived mirror, because Better Auth's organization plugin
-- resolves its own endpoint permissions from per-organization rows.
--
-- Copy whatever this instance already has. A role name that several workspaces
-- defined differently collapses to one definition — the oldest wins — so say
-- so in the log before doing it.
--
-- Role names still missing afterwards (a fresh install has no `workspace_role`
-- rows at all) are seeded at boot from the compiled-in defaults in
-- @kaneo/permissions, which is also where the mirror is rebuilt.
--
-- Idempotent: only inserts role names the catalog does not already hold.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT "role", count(DISTINCT "permission") AS variants
    FROM "workspace_role"
    GROUP BY "role"
    HAVING count(DISTINCT "permission") > 1
  LOOP
    RAISE NOTICE 'Role "%" was defined % different ways across workspaces; the oldest definition wins in the instance catalog.', r."role", r.variants;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO "instance_role" ("id", "role", "permission", "created_at", "updated_at")
SELECT DISTINCT ON (wr."role")
  gen_random_uuid()::text,
  wr."role",
  wr."permission",
  wr."created_at",
  wr."updated_at"
FROM "workspace_role" wr
WHERE NOT EXISTS (
  SELECT 1 FROM "instance_role" ir WHERE ir."role" = wr."role"
)
ORDER BY wr."role", wr."created_at" ASC, wr."id" ASC;
