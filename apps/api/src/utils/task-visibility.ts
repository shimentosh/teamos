import { and, eq, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { isInstanceAdmin } from "./is-instance-admin";
import {
  getMemberRole,
  getRoleStatements,
} from "./require-workspace-permission";

// Who sees which tasks. A role with task:read_all sees every task in the
// workspace; anyone else sees only the tasks assigned to them, and the
// projects they're on the team of or have a task in.

const cache = new WeakMap<Context, Promise<string | null>>();

async function computeRestriction(c: Context): Promise<string | null> {
  const userId = c.get("userId") as string | undefined;
  const workspaceId = c.get("workspaceId") as string | undefined;
  if (!userId || !workspaceId) return null;
  if (await isInstanceAdmin(c)) return null;

  return (await seesEveryTask(workspaceId, userId)) ? null : userId;
}

/** Whether a workspace member's role lets them see every task. */
export async function seesEveryTask(workspaceId: string, userId: string) {
  const role = await getMemberRole(workspaceId, userId);
  if (!role) return false;
  // A member's role string can name several roles; any of them may grant it.
  for (const name of role.split(",").map((part) => part.trim())) {
    const statements = name ? await getRoleStatements(name) : null;
    if (statements?.task?.includes("read_all")) return true;
  }
  return false;
}

/**
 * The user whose assigned tasks bound what this request may see, or null
 * when it may see every task in the workspace. Needs workspace access to
 * have run first.
 */
export function taskViewer(c: Context): Promise<string | null> {
  let result = cache.get(c);
  if (!result) {
    result = computeRestriction(c);
    cache.set(c, result);
  }
  return result;
}

/** A where-clause for taskTable limited to what `viewer` may see. */
export function visibleTasks(viewer: string | null): SQL | undefined {
  return viewer ? eq(schema.taskTable.userId, viewer) : undefined;
}

/** A where-clause for projectTable limited to what `viewer` may see. */
export function visibleProjects(viewer: string | null): SQL | undefined {
  if (!viewer) return undefined;
  // Uncorrelated subqueries, so this also works inside relational queries,
  // which alias the outer table.
  return or(
    inArray(
      schema.projectTable.id,
      db
        .select({ id: schema.projectMemberTable.projectId })
        .from(schema.projectMemberTable)
        .where(eq(schema.projectMemberTable.userId, viewer)),
    ),
    inArray(
      schema.projectTable.id,
      db
        .select({ id: schema.taskTable.projectId })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.userId, viewer)),
    ),
  );
}

const notFound = () => new HTTPException(404, { message: "Task not found" });

/** 404s unless every task is one this request may see. */
export async function assertTasksVisible(c: Context, taskIds: string[]) {
  const viewer = await taskViewer(c);
  if (!viewer || taskIds.length === 0) return;
  const [hidden] = await db
    .select({ id: schema.taskTable.id })
    .from(schema.taskTable)
    .where(
      and(
        inArray(schema.taskTable.id, taskIds),
        or(
          sql`${schema.taskTable.userId} IS NULL`,
          ne(schema.taskTable.userId, viewer),
        ),
      ),
    )
    .limit(1);
  if (hidden) throw notFound();
}

/** 404s unless the project is one this request may see. */
export async function assertProjectVisible(c: Context, projectId: string) {
  const viewer = await taskViewer(c);
  if (!viewer) return;
  const [project] = await db
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(and(eq(schema.projectTable.id, projectId), visibleProjects(viewer)))
    .limit(1);
  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }
}
