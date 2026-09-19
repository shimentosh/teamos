import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { requestAs } from "./helpers/company";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

async function makeInstanceAdmin(userId: string) {
  const [user] = await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, userId))
    .returning();
  return user;
}

async function mirrorRow(workspaceId: string, role: string) {
  const [row] = await db
    .select()
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    );
  return row ?? null;
}

async function createTaskAs(
  user: { id: string; name: string; email: string },
  projectId: string,
) {
  mockAuthenticatedSession(user as never);
  const { app } = createApp();
  return app.request(`/api/task/${projectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Task ${randomUUID()}`,
      description: "",
      priority: "low",
      status: "to-do",
    }),
  });
}

describe("instance role catalog", () => {
  it("is off limits to anyone who is not an instance admin", async () => {
    const { user: owner } = await createWorkspaceMember({ role: "owner" });

    const listed = await requestAs(owner)("/instance/roles");
    expect(listed.status).toBe(403);

    const created = await requestAs(owner)("/instance/roles", {
      method: "POST",
      body: { role: "reviewer", permission: { task: ["read"] } },
    });
    expect(created.status).toBe(403);
  });

  it("mirrors a new role into every workspace", async () => {
    const { user, workspace: first } = await createWorkspaceMember({
      role: "owner",
    });
    const { workspace: second } = await createWorkspaceMember({
      role: "owner",
    });
    const admin = await makeInstanceAdmin(user.id);

    const created = await requestAs(admin)("/instance/roles", {
      method: "POST",
      body: { role: "reviewer", permission: { task: ["read", "read_all"] } },
    });
    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({
      role: "reviewer",
      permission: { task: ["read", "read_all"] },
      isDefault: false,
    });

    for (const workspace of [first, second]) {
      const row = await mirrorRow(workspace.id, "reviewer");
      expect(row).not.toBeNull();
      expect(JSON.parse(row?.permission ?? "{}")).toEqual({
        task: ["read", "read_all"],
      });
    }
  });

  it("drops resources and actions the vocabulary does not define", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    const admin = await makeInstanceAdmin(user.id);

    const created = await requestAs(admin)("/instance/roles", {
      method: "POST",
      body: {
        role: "reviewer",
        permission: {
          task: ["read", "teleport"],
          unicorn: ["ride"],
        },
      },
    });

    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({ permission: { task: ["read"] } });
  });

  it("refuses built-in names and duplicates", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    const admin = await makeInstanceAdmin(user.id);

    const builtIn = await requestAs(admin)("/instance/roles", {
      method: "POST",
      body: { role: "member", permission: { task: ["read"] } },
    });
    expect(builtIn.status).toBe(400);

    const owner = await requestAs(admin)("/instance/roles", {
      method: "POST",
      body: { role: "owner", permission: { task: ["read"] } },
    });
    expect(owner.status).toBe(400);

    await requestAs(admin)("/instance/roles", {
      method: "POST",
      body: { role: "reviewer", permission: { task: ["read"] } },
    });
    const again = await requestAs(admin)("/instance/roles", {
      method: "POST",
      body: { role: "reviewer", permission: { task: ["read"] } },
    });
    expect(again.status).toBe(409);
  });

  it("changes what a role may do in a workspace, at once", async () => {
    const { user: adminUser } = await createWorkspaceMember({ role: "owner" });
    const admin = await makeInstanceAdmin(adminUser.id);

    const { user: reviewer, workspace } = await createWorkspaceMember({
      role: "reviewer",
    });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await db
      .insert(schema.projectMemberTable)
      .values({ projectId: project.id, userId: reviewer.id })
      .onConflictDoNothing();

    await requestAs(admin)("/instance/roles", {
      method: "POST",
      body: { role: "reviewer", permission: { task: ["read"] } },
    });
    expect((await createTaskAs(reviewer, project.id)).status).toBe(403);

    const updated = await requestAs(admin)("/instance/roles/reviewer", {
      method: "PATCH",
      body: { permission: { task: ["read", "create"] } },
    });
    expect(updated.status).toBe(200);

    expect((await createTaskAs(reviewer, project.id)).status).toBe(200);
  });

  it("keeps a role that people still hold, and clears one nobody does", async () => {
    const { user: adminUser, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    const admin = await makeInstanceAdmin(adminUser.id);

    await requestAs(admin)("/instance/roles", {
      method: "POST",
      body: { role: "reviewer", permission: { task: ["read"] } },
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: (await createWorkspaceMember({ role: "reviewer" })).user.id,
      role: "reviewer",
      joinedAt: new Date(),
    });

    const inUse = await requestAs(admin)("/instance/roles/reviewer", {
      method: "DELETE",
    });
    expect(inUse.status).toBe(400);
    expect(await mirrorRow(workspace.id, "reviewer")).not.toBeNull();

    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.role, "reviewer"));

    const removed = await requestAs(admin)("/instance/roles/reviewer", {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    expect(await mirrorRow(workspace.id, "reviewer")).toBeNull();
  });

  it("refuses deleting a built-in role", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    const admin = await makeInstanceAdmin(user.id);

    const response = await requestAs(admin)("/instance/roles/member", {
      method: "DELETE",
    });
    expect(response.status).toBe(400);
  });
});
