import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { approvedLeave } from "../attendance/summary";
import { effectiveSchedule, type Schedule } from "../company/schedule";
import { getCompanySettings } from "../company/settings";
import { zonedDay, zonedDayRange, zonedInstant } from "../company/zoned-time";
import db from "../database";
import {
  activityTable,
  attendanceSessionTable,
  columnTable,
  employeeProfileTable,
  projectTable,
  taskReminderSentTable,
  taskTable,
  timeEntryTable,
  userNudgeSentTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import createNotification from "../notification/controllers/create-notification";
import { getRoleStatements } from "../utils/require-workspace-permission";
import {
  dueDayOf,
  isWorkday,
  startsWorkWeek,
  withinWorkHours,
  workdaysBetween,
} from "./reminder-ladder";

/**
 * Small, well-timed nudges that keep work moving, each inside the person's
 * own working hours and skipped on days off and approved leave:
 *
 *   morning digest   start of the workday: what's due today, what's late,
 *                    what's new. Nothing to say, nothing sent.
 *   not started      a task still in the first column two workdays after it
 *                    was assigned, with nothing done on it by the assignee
 *   stuck            a task in progress with no change, comment or time
 *                    logged for three workdays
 *   end of day       30 minutes before the workday ends: clocked in, but no
 *                    time logged on any task today
 *   team summary     first workday of the week, for people who see everyone:
 *                    last week's finished work, what's late, who's busy
 *
 * Every nudge goes out once (per day, per week, or per task and occasion)
 * and only in the few hours after its time, so a restart never floods anyone.
 */

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 3 * HOUR_MS;
const NOT_STARTED_WORKDAYS = 2;
const STUCK_WORKDAYS = 3;
const LIST_LIMIT = 5;

type Member = {
  userId: string;
  name: string;
  role: string;
  schedule: Schedule;
  onLeave: boolean;
};

/** True when `now` is in the few hours after `day` at `time`. */
function inWindow(
  now: Date,
  day: string,
  time: string,
  timeZone: string,
  offsetMs = 0,
) {
  const at = zonedInstant(day, time, timeZone).getTime() + offsetMs;
  const age = now.getTime() - at;
  return age >= 0 && age <= WINDOW_MS;
}

async function claimForPerson(
  userId: string,
  workspaceId: string,
  key: string,
) {
  const [row] = await db
    .insert(userNudgeSentTable)
    .values({ userId, workspaceId, key })
    .onConflictDoNothing()
    .returning({ id: userNudgeSentTable.id });
  return Boolean(row);
}

async function claimForTask(taskId: string, key: string) {
  const [row] = await db
    .insert(taskReminderSentTable)
    .values({ taskId, reminderType: key })
    .onConflictDoNothing({
      target: [
        taskReminderSentTable.taskId,
        taskReminderSentTable.reminderType,
      ],
    })
    .returning({ id: taskReminderSentTable.id });
  return Boolean(row);
}

async function membersOf(
  workspaceId: string,
  today: string,
  company: Awaited<ReturnType<typeof getCompanySettings>>,
) {
  const [rows, profiles, leave] = await Promise.all([
    db
      .select({
        userId: workspaceUserTable.userId,
        role: workspaceUserTable.role,
        name: userTable.name,
      })
      .from(workspaceUserTable)
      .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
      .where(eq(workspaceUserTable.workspaceId, workspaceId)),
    db
      .select()
      .from(employeeProfileTable)
      .where(eq(employeeProfileTable.workspaceId, workspaceId)),
    approvedLeave(workspaceId, today, today),
  ]);
  const away = new Set(leave.map((l) => l.userId));
  const byUser = new Map(profiles.map((p) => [p.userId, p]));
  const members: Member[] = rows
    .filter((row) => {
      return byUser.get(row.userId)?.status !== "inactive";
    })
    .map((row) => ({
      ...row,
      schedule: effectiveSchedule(company, byUser.get(row.userId)),
      onLeave: away.has(row.userId),
    }));
  return members;
}

async function seesEveryone(workspaceId: string, members: Member[]) {
  const canSee = new Map<string, boolean>();
  for (const role of new Set(members.map((m) => m.role))) {
    const statements = await getRoleStatements(workspaceId, role);
    canSee.set(role, Boolean(statements?.people?.includes("read_all")));
  }
  return members.filter((m) => canSee.get(m.role));
}

/** Open, assigned tasks in the workspace, with what's needed to judge them. */
async function openTasks(workspaceId: string) {
  const tasks = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      userId: taskTable.userId,
      dueDate: taskTable.dueDate,
      columnId: taskTable.columnId,
      updatedAt: taskTable.updatedAt,
      createdAt: taskTable.createdAt,
      projectId: taskTable.projectId,
      projectSlug: projectTable.slug,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(columnTable, eq(columnTable.id, taskTable.columnId))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
        isNotNull(taskTable.userId),
        ne(taskTable.status, "archived"),
        or(isNull(columnTable.isFinal), eq(columnTable.isFinal, false)),
      ),
    );
  if (tasks.length === 0) {
    return {
      tasks,
      firstColumn: new Set<string>(),
      touched: new Map<string, Date>(),
      assigned: new Map<string, Date>(),
      byAssignee: new Map<string, Date>(),
    };
  }
  // Everything below is scoped by workspace in SQL, never by a list of
  // task ids, so a big workspace can't hit Postgres' parameter limit.
  const inWorkspace = and(
    eq(projectTable.workspaceId, workspaceId),
    isNull(projectTable.archivedAt),
  );
  const [columns, activity, assignments, assigneeActivity, entries] =
    await Promise.all([
      db
        .select({
          id: columnTable.id,
          projectId: columnTable.projectId,
          position: columnTable.position,
        })
        .from(columnTable)
        .innerJoin(projectTable, eq(projectTable.id, columnTable.projectId))
        .where(inWorkspace),
      db
        .select({
          taskId: activityTable.taskId,
          at: max(activityTable.createdAt),
        })
        .from(activityTable)
        .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
        .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
        .where(inWorkspace)
        .groupBy(activityTable.taskId),
      db
        .select({
          taskId: activityTable.taskId,
          at: max(activityTable.createdAt),
        })
        .from(activityTable)
        .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
        .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
        .where(
          and(
            inWorkspace,
            inArray(activityTable.type, ["created", "assignee_changed"]),
          ),
        )
        .groupBy(activityTable.taskId),
      // What the assignee themselves did on each task.
      db
        .select({
          taskId: activityTable.taskId,
          at: max(activityTable.createdAt),
        })
        .from(activityTable)
        .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
        .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
        .where(and(inWorkspace, eq(activityTable.userId, taskTable.userId)))
        .groupBy(activityTable.taskId),
      db
        .select({
          taskId: timeEntryTable.taskId,
          userId: timeEntryTable.userId,
          at: max(timeEntryTable.startTime),
        })
        .from(timeEntryTable)
        .innerJoin(taskTable, eq(taskTable.id, timeEntryTable.taskId))
        .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
        .where(inWorkspace)
        .groupBy(timeEntryTable.taskId, timeEntryTable.userId),
    ]);

  const byTaskId = new Map(tasks.map((t) => [t.id, t]));
  // The first column of each project is where not-started work waits.
  const first = new Map<string, { id: string; position: number }>();
  for (const column of columns) {
    const current = first.get(column.projectId);
    if (!current || column.position < current.position) {
      first.set(column.projectId, column);
    }
  }
  const firstColumn = new Set([...first.values()].map((c) => c.id));

  const latest = (a?: Date | null, b?: Date | null) =>
    !a ? (b ?? undefined) : !b ? a : a > b ? a : b;
  const touched = new Map<string, Date>();
  for (const task of tasks) touched.set(task.id, task.updatedAt);
  for (const row of activity) {
    const at = latest(touched.get(row.taskId), row.at);
    if (at) touched.set(row.taskId, at);
  }
  for (const row of entries) {
    if (!row.taskId || !byTaskId.has(row.taskId)) continue;
    const at = latest(touched.get(row.taskId), row.at);
    if (at) touched.set(row.taskId, at);
  }
  const assigned = new Map<string, Date>();
  for (const row of assignments) if (row.at) assigned.set(row.taskId, row.at);
  // Anything the assignee did on the task, or time they logged on it.
  const byAssignee = new Map<string, Date>();
  for (const row of assigneeActivity) {
    if (row.at) byAssignee.set(row.taskId, row.at);
  }
  for (const row of entries) {
    const task = row.taskId ? byTaskId.get(row.taskId) : undefined;
    if (task && row.at && row.userId === task.userId) {
      byAssignee.set(task.id, latest(byAssignee.get(task.id), row.at) as Date);
    }
  }
  return { tasks, firstColumn, touched, assigned, byAssignee };
}

type TaskRow = Awaited<ReturnType<typeof openTasks>>["tasks"][number];

const brief = (task: TaskRow) => ({
  title: task.title,
  ref: task.number !== null ? `${task.projectSlug}-${task.number}` : null,
});

async function runWorkspace(workspaceId: string, now: Date) {
  const company = await getCompanySettings(workspaceId);
  const today = zonedDay(now, company.timezone);
  const members = await membersOf(workspaceId, today, company);
  const tz = company.timezone;
  const due = (_m: Member, time: string, offsetMs = 0) =>
    inWindow(now, today, time, tz, offsetMs);
  const active = members.filter(
    (m) => !m.onLeave && isWorkday(m.schedule, today),
  );
  // Nothing to send for anyone right now: skip the heavy queries.
  if (
    !active.some(
      (m) =>
        due(m, m.schedule.workStart) ||
        due(m, m.schedule.workEnd, -30 * 60 * 1000) ||
        (startsWorkWeek(m.schedule, today) &&
          due(m, m.schedule.workStart, 30 * 60 * 1000)),
    )
  ) {
    return;
  }
  const data = await openTasks(workspaceId);
  const byId = new Map(members.map((m) => [m.userId, m]));

  // Per-task nudges: not started, and stuck in progress.
  for (const task of data.tasks) {
    const member = task.userId ? byId.get(task.userId) : undefined;
    if (!member || member.onLeave || !isWorkday(member.schedule, today))
      continue;
    if (!inWindow(now, today, member.schedule.workStart, tz, HOUR_MS)) continue;
    const base = {
      workspaceId,
      projectId: task.projectId,
      taskTitle: task.title,
      taskRef: brief(task).ref,
    };

    if (task.columnId && data.firstColumn.has(task.columnId)) {
      const assignedAt = data.assigned.get(task.id) ?? task.createdAt;
      const acted = data.byAssignee.get(task.id);
      const days = workdaysBetween(
        zonedDay(assignedAt, tz),
        today,
        member.schedule.workDays,
      );
      if (
        days >= NOT_STARTED_WORKDAYS &&
        (!acted || acted <= assignedAt) &&
        (await claimForTask(task.id, `not-started:${assignedAt.toISOString()}`))
      ) {
        await createNotification({
          userId: member.userId,
          type: "task_not_started",
          eventData: { ...base, workdays: days },
          resourceId: task.id,
          resourceType: "task",
        });
      }
      continue;
    }

    const touched = data.touched.get(task.id) ?? task.updatedAt;
    const touchedDay = zonedDay(touched, tz);
    const idle = workdaysBetween(touchedDay, today, member.schedule.workDays);
    if (
      idle >= STUCK_WORKDAYS &&
      (await claimForTask(task.id, `stuck:${touchedDay}`))
    ) {
      await createNotification({
        userId: member.userId,
        type: "task_stuck",
        eventData: { ...base, workdays: idle, since: touchedDay },
        resourceId: task.id,
        resourceType: "task",
      });
    }
  }

  // Per-person: the morning digest and the end-of-day nudge.
  const { start: dayStart, end: dayEnd } = zonedDayRange(today, tz);
  const [sessions, loggedToday] = await Promise.all([
    db
      .select({
        userId: attendanceSessionTable.userId,
        note: attendanceSessionTable.note,
      })
      .from(attendanceSessionTable)
      .where(
        and(
          eq(attendanceSessionTable.workspaceId, workspaceId),
          gte(attendanceSessionTable.clockIn, dayStart),
          lt(attendanceSessionTable.clockIn, dayEnd),
        ),
      ),
    db
      .selectDistinct({ userId: timeEntryTable.userId })
      .from(timeEntryTable)
      .innerJoin(taskTable, eq(taskTable.id, timeEntryTable.taskId))
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          gte(timeEntryTable.startTime, dayStart),
          lt(timeEntryTable.startTime, dayEnd),
        ),
      ),
  ]);
  const logged = new Set(loggedToday.map((row) => row.userId));

  for (const member of members) {
    if (member.onLeave || !isWorkday(member.schedule, today)) continue;

    if (inWindow(now, today, member.schedule.workStart, tz)) {
      const mine = data.tasks.filter((t) => t.userId === member.userId);
      const dueToday = mine.filter(
        (t) => t.dueDate && dueDayOf(t.dueDate, tz) === today,
      );
      const overdue = mine.filter(
        (t) => t.dueDate && dueDayOf(t.dueDate, tz) < today,
      );
      const since = new Date(now.getTime() - 24 * HOUR_MS);
      const fresh = mine.filter((t) => {
        const at = data.assigned.get(t.id);
        return at && at > since;
      });
      const hasNews = dueToday.length + overdue.length + fresh.length > 0;
      if (
        hasNews &&
        (await claimForPerson(member.userId, workspaceId, `digest:${today}`))
      ) {
        await createNotification({
          userId: member.userId,
          type: "daily_digest",
          eventData: {
            workspaceId,
            day: today,
            dueTodayCount: dueToday.length,
            overdueCount: overdue.length,
            newCount: fresh.length,
            openCount: mine.length,
            dueToday: dueToday.slice(0, LIST_LIMIT).map(brief),
            overdue: overdue.slice(0, LIST_LIMIT).map((t) => ({
              ...brief(t),
              daysLate: workdaysBetween(
                dueDayOf(t.dueDate as Date, tz),
                today,
                member.schedule.workDays,
              ),
            })),
            fresh: fresh.slice(0, LIST_LIMIT).map(brief),
          },
          resourceId: workspaceId,
          resourceType: "workspace",
        });
      }
    }

    const mySessions = sessions.filter((s) => s.userId === member.userId);
    if (
      mySessions.length > 0 &&
      !logged.has(member.userId) &&
      !mySessions.some((s) => s.note?.trim()) &&
      inWindow(now, today, member.schedule.workEnd, tz, -30 * 60 * 1000) &&
      withinWorkHours(now, member.schedule, tz) &&
      (await claimForPerson(member.userId, workspaceId, `end-of-day:${today}`))
    ) {
      await createNotification({
        userId: member.userId,
        type: "end_of_day",
        eventData: { workspaceId, day: today },
        resourceId: workspaceId,
        resourceType: "workspace",
      });
    }
  }

  // Weekly: the first workday after a day off (Sunday in a Sunday–Thursday
  // week, Monday in a Monday–Friday one), for people who see everyone.
  const managers = (await seesEveryone(workspaceId, members)).filter(
    (m) =>
      !m.onLeave &&
      startsWorkWeek(m.schedule, today) &&
      inWindow(now, today, m.schedule.workStart, tz, 30 * 60 * 1000),
  );
  if (managers.length === 0) return;

  const weekAgo = new Date(now.getTime() - 7 * 24 * HOUR_MS);
  const done = await db
    .select({ userId: taskTable.userId, count: sql<number>`count(*)::int` })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
        isNotNull(taskTable.userId),
        gte(taskTable.completedAt, weekAgo),
      ),
    )
    .groupBy(taskTable.userId);
  const doneBy = new Map(done.map((row) => [row.userId, row.count]));
  const people = members
    .map((m) => {
      const mine = data.tasks.filter((t) => t.userId === m.userId);
      return {
        name: m.name,
        done: doneBy.get(m.userId) ?? 0,
        open: mine.length,
        overdue: mine.filter(
          (t) => t.dueDate && dueDayOf(t.dueDate, tz) < today,
        ).length,
      };
    })
    .filter((p) => p.done + p.open > 0)
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  const summary = {
    workspaceId,
    week: today,
    doneCount: done.reduce((sum, row) => sum + row.count, 0),
    openCount: data.tasks.length,
    overdueCount: people.reduce((sum, p) => sum + p.overdue, 0),
    people: people.slice(0, 8),
  };
  for (const manager of managers) {
    if (await claimForPerson(manager.userId, workspaceId, `summary:${today}`)) {
      await createNotification({
        userId: manager.userId,
        type: "team_summary",
        eventData: summary,
        resourceId: workspaceId,
        resourceType: "workspace",
      });
    }
  }
}

export async function runEngagement(
  now = new Date(),
): Promise<{ degraded: boolean }> {
  let degraded = false;
  const workspaces = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable);
  for (const workspace of workspaces) {
    try {
      await runWorkspace(workspace.id, now);
    } catch (error) {
      degraded = true;
      console.error("Engagement nudges failed for a workspace", {
        workspaceId: workspace.id,
        error,
      });
    }
  }
  return { degraded };
}
