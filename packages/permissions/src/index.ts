import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

// Instance-wide tiers, stored on `user.role` by Better Auth's admin plugin.
// They sit above workspace membership: both bypass every workspace permission
// check, and only they may create a workspace. `super-admin` is the first user
// to sign up and is additionally the only tier that can promote or demote
// another admin.
export const SUPER_ADMIN_ROLE = "super-admin";
export const INSTANCE_ADMIN_ROLE = "admin";
export const INSTANCE_ADMIN_ROLES = [
  SUPER_ADMIN_ROLE,
  INSTANCE_ADMIN_ROLE,
] as const;
export type InstanceAdminRole = (typeof INSTANCE_ADMIN_ROLES)[number];

export function isInstanceAdminRole(role: string | null | undefined): boolean {
  return role === SUPER_ADMIN_ROLE || role === INSTANCE_ADMIN_ROLE;
}

export function isSuperAdminRole(role: string | null | undefined): boolean {
  return role === SUPER_ADMIN_ROLE;
}

export const statement = {
  ...defaultStatements,
  project: ["create", "read", "update", "delete", "share"],
  // Without read_all, a member sees only the tasks assigned to them.
  task: ["create", "read", "read_all", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "delete", "manage_settings"],
  // Everyone may log, see and edit their own time; these grant the same for
  // other people's entries (timesheets, corrections).
  timeEntry: ["read_all", "manage_all"],
  // Company layer. Everyone always sees their own profile, attendance,
  // activity, requests and pay; these cover other people's.
  people: ["read_all", "manage"],
  activity: ["read_all"],
  request: ["approve"],
  payroll: ["read", "manage"],
  audit: ["read"],
  // Workspace files. Everyone who works in the workspace can upload and share
  // their own; manage covers other people's files.
  file: ["upload", "manage"],
  // Workspace-wide reports. Everyone sees a report of their own work; this
  // covers the whole team's.
  report: ["read"],
  // Chat channels. Everyone in the workspace reads open channels and posts in
  // the conversations they belong to; these cover the channels themselves.
  // Whoever creates a channel can always rename and delete that one.
  channel: ["create", "update", "delete"],
} as const;

export const ac = createAccessControl(statement);

export const viewer = ac.newRole({
  ...memberAc.statements,
  project: ["read"],
  task: ["read", "read_all"],
  label: ["read"],
  workspace: ["read"],
});

// Projects are opened by whoever runs them, not by everyone: a member works
// inside the projects they are on the team of and sees only the tasks assigned
// to them. Give a role `project:create` in Settings > Roles to change that.
export const member = ac.newRole({
  ...memberAc.statements,
  project: ["read"],
  task: ["create", "read", "update"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read"],
  file: ["upload"],
  channel: ["create"],
});

// Runs a team day to day: sees people, time and activity, approves leave and
// expenses, but not pay or workspace settings.
export const manager = ac.newRole({
  ...memberAc.statements,
  project: ["create", "read", "update"],
  task: ["create", "read", "read_all", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read"],
  timeEntry: ["read_all"],
  people: ["read_all"],
  activity: ["read_all"],
  request: ["approve"],
  file: ["upload"],
  report: ["read"],
  channel: ["create", "update", "delete"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  project: ["create", "read", "update", "delete", "share"],
  task: ["create", "read", "read_all", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "manage_settings"],
  timeEntry: ["read_all", "manage_all"],
  people: ["read_all", "manage"],
  activity: ["read_all"],
  request: ["approve"],
  payroll: ["read", "manage"],
  audit: ["read"],
  file: ["upload", "manage"],
  report: ["read"],
  channel: ["create", "update", "delete"],
});

export const owner = ac.newRole({
  ...ownerAc.statements,
  project: ["create", "read", "update", "delete", "share"],
  task: ["create", "read", "read_all", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "delete", "manage_settings"],
  timeEntry: ["read_all", "manage_all"],
  people: ["read_all", "manage"],
  activity: ["read_all"],
  request: ["approve"],
  payroll: ["read", "manage"],
  audit: ["read"],
  file: ["upload", "manage"],
  report: ["read"],
  channel: ["create", "update", "delete"],
});

export const builtInRoles = { viewer, member, manager, admin, owner } as const;

export type BuiltInRoleName = keyof typeof builtInRoles;

// Default-role names the API seeds into the instance catalog. These ARE
// editable in the UI (their permissions live as rows in `instance_role`), but
// their names are reserved and the rows are created at boot if missing.
// `owner` is intentionally NOT in this list because it stays a true static
// role on the better-auth side.
export const DEFAULT_ROLE_NAMES = [
  "viewer",
  "member",
  "manager",
  "admin",
] as const;
export type DefaultRoleName = (typeof DEFAULT_ROLE_NAMES)[number];

function toMutablePayload(
  statements: Record<string, readonly string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(statements)) {
    out[resource] = [...actions];
  }
  return out;
}

// Plain JSON-serializable permission payloads for the seeded default roles.
// Mirrors each role's `.statements` (including better-auth's organization/
// member/team/invitation/ac defaults) so a catalog row that uses one of these
// has parity with the compiled-in definition.
export const defaultRolePayloads: Record<
  DefaultRoleName,
  Record<string, string[]>
> = {
  viewer: toMutablePayload(viewer.statements),
  member: toMutablePayload(member.statements),
  manager: toMutablePayload(manager.statements),
  admin: toMutablePayload(admin.statements),
};

type Statements = Record<string, readonly string[]>;

// A role may only be granted by someone who already holds every permission
// it carries; otherwise inviting or promoting would be a way to escalate.
// Each side is a list because a member's role string can name several roles.
export function coversPermissions(
  granter: Statements[],
  target: Statements[],
): boolean {
  const held = new Map<string, Set<string>>();
  for (const statements of granter) {
    for (const [resource, actions] of Object.entries(statements)) {
      const set = held.get(resource) ?? new Set<string>();
      for (const action of actions) set.add(action);
      held.set(resource, set);
    }
  }
  return target.every((statements) =>
    Object.entries(statements).every(([resource, actions]) =>
      actions.every((action) => held.get(resource)?.has(action)),
    ),
  );
}
