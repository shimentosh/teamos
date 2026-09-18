import { and, eq } from "drizzle-orm";
import db from "../database";
import {
  leaveRequestTable,
  projectTable,
  taskTable,
  workspaceNotificationPolicyTable,
} from "../database/schema";
import type { EventPolicy, NotificationEventKey } from "./events";

/** A workspace's rule for one event, or null when it has none. */
export async function workspacePolicy(
  workspaceId: string | null | undefined,
  eventKey: NotificationEventKey,
): Promise<EventPolicy | null> {
  if (!workspaceId) return null;
  const [row] = await db
    .select({
      inApp: workspaceNotificationPolicyTable.inApp,
      email: workspaceNotificationPolicyTable.email,
      locked: workspaceNotificationPolicyTable.locked,
    })
    .from(workspaceNotificationPolicyTable)
    .where(
      and(
        eq(workspaceNotificationPolicyTable.workspaceId, workspaceId),
        eq(workspaceNotificationPolicyTable.eventKey, eventKey),
      ),
    );
  return row ?? null;
}

/** Which workspace a notification belongs to, from its data or resource. */
export async function workspaceOfNotification(input: {
  eventData?: Record<string, unknown> | null;
  resourceType?: string | null;
  resourceId?: string | null;
}) {
  const fromData = input.eventData?.workspaceId;
  if (typeof fromData === "string" && fromData) return fromData;
  if (!input.resourceId) return null;
  if (input.resourceType === "workspace") return input.resourceId;
  if (input.resourceType === "task") {
    const [row] = await db
      .select({ workspaceId: projectTable.workspaceId })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(eq(taskTable.id, input.resourceId));
    return row?.workspaceId ?? null;
  }
  if (input.resourceType === "project") {
    const [row] = await db
      .select({ workspaceId: projectTable.workspaceId })
      .from(projectTable)
      .where(eq(projectTable.id, input.resourceId));
    return row?.workspaceId ?? null;
  }
  if (input.resourceType === "leave_request") {
    const [row] = await db
      .select({ workspaceId: leaveRequestTable.workspaceId })
      .from(leaveRequestTable)
      .where(eq(leaveRequestTable.id, input.resourceId));
    return row?.workspaceId ?? null;
  }
  return null;
}
