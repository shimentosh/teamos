import { isInstanceAdminRole, isSuperAdminRole } from "@kaneo/permissions";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import db from "../database";
import { userTable } from "../database/schema";

async function instanceRole(c: Context): Promise<string | null> {
  const user = c.get("user") as { role?: string | null } | null | undefined;
  if (user?.role) {
    return user.role;
  }

  const userId = c.get("userId");
  if (!userId) return null;

  const [row] = await db
    .select({ role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  return row?.role ?? null;
}

export async function isInstanceAdmin(c: Context): Promise<boolean> {
  return isInstanceAdminRole(await instanceRole(c));
}

/** The tier that may promote or demote other instance admins. */
export async function isSuperAdmin(c: Context): Promise<boolean> {
  return isSuperAdminRole(await instanceRole(c));
}
