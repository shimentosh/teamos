import { and, asc, eq, isNull } from "drizzle-orm";
import db from "../database";
import { columnTable, taskTable, timeEntryTable } from "../database/schema";
import updateTaskStatus from "../task/controllers/update-task-status";
import createTimeEntry from "./controllers/create-time-entry";
import { resolveDuration } from "./duration";

/*
 * Task status and the timer move together, so time is tracked without
 * anyone having to remember the Start button:
 *
 * - Moving a task into In Progress starts the mover's timer on it (their
 *   own task, or an unassigned one; never someone else's). Starting a timer
 *   closes whatever the person was tracking before.
 * - Moving a task out of In Progress (review, done, back to to-do) stops
 *   every timer running on it.
 * - Starting a timer on a task that hasn't been started yet moves it to
 *   In Progress.
 *
 * "In Progress" is the column with the `in-progress` slug, which every
 * project gets by default.
 */

export const IN_PROGRESS = "in-progress";

export type TimerChange = "started" | "stopped" | null;

/** Stops every timer running on a task, whoever started it. */
async function stopTimersOnTask(taskId: string, at = new Date()) {
  const running = await db
    .select({ id: timeEntryTable.id, startTime: timeEntryTable.startTime })
    .from(timeEntryTable)
    .where(
      and(eq(timeEntryTable.taskId, taskId), isNull(timeEntryTable.endTime)),
    );
  for (const entry of running) {
    const endTime = at > entry.startTime ? at : entry.startTime;
    await db
      .update(timeEntryTable)
      .set({ endTime, duration: resolveDuration(entry.startTime, endTime) })
      .where(eq(timeEntryTable.id, entry.id));
  }
  return running.length;
}

/**
 * Keeps the timer in step with a status change. `start` is false for all
 * but one task of a bulk move, since a person runs one timer at a time.
 */
export async function syncTimerWithStatus({
  taskId,
  actorId,
  oldStatus,
  newStatus,
  start = true,
}: {
  taskId: string;
  actorId: string;
  oldStatus: string | null | undefined;
  newStatus: string;
  start?: boolean;
}): Promise<TimerChange> {
  if (oldStatus === newStatus) return null;

  if (newStatus === IN_PROGRESS) {
    if (!start) return null;
    const [task] = await db
      .select({ assigneeId: taskTable.userId })
      .from(taskTable)
      .where(eq(taskTable.id, taskId));
    // Someone else's task: moving it along isn't them starting work.
    if (!task || (task.assigneeId && task.assigneeId !== actorId)) return null;

    const [running] = await db
      .select({ taskId: timeEntryTable.taskId })
      .from(timeEntryTable)
      .where(
        and(eq(timeEntryTable.userId, actorId), isNull(timeEntryTable.endTime)),
      );
    if (running?.taskId === taskId) return null;
    await createTimeEntry({ taskId, userId: actorId, startTime: new Date() });
    return "started";
  }

  if (oldStatus === IN_PROGRESS) {
    return (await stopTimersOnTask(taskId)) > 0 ? "stopped" : null;
  }
  return null;
}

/**
 * Starting a timer means work has begun: a task still waiting (planned, or
 * a column before In Progress) moves to In Progress. Tasks already in
 * review or done stay where they are.
 */
export async function moveToInProgressOnStart(taskId: string, actorId: string) {
  const [task] = await db
    .select({ status: taskTable.status, projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId));
  if (!task || task.status === IN_PROGRESS) return false;

  const columns = await db
    .select({
      slug: columnTable.slug,
      position: columnTable.position,
      isFinal: columnTable.isFinal,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, task.projectId))
    .orderBy(asc(columnTable.position));
  const target = columns.find((c) => c.slug === IN_PROGRESS);
  if (!target) return false;
  const current = columns.find((c) => c.slug === task.status);
  if (current && (current.isFinal || current.position > target.position)) {
    return false;
  }

  await updateTaskStatus({
    id: taskId,
    status: IN_PROGRESS,
    currentUserId: actorId,
  });
  return true;
}
