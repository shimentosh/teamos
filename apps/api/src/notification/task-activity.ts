import { and, eq, notInArray } from "drizzle-orm";
import db from "../database";
import {
  projectMemberTable,
  projectTable,
  userTable,
} from "../database/schema";
import { subscribeToEvent } from "../events";
import { seesEveryTask } from "../utils/task-visibility";
import createNotification from "./controllers/create-notification";

async function projectOf(projectId: string) {
  const [project] = await db
    .select({
      name: projectTable.name,
      workspaceId: projectTable.workspaceId,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return project ?? null;
}

async function nameOf(userId: string | undefined) {
  if (!userId) return null;
  const [user] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return user?.name ?? null;
}

/**
 * The project's team, minus the people already told some other way. Only
 * those who can see every task: a member limited to their own tasks must
 * not learn about someone else's.
 */
async function teamToTell(
  workspaceId: string,
  projectId: string,
  exclude: string[],
) {
  const rows = await db
    .select({ userId: projectMemberTable.userId })
    .from(projectMemberTable)
    .where(
      and(
        eq(projectMemberTable.projectId, projectId),
        exclude.length > 0
          ? notInArray(projectMemberTable.userId, exclude)
          : undefined,
      ),
    );
  const allowed = await Promise.all(
    rows.map(async (row) =>
      (await seesEveryTask(workspaceId, row.userId)) ? row.userId : null,
    ),
  );
  return allowed.filter((id): id is string => Boolean(id));
}

// A task made by hand: the team hears about it. The assignee already gets
// "New task for you" (notification/index.ts). Imports are left out, so a
// CSV of 200 tasks isn't 200 emails.
subscribeToEvent<{
  taskId: string;
  userId: string;
  currentUserId?: string;
  title: string;
  projectId: string;
  type?: string;
}>("task.created", async (data) => {
  if (data.type !== "created" || !data.currentUserId) return;
  const project = await projectOf(data.projectId);
  if (!project) return;
  const team = await teamToTell(project.workspaceId, data.projectId, [
    data.currentUserId,
    ...(data.userId ? [data.userId] : []),
  ]);
  if (team.length === 0) return;
  const actorName = (await nameOf(data.currentUserId)) ?? "Someone";
  await Promise.all(
    team.map((userId) =>
      createNotification({
        userId,
        type: "project_task_created",
        eventData: {
          taskTitle: data.title,
          projectId: data.projectId,
          projectName: project.name,
          workspaceId: project.workspaceId,
          actorName,
        },
        resourceId: data.taskId,
        resourceType: "task",
      }),
    ),
  );
});

// The task is gone, so these point at its project.
subscribeToEvent<{
  taskId: string;
  projectId: string;
  userId: string;
  title: string;
  assigneeId?: string | null;
  bulk?: boolean;
}>("task.deleted", async (data) => {
  const project = await projectOf(data.projectId);
  if (!project) return;
  const actorName = (await nameOf(data.userId)) ?? "Someone";
  const eventData = {
    taskTitle: data.title,
    projectId: data.projectId,
    projectName: project.name,
    workspaceId: project.workspaceId,
    actorName,
  };
  const assignee =
    data.assigneeId && data.assigneeId !== data.userId ? data.assigneeId : null;
  if (assignee) {
    await createNotification({
      userId: assignee,
      type: "task_deleted",
      eventData,
      resourceId: data.projectId,
      resourceType: "project",
    });
  }
  // One notice per task would flood the team on a bulk delete; the
  // assignees above still hear about their own tasks.
  if (data.bulk) return;
  const team = await teamToTell(project.workspaceId, data.projectId, [
    data.userId,
    ...(assignee ? [assignee] : []),
  ]);
  await Promise.all(
    team.map((userId) =>
      createNotification({
        userId,
        type: "project_task_deleted",
        eventData,
        resourceId: data.projectId,
        resourceType: "project",
      }),
    ),
  );
});
