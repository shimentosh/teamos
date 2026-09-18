import { statement } from "@kaneo/permissions";

// A portable roles file, so roles built on one instance (say, locally) can be
// brought into another workspace. Only names and permissions travel.
export const ROLES_FILE_FORMAT = "teamos.roles";
export const ROLES_FILE_VERSION = 1;

export type Permissions = Record<string, string[]>;
export type PortableRole = { name: string; permissions: Permissions };

export type ImportPlanItem = PortableRole & {
  action: "create" | "update" | "unchanged";
  // Permissions this instance doesn't know; dropped rather than failing.
  dropped: string[];
};

const ROLE_NAME = /^[a-z0-9][a-z0-9 _-]{0,49}$/;
// Owner stays a static role on the auth side and can't be imported over.
const NOT_IMPORTABLE = new Set(["owner"]);

function sortedPermissions(permissions: Permissions): Permissions {
  const out: Permissions = {};
  for (const resource of Object.keys(permissions).sort()) {
    const actions = [...new Set(permissions[resource])].sort();
    if (actions.length > 0) out[resource] = actions;
  }
  return out;
}

export function buildRolesFile(
  roles: { role: string; permission: Permissions }[],
  workspaceName?: string,
) {
  return {
    format: ROLES_FILE_FORMAT,
    version: ROLES_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    ...(workspaceName && { workspace: workspaceName }),
    roles: roles.map((role) => ({
      name: role.role,
      permissions: sortedPermissions(role.permission),
    })),
  };
}

export class RolesFileError extends Error {}

/** Keeps only permissions this instance knows, reporting the rest. */
function knownPermissions(raw: unknown) {
  const permissions: Permissions = {};
  const dropped: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { permissions, dropped };
  }
  const vocabulary = statement as Record<string, readonly string[]>;
  for (const [resource, actions] of Object.entries(raw)) {
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if (typeof action !== "string") continue;
      if (vocabulary[resource]?.includes(action)) {
        permissions[resource] = [...(permissions[resource] ?? []), action];
      } else {
        dropped.push(`${resource}:${action}`);
      }
    }
  }
  return { permissions: sortedPermissions(permissions), dropped };
}

/** Parses a roles file and decides what importing it would do. */
export function planRolesImport(
  text: string,
  existing: { role: string; permission: Permissions }[],
): ImportPlanItem[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RolesFileError("notJson");
  }
  const file = data as { format?: unknown; roles?: unknown };
  if (file?.format !== ROLES_FILE_FORMAT || !Array.isArray(file.roles)) {
    throw new RolesFileError("notRolesFile");
  }

  const current = new Map(
    existing.map((role) => [role.role.toLowerCase(), role.permission]),
  );
  const seen = new Set<string>();
  const plan: ImportPlanItem[] = [];
  for (const entry of file.roles as {
    name?: unknown;
    permissions?: unknown;
  }[]) {
    const name =
      typeof entry?.name === "string" ? entry.name.trim().toLowerCase() : "";
    if (!ROLE_NAME.test(name) || NOT_IMPORTABLE.has(name) || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const { permissions, dropped } = knownPermissions(entry.permissions);
    if (Object.keys(permissions).length === 0) continue;

    const before = current.get(name);
    const action = !before
      ? "create"
      : JSON.stringify(sortedPermissions(before)) ===
          JSON.stringify(permissions)
        ? "unchanged"
        : "update";
    plan.push({ name, permissions, action, dropped });
  }
  if (plan.length === 0) throw new RolesFileError("noRoles");
  return plan;
}
