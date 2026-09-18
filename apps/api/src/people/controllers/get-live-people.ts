import { and, desc, eq, isNull } from "drizzle-orm";
import { clockedInUserIds, ONLINE_WINDOW_MS } from "../../company/presence";
import db from "../../database";
import {
  agentDeviceTable,
  projectTable,
  taskTable,
  timeEntryTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";

type LiveState = "active" | "idle" | "paused" | "offline";

/**
 * Everyone's state right now. `seeApps` says whose app and site this viewer
 * may see (their own always; everyone's with activity:read_all), and
 * `taskViewer` limits running-task titles to tasks the viewer can see.
 */
export default async function getLivePeople(
  workspaceId: string,
  viewerId: string,
  seeEveryonesApps: boolean,
  taskViewer: string | null,
  now = new Date(),
) {
  const [members, devices, clockedIn, timers] = await Promise.all([
    db
      .select({
        userId: workspaceUserTable.userId,
        name: userTable.name,
        image: userTable.image,
      })
      .from(workspaceUserTable)
      .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
      .where(eq(workspaceUserTable.workspaceId, workspaceId))
      .orderBy(userTable.name),
    db
      .select()
      .from(agentDeviceTable)
      .where(
        and(
          eq(agentDeviceTable.workspaceId, workspaceId),
          isNull(agentDeviceTable.revokedAt),
        ),
      )
      .orderBy(desc(agentDeviceTable.lastSeenAt)),
    clockedInUserIds(workspaceId),
    db
      .select({
        userId: timeEntryTable.userId,
        startTime: timeEntryTable.startTime,
        taskId: taskTable.id,
        title: taskTable.title,
        assigneeId: taskTable.userId,
        number: taskTable.number,
        projectId: projectTable.id,
        slug: projectTable.slug,
      })
      .from(timeEntryTable)
      .innerJoin(taskTable, eq(taskTable.id, timeEntryTable.taskId))
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          isNull(timeEntryTable.endTime),
        ),
      ),
  ]);

  // A person's freshest device speaks for them.
  const deviceOf = new Map<string, (typeof devices)[number]>();
  for (const d of devices) {
    if (!deviceOf.has(d.userId)) deviceOf.set(d.userId, d);
  }
  const timerOf = new Map(
    timers.flatMap((t) => (t.userId ? [[t.userId, t] as const] : [])),
  );

  return members.map((m) => {
    const device = deviceOf.get(m.userId);
    const fresh =
      device?.lastSeenAt &&
      now.getTime() - device.lastSeenAt.getTime() < ONLINE_WINDOW_MS;
    const state: LiveState = !fresh
      ? "offline"
      : device.lastState === "idle" || device.lastState === "paused"
        ? device.lastState
        : "active";
    const showApp =
      (seeEveryonesApps || m.userId === viewerId) && state !== "offline";
    const timer = timerOf.get(m.userId);
    const canSeeTask =
      timer && (taskViewer === null || timer.assigneeId === taskViewer);

    return {
      userId: m.userId,
      name: m.name,
      image: m.image,
      state,
      lastSeenAt: device?.lastSeenAt ?? null,
      hasDesktopApp: Boolean(device),
      app: showApp ? (device?.currentApp ?? null) : null,
      domain: showApp ? (device?.currentDomain ?? null) : null,
      since: showApp ? (device?.currentSince ?? null) : null,
      clockedIn: clockedIn.has(m.userId),
      timing: Boolean(timer),
      runningTask:
        timer && canSeeTask
          ? {
              id: timer.taskId,
              title: timer.title,
              projectId: timer.projectId,
              ref: `${timer.slug}-${timer.number}`,
              startedAt: timer.startTime,
            }
          : null,
    };
  });
}
