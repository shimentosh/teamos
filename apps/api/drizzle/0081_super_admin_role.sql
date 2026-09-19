-- Instance roles gained a `super-admin` tier above `admin`. A fresh instance
-- promotes its first signup to `super-admin` in Better Auth's user-create hook,
-- but an existing instance already has an `admin` and would otherwise end up
-- with nobody able to hand out instance roles. Promote the oldest admin — the
-- one the old bootstrap picked — and leave any other admins where they are.
--
-- Idempotent: does nothing once a super-admin exists.
UPDATE "user"
SET "role" = 'super-admin'
WHERE "id" = (
  SELECT "id" FROM "user"
  WHERE "role" = 'admin'
  ORDER BY "created_at" ASC, "id" ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM "user" WHERE "role" = 'super-admin'
);
