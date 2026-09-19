import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { canCreateWorkspace } from "../../apps/api/src/utils/can-create-workspace";
import { resetTestDatabase } from "./helpers/database";

async function seedUser(role: string | null) {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      email: `${id}@example.com`,
      emailVerified: true,
      name: "Workspace Creation Test User",
      role,
    })
    .returning();
  return user;
}

describe("API integration: who may create a workspace", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets a super-admin create one", async () => {
    const user = await seedUser("super-admin");
    expect(await canCreateWorkspace(user.id)).toBe(true);
  });

  it("lets an admin create one", async () => {
    const user = await seedUser("admin");
    expect(await canCreateWorkspace(user.id)).toBe(true);
  });

  it("refuses a plain user", async () => {
    const user = await seedUser("user");
    expect(await canCreateWorkspace(user.id)).toBe(false);
  });

  // Rows predating the instance-role column have role = NULL.
  it("refuses a user with no role at all", async () => {
    const user = await seedUser(null);
    expect(await canCreateWorkspace(user.id)).toBe(false);
  });

  // A workspace role is not an instance tier: an owner of one workspace still
  // cannot spin up another.
  it("refuses a workspace owner who is not an instance admin", async () => {
    const user = await seedUser("user");
    const [workspace] = await db
      .insert(schema.workspaceTable)
      .values({
        id: `workspace-${randomUUID()}`,
        name: "Owned Workspace",
        slug: `workspace-${randomUUID()}`,
        createdAt: new Date(),
      })
      .returning();
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: user.id,
      role: "owner",
      joinedAt: new Date(),
    });

    expect(await canCreateWorkspace(user.id)).toBe(false);
  });

  it("refuses an unknown user id", async () => {
    expect(await canCreateWorkspace("user-does-not-exist")).toBe(false);
  });
});
