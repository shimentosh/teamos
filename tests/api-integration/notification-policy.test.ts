import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import createNotification from "../../apps/api/src/notification/controllers/create-notification";
import { addWorkspaceMember, requestAs } from "./helpers/company";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

const digestFor = (userId: string, workspaceId: string) =>
  createNotification({
    userId,
    type: "daily_digest",
    eventData: { workspaceId },
    resourceId: workspaceId,
    resourceType: "workspace",
  });

describe("workspace notification rules", () => {
  it("lets admins set rules members follow, and only admins", async () => {
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    const mia = await addWorkspaceMember(workspace.id, "member", "Mia");

    // Everyone can read the rules; nothing set means on.
    const rules = await requestAs(mia)(
      `/notification-policy?workspaceId=${workspace.id}`,
    );
    expect(rules.status).toBe(200);
    expect(
      rules.json.find((r: { key: string }) => r.key === "daily_digest"),
    ).toMatchObject({ inApp: true, email: true, locked: false, custom: false });

    const byMember = await requestAs(mia)("/notification-policy/daily_digest", {
      method: "PUT",
      body: {
        workspaceId: workspace.id,
        inApp: false,
        email: false,
        locked: true,
      },
    });
    expect(byMember.status).toBe(403);

    // Mia turned the digest on for herself; a locked "off" still wins.
    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: mia.id,
      eventSettings: { daily_digest: { inApp: true, email: true } },
    });
    const locked = await requestAs(owner)("/notification-policy/daily_digest", {
      method: "PUT",
      body: {
        workspaceId: workspace.id,
        inApp: false,
        email: false,
        locked: true,
      },
    });
    expect(locked.status).toBe(200);
    expect(await digestFor(mia.id, workspace.id)).toBeNull();

    // Unlocked, the rule is only a default: Mia's own choice applies again.
    await requestAs(owner)("/notification-policy/daily_digest", {
      method: "PUT",
      body: {
        workspaceId: workspace.id,
        inApp: false,
        email: false,
        locked: false,
      },
    });
    expect(await digestFor(mia.id, workspace.id)).not.toBeNull();
    // Someone who never chose follows the workspace default: off.
    expect(await digestFor(owner.id, workspace.id)).toBeNull();

    const reset = await requestAs(owner)(
      `/notification-policy/daily_digest?workspaceId=${workspace.id}`,
      { method: "DELETE" },
    );
    expect(reset.status, JSON.stringify(reset.json)).toBe(200);
    expect(
      reset.json.find((r: { key: string }) => r.key === "daily_digest"),
    ).toMatchObject({ custom: false, inApp: true });
    expect(await digestFor(owner.id, workspace.id)).not.toBeNull();

    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.workspaceId, workspace.id));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "notification_policy.updated",
        "notification_policy.reset",
      ]),
    );
  });

  it("refuses unknown events", async () => {
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    const response = await requestAs(owner)("/notification-policy/nope", {
      method: "PUT",
      body: {
        workspaceId: workspace.id,
        inApp: true,
        email: true,
        locked: false,
      },
    });
    expect(response.status).toBe(404);
  });
});
