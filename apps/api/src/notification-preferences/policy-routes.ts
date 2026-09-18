import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { recordAudit } from "../audit/record-audit";
import db from "../database";
import { workspaceNotificationPolicyTable } from "../database/schema";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  nullableResponseTimestamp,
  z,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { isNotificationEventKey, NOTIFICATION_EVENTS } from "./events";

const tags = ["Notification policy"];

const policySchema = z
  .object({
    key: z.string(),
    audience: z.enum(["everyone", "approvers", "admins"]),
    inApp: z.boolean(),
    email: z.boolean(),
    locked: z.boolean().openapi({
      description:
        "Members can't change it; the in-app and email values apply to everyone.",
    }),
    custom: z.boolean().openapi({
      description: "False when nothing was set: on, and each person decides.",
    }),
    updatedAt: nullableResponseTimestamp,
  })
  .openapi("NotificationPolicy");

async function listPolicies(workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaceNotificationPolicyTable)
    .where(eq(workspaceNotificationPolicyTable.workspaceId, workspaceId));
  const byKey = new Map(rows.map((row) => [row.eventKey, row]));
  return NOTIFICATION_EVENTS.map((event) => {
    const row = byKey.get(event.key);
    return {
      key: event.key,
      audience: event.audience,
      inApp: row?.inApp ?? true,
      email: row?.email ?? true,
      locked: row?.locked ?? false,
      custom: Boolean(row),
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

const listRoute = createRoute({
  method: "get",
  operationId: "listNotificationPolicies",
  path: "/",
  tags,
  summary: "Workspace notification rules",
  description:
    "Every notification event with the workspace's rule for it. Members read this to see what their admin decided.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: z.object({ workspaceId: z.string() }) },
  responses: {
    200: jsonResponse("Rules", z.array(policySchema)),
    403: errorResponse("No access to the workspace"),
  },
});

const setRoute = createRoute({
  method: "put",
  operationId: "setNotificationPolicy",
  path: "/{key}",
  tags,
  summary: "Set a notification rule",
  description:
    "Turn an event on or off for the workspace, in the app and by email. Locked rules apply to everyone; unlocked ones are the default each person can change. Audit logged.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  ] as const,
  request: {
    params: z.object({ key: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            workspaceId: z.string(),
            inApp: z.boolean(),
            email: z.boolean(),
            locked: z.boolean(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Rules", z.array(policySchema)),
    403: errorResponse("Missing workspace:manage_settings"),
    404: errorResponse("Unknown event"),
  },
});

const resetRoute = createRoute({
  method: "delete",
  operationId: "resetNotificationPolicy",
  path: "/{key}",
  tags,
  summary: "Reset a notification rule",
  description: "Back to on, with each person deciding. Audit logged.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  ] as const,
  request: {
    params: z.object({ key: z.string() }),
    query: z.object({ workspaceId: z.string() }),
  },
  responses: {
    200: jsonResponse("Rules", z.array(policySchema)),
    403: errorResponse("Missing workspace:manage_settings"),
  },
});

const notificationPolicy = apiRouter()
  .openapi(listRoute, async (c) =>
    c.json(await listPolicies(c.req.valid("query").workspaceId), 200),
  )
  .openapi(setRoute, async (c) => {
    const { key } = c.req.valid("param");
    if (!isNotificationEventKey(key)) {
      throw new HTTPException(404, { message: "Unknown event" });
    }
    const { workspaceId, inApp, email, locked } = c.req.valid("json");
    const updatedBy = c.get("userId");
    await db
      .insert(workspaceNotificationPolicyTable)
      .values({ workspaceId, eventKey: key, inApp, email, locked, updatedBy })
      .onConflictDoUpdate({
        target: [
          workspaceNotificationPolicyTable.workspaceId,
          workspaceNotificationPolicyTable.eventKey,
        ],
        set: { inApp, email, locked, updatedBy },
      });
    await recordAudit({
      workspaceId,
      actorId: updatedBy,
      action: "notification_policy.updated",
      targetType: "workspace",
      targetId: workspaceId,
      data: { event: key, inApp, email, locked },
    });
    return c.json(await listPolicies(workspaceId), 200);
  })
  .openapi(resetRoute, async (c) => {
    const { key } = c.req.valid("param");
    const { workspaceId } = c.req.valid("query");
    await db
      .delete(workspaceNotificationPolicyTable)
      .where(
        and(
          eq(workspaceNotificationPolicyTable.workspaceId, workspaceId),
          eq(workspaceNotificationPolicyTable.eventKey, key),
        ),
      );
    await recordAudit({
      workspaceId,
      actorId: c.get("userId"),
      action: "notification_policy.reset",
      targetType: "workspace",
      targetId: workspaceId,
      data: { event: key },
    });
    return c.json(await listPolicies(workspaceId), 200);
  });

export default notificationPolicy;
