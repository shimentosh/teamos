import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function runMigration() {
  const file = new URL(
    "../../apps/api/drizzle/0084_member_cannot_create_projects.sql",
    import.meta.url,
  );
  await db.execute(sql.raw(readFileSync(file, "utf8")));
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("member project:create migration", () => {
  it("takes project:create off member, in the catalog and the mirror", async () => {
    const { workspace } = await createWorkspaceMember({
      role: "owner",
      seeAllTasks: false,
    });
    await db.insert(schema.instanceRoleTable).values([
      {
        role: "member",
        permission: JSON.stringify({
          project: ["create", "read"],
          task: ["create", "read"],
        }),
      },
      {
        // Another role that carries it keeps it.
        role: "manager",
        permission: JSON.stringify({ project: ["create", "read", "update"] }),
      },
    ]);
    await db.insert(schema.workspaceRoleTable).values([
      {
        workspaceId: workspace.id,
        role: "member",
        permission: JSON.stringify({
          project: ["create", "read"],
          task: ["create", "read"],
        }),
      },
      {
        workspaceId: workspace.id,
        role: "broken",
        permission: "not json",
      },
    ]);

    await runMigration();
    await runMigration();

    const catalog = await db.select().from(schema.instanceRoleTable);
    const byRole = Object.fromEntries(
      catalog.map((row) => [row.role, JSON.parse(row.permission)]),
    );
    expect(byRole.member).toEqual({
      project: ["read"],
      task: ["create", "read"],
    });
    expect(byRole.manager).toEqual({ project: ["create", "read", "update"] });

    const [mirrored] = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.role, "member"));
    expect(JSON.parse(mirrored?.permission ?? "{}")).toEqual({
      project: ["read"],
      task: ["create", "read"],
    });

    // The unparseable row is skipped, not dropped or rewritten.
    const [broken] = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.role, "broken"));
    expect(broken?.permission).toBe("not json");
  });

  it("leaves a member role that never had project:create alone", async () => {
    await db.insert(schema.instanceRoleTable).values({
      role: "member",
      permission: JSON.stringify({ task: ["read"] }),
    });

    await runMigration();

    const [row] = await db
      .select()
      .from(schema.instanceRoleTable)
      .where(eq(schema.instanceRoleTable.role, "member"));
    expect(JSON.parse(row?.permission ?? "{}")).toEqual({ task: ["read"] });
  });
});
