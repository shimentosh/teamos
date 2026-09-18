import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import db from "../../database";
import {
  projectMemberTable,
  projectTable,
  taskTable,
  timeEntryTable,
} from "../../database/schema";
import { visibleProjects, visibleTasks } from "../../utils/task-visibility";

type ProjectStatistics = {
  completionPercentage: number;
  totalTasks: number;
  dueDate: Date | null;
  nextDueDate: Date | null;
  openTasks: number;
  completedTasks: number;
  overdueTasks: number;
  dueThisWeekTasks: number;
  estimateMinutes: number;
  trackedSecondsLast30Days: number;
  assigneeIds: string[];
  lastActivityAt: Date | null;
};

const EMPTY_STATISTICS: ProjectStatistics = {
  completionPercentage: 0,
  totalTasks: 0,
  dueDate: null,
  nextDueDate: null,
  openTasks: 0,
  completedTasks: 0,
  overdueTasks: 0,
  dueThisWeekTasks: 0,
  estimateMinutes: 0,
  trackedSecondsLast30Days: 0,
  assigneeIds: [],
  lastActivityAt: null,
};

const TRACKED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function getProjectStatistics(
  workspaceId: string,
  includeArchived: boolean,
  viewer: string | null,
) {
  const statisticsByProject = new Map<string, ProjectStatistics>();
  // Someone who only sees their own tasks gets rollups of those tasks only.
  const inWorkspace = and(
    eq(projectTable.workspaceId, workspaceId),
    includeArchived ? undefined : isNull(projectTable.archivedAt),
    visibleTasks(viewer),
  );

  // Aggregate in the database instead of loading every task row into memory:
  // one grouped row per project, however many tasks it has. Scoping by
  // workspaceId through a join (rather than an `IN (...projectIds)` list)
  // keeps the statement size constant regardless of how many projects the
  // workspace has.
  const done = sql`${taskTable.status} in ('done', 'archived')`;
  const open = sql`${taskTable.status} not in ('done', 'archived')`;
  const [rows, tracked] = await Promise.all([
    db
      .select({
        projectId: taskTable.projectId,
        totalTasks: sql<number>`count(*)::int`,
        completedTasks: sql<number>`count(*) filter (where ${done})::int`,
        overdueTasks: sql<number>`count(*) filter (where ${open} and ${taskTable.dueDate} < now())::int`,
        dueThisWeekTasks: sql<number>`count(*) filter (where ${open} and ${taskTable.dueDate} >= now() and ${taskTable.dueDate} < now() + interval '7 days')::int`,
        dueDate: sql<Date | null>`min(${taskTable.dueDate})`.mapWith(
          taskTable.dueDate,
        ),
        nextDueDate:
          sql<Date | null>`min(${taskTable.dueDate}) filter (where ${open})`.mapWith(
            taskTable.dueDate,
          ),
        estimateMinutes: sql<number>`coalesce(sum(${taskTable.estimateMinutes}), 0)::int`,
        assigneeIds: sql<
          string[] | null
        >`array_agg(distinct ${taskTable.userId}) filter (where ${open} and ${taskTable.userId} is not null)`,
        lastActivityAt: sql<Date | null>`max(${taskTable.updatedAt})`.mapWith(
          taskTable.updatedAt,
        ),
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(inWorkspace)
      .groupBy(taskTable.projectId),
    // Finished entries only; a running timer shows up once it stops.
    db
      .select({
        projectId: taskTable.projectId,
        seconds: sql<number>`coalesce(sum(${timeEntryTable.duration}), 0)::int`,
      })
      .from(timeEntryTable)
      .innerJoin(taskTable, eq(timeEntryTable.taskId, taskTable.id))
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          inWorkspace,
          isNotNull(timeEntryTable.endTime),
          gte(
            timeEntryTable.startTime,
            new Date(Date.now() - TRACKED_WINDOW_MS),
          ),
        ),
      )
      .groupBy(taskTable.projectId),
  ]);

  const trackedByProject = new Map(
    tracked.map((row) => [row.projectId, Number(row.seconds)]),
  );

  for (const row of rows) {
    const totalTasks = Number(row.totalTasks);
    const completedTasks = Number(row.completedTasks);
    statisticsByProject.set(row.projectId, {
      totalTasks,
      completedTasks,
      openTasks: totalTasks - completedTasks,
      completionPercentage:
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      dueDate: row.dueDate ?? null,
      nextDueDate: row.nextDueDate ?? null,
      overdueTasks: Number(row.overdueTasks),
      dueThisWeekTasks: Number(row.dueThisWeekTasks),
      estimateMinutes: Number(row.estimateMinutes),
      trackedSecondsLast30Days: trackedByProject.get(row.projectId) ?? 0,
      assigneeIds: row.assigneeIds ?? [],
      lastActivityAt: row.lastActivityAt ?? null,
    });
  }

  return statisticsByProject;
}

async function getProjects(
  workspaceId: string,
  includeArchived = false,
  viewer: string | null = null,
) {
  const projects = await db.query.projectTable.findMany({
    where: and(
      eq(projectTable.workspaceId, workspaceId),
      includeArchived ? undefined : isNull(projectTable.archivedAt),
      visibleProjects(viewer),
    ),
    // `id` is the deterministic tie-breaker: without it, rows sharing both a
    // position and a createdAt come back in an unspecified order.
    orderBy: (project, { asc }) => [
      asc(project.position),
      asc(project.createdAt),
      asc(project.id),
    ],
  });

  const [statisticsByProject, members] = await Promise.all([
    getProjectStatistics(workspaceId, includeArchived, viewer),
    db
      .select({
        projectId: projectMemberTable.projectId,
        userId: projectMemberTable.userId,
      })
      .from(projectMemberTable)
      .innerJoin(
        projectTable,
        eq(projectMemberTable.projectId, projectTable.id),
      )
      .where(eq(projectTable.workspaceId, workspaceId))
      .orderBy(projectMemberTable.createdAt),
  ]);
  const memberIds = new Map<string, string[]>();
  for (const row of members) {
    memberIds.set(row.projectId, [
      ...(memberIds.get(row.projectId) ?? []),
      row.userId,
    ]);
  }

  return projects.map((project) => ({
    ...project,
    memberIds: memberIds.get(project.id) ?? [],
    statistics: statisticsByProject.get(project.id) ?? EMPTY_STATISTICS,
    archivedTasks: [],
    plannedTasks: [],
    columns: [],
  }));
}

export default getProjects;
