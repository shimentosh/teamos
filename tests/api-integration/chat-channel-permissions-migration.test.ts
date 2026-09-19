import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function runMigration() {
  const file = new URL(
    "../../apps/api/drizzle/0080_grant_chat_channel_permissions.sql",
    import.meta.url,
  );
  await db.execute(sql.raw(readFileSync(file, "utf8")));
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("chat channel permission migration", () => {
  it("grants each default role what it could already do with channels", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceRoleTable).values([
      {
        workspaceId: workspace.id,
        role: "member",
        permission: JSON.stringify({ task: ["read"] }),
      },
      {
        workspaceId: workspace.id,
        role: "manager",
        permission: JSON.stringify({ task: ["read"] }),
      },
      {
        workspaceId: workspace.id,
        role: "admin",
        // An owner who already narrowed channels keeps their choice.
        permission: JSON.stringify({ task: ["read"], channel: ["create"] }),
      },
      {
        workspaceId: workspace.id,
        role: "viewer",
        permission: JSON.stringify({ task: ["read"] }),
      },
      {
        workspaceId: workspace.id,
        role: "hr",
        permission: JSON.stringify({ task: ["read"] }),
      },
    ]);

    // A row the migration would otherwise rewrite, but can't parse.
    const { workspace: other } = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: other.id,
      role: "member",
      permission: "not json",
    });

    await runMigration();
    await runMigration();

    const rows = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
    const byRole = Object.fromEntries(rows.map((r) => [r.role, r.permission]));

    expect(JSON.parse(byRole.member)).toEqual({
      task: ["read"],
      channel: ["create"],
    });
    expect(JSON.parse(byRole.manager)).toEqual({
      task: ["read"],
      channel: ["create", "update", "delete"],
    });
    expect(JSON.parse(byRole.admin)).toEqual({
      task: ["read"],
      channel: ["create"],
    });
    // Viewers never could, and a custom role is the admin's call to make.
    expect(JSON.parse(byRole.viewer)).toEqual({ task: ["read"] });
    expect(JSON.parse(byRole.hr)).toEqual({ task: ["read"] });

    const [unparseable] = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, other.id));
    expect(unparseable.permission).toBe("not json");
  });
});
