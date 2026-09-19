import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
} from "drizzle-orm";
import { approvedLeave } from "../attendance/summary";
import { effectiveSchedule } from "../company/schedule";
import { getCompanySettings } from "../company/settings";
import { zonedDay } from "../company/zoned-time";
import db from "../database";
import {
  columnTable,
  employeeProfileTable,
  projectTable,
  taskReminderSentTable,
  taskTable,
  userNotificationPreferenceTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import createNotification from "../notification/controllers/create-notification";
import { getRoleStatements } from "../utils/require-workspace-permission";
import {
  dueDayOf,
  dueStages,
  reminderStages,
  withinWorkHours,
} from "./reminder-ladder";

const HOUR_MS = 60 * 60 * 1000;
// Far enough back for weekly nudges on long-forgotten tasks, bounded so the
// query stays small.
const LOOK_BACK_DAYS = 120;
// Lead times go up to 30 days.
const LOOK_AHEAD_DAYS = 32;

async function openTasksWithDueDates(now: Date) {
  const from = new Date(now.getTime() - LOOK_BACK_DAYS * 24 * HOUR_MS);
  const to = new Date(now.getTime() + LOOK_AHEAD_DAYS * 24 * HOUR_MS);
  return (
    db
      .select({
        id: taskTable.id,
        title: taskTable.title,
        number: taskTable.number,
        userId: taskTable.userId,
        dueDate: taskTable.dueDate,
        projectId: taskTable.projectId,
        projectSlug: projectTable.slug,
        workspaceId: projectTable.workspaceId,
        assigneeName: userTable.name,
        leadTimeMinutes:
          userNotificationPreferenceTable.dueDateReminderLeadTimeMinutes,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      // Only people still in the workspace: someone removed keeps no reminders
      // (their tasks keep the assignee until someone reassigns them).
      .innerJoin(
        workspaceUserTable,
        and(
          eq(workspaceUserTable.workspaceId, projectTable.workspaceId),
          eq(workspaceUserTable.userId, taskTable.userId),
        ),
      )
      .leftJoin(userTable, eq(userTable.id, taskTable.userId))
      .leftJoin(columnTable, eq(taskTable.columnId, columnTable.id))
      .leftJoin(
        userNotificationPreferenceTable,
        eq(userNotificationPreferenceTable.userId, taskTable.userId),
      )
      .where(
        and(
          isNotNull(taskTable.userId),
          isNotNull(taskTable.dueDate),
          gte(taskTable.dueDate, from),
          lte(taskTable.dueDate, to),
          isNull(projectTable.archivedAt),
          // Done (final column) and archived tasks never nag anyone.
          or(isNull(columnTable.isFinal), eq(columnTable.isFinal, false)),
          ne(taskTable.status, "archived"),
        ),
      )
  );
}

/** People who look after others: their role reads all people and tasks. */
async function managersOf(workspaceId: string) {
  const members = await db
    .select({
      userId: workspaceUserTable.userId,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
  const canSee = new Map<string, boolean>();
  for (const role of new Set(members.map((m) => m.role))) {
    const statements = await getRoleStatements(role);
    // The email names the task, so they must be able to see every task too:
    // a custom HR role can read all people without reading all tasks.
    canSee.set(
      role,
      Boolean(
        statements?.people?.includes("read_all") &&
          statements?.task?.includes("read_all"),
      ),
    );
  }
  return members.filter((m) => canSee.get(m.role)).map((m) => m.userId);
}

/** True when this step for this task hasn't been sent yet (and claims it). */
async function claim(taskId: string, key: string) {
  const [inserted] = await db
    .insert(taskReminderSentTable)
    .values({ taskId, reminderType: key })
    .onConflictDoNothing({
      target: [
        taskReminderSentTable.taskId,
        taskReminderSentTable.reminderType,
      ],
    })
    .returning({ id: taskReminderSentTable.id });
  return Boolean(inserted);
}

export async function checkDueDateReminders(
  now = new Date(),
): Promise<{ degraded: boolean }> {
  let degraded = false;
  let tasks: Awaited<ReturnType<typeof openTasksWithDueDates>>;
  try {
    tasks = await openTasksWithDueDates(now);
  } catch (error) {
    console.error("Failed to query tasks for due date reminders", error);
    return { degraded: true };
  }
  if (tasks.length === 0) return { degraded };

  const workspaceIds = [...new Set(tasks.map((t) => t.workspaceId))];
  const companies = new Map(
    await Promise.all(
      workspaceIds.map(
        async (id) => [id, await getCompanySettings(id)] as const,
      ),
    ),
  );
  const profileRows = await db
    .select()
    .from(employeeProfileTable)
    .where(inArray(employeeProfileTable.workspaceId, workspaceIds));
  const profiles = new Map(
    profileRows.map((p) => [`${p.workspaceId}:${p.userId}`, p]),
  );
  // Who's on approved leave today, per workspace.
  const away = new Map(
    await Promise.all(
      workspaceIds.map(async (id) => {
        const company = companies.get(id);
        const today = zonedDay(now, company?.timezone ?? "UTC");
        const leave = await approvedLeave(id, today, today);
        return [id, new Set(leave.map((l) => l.userId))] as const;
      }),
    ),
  );
  const managers = new Map<string, Promise<string[]>>();

  for (const task of tasks) {
    if (!task.userId || !task.dueDate) continue;
    const company = companies.get(task.workspaceId);
    if (!company) continue;
    const profile = profiles.get(`${task.workspaceId}:${task.userId}`);
    if (profile?.status === "inactive") continue;
    const schedule = effectiveSchedule(company, profile);
    // Reminders go out during the assignee's working hours only; a step
    // missed overnight is caught up the next morning within the window.
    if (!withinWorkHours(now, schedule, company.timezone)) continue;
    const onLeave = away.get(task.workspaceId)?.has(task.userId) ?? false;
    const dueDay = dueDayOf(task.dueDate, company.timezone);
    const stages = dueStages(
      reminderStages({
        dueDay,
        today: zonedDay(now, company.timezone),
        schedule,
        timeZone: company.timezone,
        leadTimeMinutes: task.leadTimeMinutes ?? 1440,
      }),
      now,
    );

    for (const stage of stages) {
      try {
        if (!(await claim(task.id, stage.key))) continue;
        const eventData = {
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          taskTitle: task.title,
          taskRef:
            task.number !== null ? `${task.projectSlug}-${task.number}` : null,
          dueDate: dueDay,
          daysOverdue: stage.daysOverdue,
          leadTimeMinutes: task.leadTimeMinutes ?? 1440,
          stage: stage.key.split(":")[0],
          assigneeName: task.assigneeName,
        };
        // On leave: no reminders for them, but managers still hear when
        // their work is late, so someone can pick it up.
        if (!onLeave) {
          await createNotification({
            userId: task.userId,
            type: stage.type,
            eventData,
            resourceId: task.id,
            resourceType: "task",
          });
        }
        if (stage.escalate) {
          if (!managers.has(task.workspaceId)) {
            managers.set(task.workspaceId, managersOf(task.workspaceId));
          }
          const people = (await managers.get(task.workspaceId)) ?? [];
          await Promise.all(
            people
              .filter((id) => id !== task.userId)
              .map((userId) =>
                createNotification({
                  userId,
                  type: "task_overdue_escalated",
                  eventData,
                  resourceId: task.id,
                  resourceType: "task",
                }),
              ),
          );
        }
      } catch (error) {
        degraded = true;
        console.error("Failed to send a due date reminder", {
          taskId: task.id,
          stage: stage.key,
          error,
        });
      }
    }
  }

  return { degraded };
}
