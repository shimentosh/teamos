import { and, asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectMemberTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";

export async function listProjectMembers(projectId: string) {
  return db
    .select({
      userId: projectMemberTable.userId,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
      addedAt: projectMemberTable.createdAt,
    })
    .from(projectMemberTable)
    .innerJoin(userTable, eq(projectMemberTable.userId, userTable.id))
    .where(eq(projectMemberTable.projectId, projectId))
    .orderBy(asc(projectMemberTable.createdAt), asc(userTable.name));
}

/** Adds a workspace member to the project's team; adding twice is a no-op. */
export async function addProjectMember(
  workspaceId: string,
  projectId: string,
  userId: string,
  addedBy: string | null,
) {
  const [member] = await db
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!member) {
    throw new HTTPException(400, {
      message: "Only workspace members can join a project",
    });
  }
  await db
    .insert(projectMemberTable)
    .values({ projectId, userId, addedBy })
    .onConflictDoNothing();
  return listProjectMembers(projectId);
}

export async function removeProjectMember(projectId: string, userId: string) {
  await db
    .delete(projectMemberTable)
    .where(
      and(
        eq(projectMemberTable.projectId, projectId),
        eq(projectMemberTable.userId, userId),
      ),
    );
  return listProjectMembers(projectId);
}
