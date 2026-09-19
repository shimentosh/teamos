import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import db from "../database";
import {
  agentDeviceTable,
  attendanceSessionTable,
  workspaceUserTable,
} from "../database/schema";
import { webPresentUserIds } from "../utils/web-presence";

// The agent heartbeats every minute; two missed beats means offline.
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

/** People with an open attendance session in the workspace. */
export async function clockedInUserIds(workspaceId: string) {
  const rows = await db
    .select({ userId: attendanceSessionTable.userId })
    .from(attendanceSessionTable)
    .where(
      and(
        eq(attendanceSessionTable.workspaceId, workspaceId),
        isNull(attendanceSessionTable.clockOut),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

/**
 * People online now: using TeamOS in the last couple of minutes, or a desktop
 * app that reported in. Presence, not work.
 */
export async function onlineUserIds(workspaceId: string, now = new Date()) {
  // Using TeamOS is user-scoped, so it only speaks for the workspaces the
  // person is a member of.
  const active = [...webPresentUserIds(now.getTime() - ONLINE_WINDOW_MS)];
  const [devices, members] = await Promise.all([
    db
      .selectDistinct({ userId: agentDeviceTable.userId })
      .from(agentDeviceTable)
      .where(
        and(
          eq(agentDeviceTable.workspaceId, workspaceId),
          isNull(agentDeviceTable.revokedAt),
          gt(
            agentDeviceTable.lastSeenAt,
            new Date(now.getTime() - ONLINE_WINDOW_MS),
          ),
        ),
      ),
    active.length === 0
      ? Promise.resolve([] as { userId: string }[])
      : db
          .select({ userId: workspaceUserTable.userId })
          .from(workspaceUserTable)
          .where(
            and(
              eq(workspaceUserTable.workspaceId, workspaceId),
              inArray(workspaceUserTable.userId, active),
            ),
          ),
  ]);
  return new Set([
    ...members.map((r) => r.userId),
    ...devices.map((r) => r.userId),
  ]);
}
