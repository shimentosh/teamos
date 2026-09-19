import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { asc, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";

async function runMigration() {
  const file = new URL(
    "../../apps/api/drizzle/0081_super_admin_role.sql",
    import.meta.url,
  );
  await db.execute(sql.raw(readFileSync(file, "utf8")));
}

async function seedUser(role: string | null, createdAt: Date) {
  const id = `user-${randomUUID()}`;
  await db.insert(schema.userTable).values({
    id,
    email: `${id}@example.com`,
    emailVerified: true,
    name: `User ${role ?? "none"}`,
    role,
    createdAt,
  });
  return id;
}

async function rolesById() {
  const rows = await db
    .select({ id: schema.userTable.id, role: schema.userTable.role })
    .from(schema.userTable)
    .orderBy(asc(schema.userTable.createdAt));
  return Object.fromEntries(rows.map((row) => [row.id, row.role]));
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("super-admin bootstrap migration", () => {
  it("promotes the oldest admin and leaves the others alone", async () => {
    const firstAdmin = await seedUser("admin", new Date("2024-01-01"));
    const secondAdmin = await seedUser("admin", new Date("2024-06-01"));
    const plainUser = await seedUser("user", new Date("2024-02-01"));
    const roleless = await seedUser(null, new Date("2023-01-01"));

    await runMigration();
    await runMigration();

    const roles = await rolesById();
    expect(roles[firstAdmin]).toBe("super-admin");
    expect(roles[secondAdmin]).toBe("admin");
    expect(roles[plainUser]).toBe("user");
    expect(roles[roleless]).toBeNull();
  });

  it("does nothing once a super-admin exists", async () => {
    const existing = await seedUser("super-admin", new Date("2024-06-01"));
    const admin = await seedUser("admin", new Date("2024-01-01"));

    await runMigration();

    const roles = await rolesById();
    expect(roles[existing]).toBe("super-admin");
    expect(roles[admin]).toBe("admin");
  });

  it("does nothing on an instance with no admin at all", async () => {
    const plainUser = await seedUser("user", new Date("2024-01-01"));

    await runMigration();

    const roles = await rolesById();
    expect(roles[plainUser]).toBe("user");
  });
});
