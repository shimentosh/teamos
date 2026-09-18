import { statement } from "@kaneo/permissions";

export const AGENT_SCOPES = ["read", "tasks", "full"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

type Statements = Record<string, string[]>;

// What each scope lets a key do. The person's role still applies on top:
// a key never does more than the person who made it.
// Seeing people, their workload, time and reports is what lets Claude assign
// fairly and write reports. Desktop activity stays out of every scope.
const COMPANY_READS: Statements = {
  people: ["read_all"],
  timeEntry: ["read_all"],
  report: ["read"],
};

const READ: Statements = {
  project: ["read"],
  task: ["read", "read_all"],
  label: ["read"],
  workspace: ["read"],
  ...COMPANY_READS,
};

const TASKS: Statements = {
  project: ["create", "read", "update"],
  task: ["create", "read", "read_all", "update", "assign"],
  label: ["create", "read", "update"],
  workspace: ["read"],
  ...COMPANY_READS,
};

// Everything the role allows, except money, the audit trail, workspace
// settings and people management: those stay with humans unless an owner
// makes a key by hand.
const HELD_BACK: Record<string, string[] | "all"> = {
  payroll: "all",
  audit: "all",
  activity: "all",
  people: ["manage"],
  workspace: ["update", "delete", "manage_settings"],
  organization: "all",
  member: "all",
  invitation: "all",
  team: "all",
  ac: "all",
};

function fullStatements(): Statements {
  const out: Statements = {};
  for (const [resource, actions] of Object.entries(statement)) {
    const held = HELD_BACK[resource];
    if (held === "all") continue;
    const kept = (actions as readonly string[]).filter(
      (action) => !held?.includes(action),
    );
    if (kept.length > 0) out[resource] = kept;
  }
  return out;
}

export function permissionsFor(scope: AgentScope): Statements {
  if (scope === "read") return READ;
  if (scope === "tasks") return TASKS;
  return fullStatements();
}
