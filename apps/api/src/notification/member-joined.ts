import { eq } from "drizzle-orm";
import db from "../database";
import { workspaceUserTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import { getRoleStatements } from "../utils/require-workspace-permission";
import createNotification from "./controllers/create-notification";

type MemberJoined = {
  workspaceId: string;
  userId: string;
  userName: string;
  email: string;
  role: string;
};

/** People who run the workspace: their role can manage its settings. */
async function workspaceAdmins(workspaceId: string, except: string) {
  const members = await db
    .select({
      userId: workspaceUserTable.userId,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
  const manages = new Map<string, boolean>();
  for (const role of new Set(members.map((m) => m.role))) {
    const statements = await getRoleStatements(role);
    manages.set(
      role,
      Boolean(statements?.workspace?.includes("manage_settings")),
    );
  }
  return members
    .filter((m) => m.userId !== except && manages.get(m.role))
    .map((m) => m.userId);
}

// Someone accepted an invitation: admins get to set them up (role,
// department, working hours) before their first day.
subscribeToEvent<MemberJoined>("member.joined", async (data) => {
  const admins = await workspaceAdmins(data.workspaceId, data.userId);
  await Promise.all(
    admins.map((userId) =>
      createNotification({
        userId,
        type: "member_joined",
        eventData: { ...data },
        resourceId: data.workspaceId,
        resourceType: "workspace",
      }),
    ),
  );
});
