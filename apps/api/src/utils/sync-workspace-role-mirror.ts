import { DEFAULT_ROLE_NAMES, defaultRolePayloads } from "@kaneo/permissions";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import db, { schema } from "../database";

// Role definitions live once, in `instance_role`. Better Auth's organization
// plugin, however, resolves the permissions for its own endpoints (invite a
// member, change someone's role, and so on) from `organizationRole` rows
// scoped to one organization — our `workspace_role`. A role name with no row
// in the workspace comes back as ROLE_NOT_FOUND there.
//
// So `workspace_role` is kept as a mirror of the catalog: written only by the
// functions here, never edited directly. TeamOS's own permission checks read
// the catalog, so a mirror that somehow drifts cannot widen anyone's access.

// Postgres caps bind parameters at 65535 per statement. 6 columns x 1000 rows
// leaves ample headroom.
const BATCH_SIZE = 1000;

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = ${name}
    ) AS exists;
  `);
  return result.rows[0]?.exists === true || result.rows[0]?.exists === "t";
}

/**
 * Adds any built-in role the catalog is missing, using the compiled-in
 * defaults. A fresh database starts empty; an upgraded one keeps whatever the
 * seed migration copied over from `workspace_role`.
 */
export async function seedDefaultInstanceRoles() {
  const existing = await db
    .select({ role: schema.instanceRoleTable.role })
    .from(schema.instanceRoleTable)
    .where(inArray(schema.instanceRoleTable.role, [...DEFAULT_ROLE_NAMES]));
  const present = new Set(existing.map((row) => row.role));

  const missing = DEFAULT_ROLE_NAMES.filter((name) => !present.has(name));
  if (missing.length === 0) return 0;

  await db.insert(schema.instanceRoleTable).values(
    missing.map((name) => ({
      role: name,
      permission: JSON.stringify(defaultRolePayloads[name]),
    })),
  );
  return missing.length;
}

type CatalogRole = { role: string; permission: string };

async function readCatalog(): Promise<CatalogRole[]> {
  return db
    .select({
      role: schema.instanceRoleTable.role,
      permission: schema.instanceRoleTable.permission,
    })
    .from(schema.instanceRoleTable);
}

async function writeMirror(catalog: CatalogRole[], workspaceIds: string[]) {
  if (workspaceIds.length === 0) return;

  const existing = await db
    .select({
      id: schema.workspaceRoleTable.id,
      workspaceId: schema.workspaceRoleTable.workspaceId,
      role: schema.workspaceRoleTable.role,
      permission: schema.workspaceRoleTable.permission,
    })
    .from(schema.workspaceRoleTable)
    .where(inArray(schema.workspaceRoleTable.workspaceId, workspaceIds));

  const byKey = new Map(
    existing.map((row) => [`${row.workspaceId}:${row.role}`, row]),
  );

  const inserts: Array<typeof schema.workspaceRoleTable.$inferInsert> = [];
  const updates: Array<{ id: string; permission: string }> = [];

  for (const workspaceId of workspaceIds) {
    for (const entry of catalog) {
      const current = byKey.get(`${workspaceId}:${entry.role}`);
      if (!current) {
        inserts.push({
          workspaceId,
          role: entry.role,
          permission: entry.permission,
        });
      } else if (current.permission !== entry.permission) {
        updates.push({ id: current.id, permission: entry.permission });
      }
    }
  }

  for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
    await db
      .insert(schema.workspaceRoleTable)
      .values(inserts.slice(i, i + BATCH_SIZE));
  }

  for (const update of updates) {
    await db
      .update(schema.workspaceRoleTable)
      .set({ permission: update.permission })
      .where(eq(schema.workspaceRoleTable.id, update.id));
  }

  // A role deleted from the catalog must stop existing for Better Auth too,
  // or it could still be handed out through the organization endpoints.
  //
  // An empty catalog means the seed has not run (or failed), not that every
  // role was deleted. Clearing the mirror then would lock every member out of
  // the organization endpoints, so leave it alone and let the next boot seed.
  const names = catalog.map((entry) => entry.role);
  if (names.length === 0) return;

  await db
    .delete(schema.workspaceRoleTable)
    .where(
      and(
        inArray(schema.workspaceRoleTable.workspaceId, workspaceIds),
        notInArray(schema.workspaceRoleTable.role, names),
      ),
    );
}

/** Rebuilds one workspace's mirror; for a workspace that was just created. */
export async function syncWorkspaceRoleMirrorFor(workspaceId: string) {
  await writeMirror(await readCatalog(), [workspaceId]);
}

/**
 * Rebuilds the mirror everywhere. Runs at boot and after every catalog write,
 * so a role edit reaches Better Auth in the same request.
 */
export async function syncWorkspaceRoleMirror() {
  const workspaces = await db
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable);

  await writeMirror(
    await readCatalog(),
    workspaces.map((workspace) => workspace.id),
  );
}

/**
 * Boot-time pass: fill in any missing built-in roles, then make every
 * workspace's mirror match. Replaces the old per-workspace default-role seed.
 */
export async function seedAndSyncRoles() {
  try {
    if (!(await tableExists("instance_role"))) {
      console.log("🛈 instance_role table does not exist; skipping role sync.");
      return;
    }

    const seeded = await seedDefaultInstanceRoles();
    if (seeded > 0) {
      console.log(`✅ Seeded ${seeded} default role(s) into the catalog.`);
    }

    await syncWorkspaceRoleMirror();
  } catch (error) {
    console.error("❌ Failed to sync workspace role mirror:", error);
    throw error;
  }
}
