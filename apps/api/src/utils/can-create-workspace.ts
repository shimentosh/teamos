import { isInstanceAdminRole } from "@kaneo/permissions";
import { eq } from "drizzle-orm";
import db, { schema } from "../database";

/**
 * Whether someone may create a workspace. Reserved for instance admins
 * (`super-admin` and `admin`).
 *
 * The role is read from the database rather than the session: sessions are
 * served out of a cookie cache (`session.cookieCache` in auth.ts), and the
 * first-user bootstrap promotes to super-admin only after sign-up has already
 * cached the pre-promotion role, so a cached session can still say
 * `role: "user"` for up to the cache's lifetime.
 */
export async function canCreateWorkspace(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId));

  return isInstanceAdminRole(user?.role);
}
