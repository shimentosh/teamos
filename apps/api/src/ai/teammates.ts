import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getCompanySettings } from "../company/settings";
import db from "../database";
import { aiTeammateTable, workspaceTable } from "../database/schema";
import createNotification from "../notification/controllers/create-notification";
import { applyChangeSet, getAiSettings, proposeAndWait } from "./change-sets";

export const TEAMMATE_KINDS = [
  "triage",
  "standup",
  "overdue",
  "weekly",
] as const;
export type TeammateKind = (typeof TEAMMATE_KINDS)[number];

// What each teammate does. The owner's own instructions are added on top.
const JOBS: Record<TeammateKind, (channelId: string | null) => string> = {
  triage: () =>
    "Triage the workspace: find open tasks with no assignee, no priority or no due date. Use people_workload to see who has room. Propose a priority for each, an owner with the lightest fitting load, and a due date only where the task clearly implies one. Flag likely duplicates in the summary instead of changing them. At most 20 actions.",
  standup: (channelId) =>
    `Write today's standup from yesterday's work: use timesheet and report_summary for yesterday, person_tasks for what's in progress, and flag anything overdue as blocked. One short section per person with work to report: Yesterday / Today / Blocked.${
      channelId
        ? ` Propose one post_chat action to conversation ${channelId} with the whole standup.`
        : " Put the standup in the summary; propose no actions."
    }`,
  overdue: () =>
    `Find open tasks that are overdue or due today. For each overdue task, propose a short friendly comment to its owner asking for an update or a new date (one comment per task, at most 15). Don't change dates yourself.`,
  weekly: (channelId) =>
    `Write this week's report (Monday to today): done, slipped (overdue), time per project, and risks for next week, under 200 words. Use report_summary, project_health and people_workload.${
      channelId
        ? ` Propose one post_chat action to conversation ${channelId} with the report.`
        : " Put the report in the summary; propose no actions."
    }`,
};

const LABELS: Record<TeammateKind, string> = {
  triage: "Triage",
  standup: "Standup",
  overdue: "Overdue nudges",
  weekly: "Weekly report",
};

const DEFAULTS: Record<TeammateKind, { time: string; days: string }> = {
  triage: { time: "09:00", days: "1,2,3,4,5" },
  standup: { time: "10:30", days: "1,2,3,4,5" },
  overdue: { time: "16:00", days: "1,2,3,4,5" },
  weekly: { time: "17:00", days: "5" },
};

type TeammateRow = typeof aiTeammateTable.$inferSelect;

function present(kind: TeammateKind, row: TeammateRow | undefined) {
  return {
    kind,
    enabled: row?.enabled ?? false,
    instructions: row?.instructions ?? null,
    time: row?.time ?? DEFAULTS[kind].time,
    days: row?.days ?? DEFAULTS[kind].days,
    mode: (row?.mode ?? "suggest") as "suggest" | "act",
    channelId: row?.channelId ?? null,
    lastRunAt: row?.lastRunAt ?? null,
    lastChangeSetId: row?.lastChangeSetId ?? null,
  };
}

/** The four teammates for this person, set up or not. */
export async function listTeammates(workspaceId: string, userId: string) {
  const rows = await db
    .select()
    .from(aiTeammateTable)
    .where(
      and(
        eq(aiTeammateTable.workspaceId, workspaceId),
        eq(aiTeammateTable.userId, userId),
      ),
    );
  return TEAMMATE_KINDS.map((kind) =>
    present(
      kind,
      rows.find((r) => r.kind === kind),
    ),
  );
}

export async function saveTeammate(
  workspaceId: string,
  userId: string,
  kind: TeammateKind,
  input: {
    enabled: boolean;
    instructions?: string | null;
    time: string;
    days: string;
    mode: "suggest" | "act";
    channelId?: string | null;
  },
) {
  const values = {
    enabled: input.enabled,
    instructions: input.instructions?.trim() || null,
    time: input.time,
    days: input.days,
    mode: input.mode,
    channelId: input.channelId ?? null,
  };
  await db
    .insert(aiTeammateTable)
    .values({ workspaceId, userId, kind, ...values })
    .onConflictDoUpdate({
      target: [
        aiTeammateTable.workspaceId,
        aiTeammateTable.userId,
        aiTeammateTable.kind,
      ],
      set: values,
    });
  return (await listTeammates(workspaceId, userId)).find(
    (t) => t.kind === kind,
  );
}

async function runRow(row: TeammateRow, today: string) {
  // Claimed first, so a slow run isn't started again on the next tick.
  await db
    .update(aiTeammateTable)
    .set({ lastRunAt: new Date(), lastRunDay: today })
    .where(eq(aiTeammateTable.id, row.id));

  const [workspace] = await db
    .select({ name: workspaceTable.name })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, row.workspaceId));
  const kind = row.kind as TeammateKind;
  const prompt = [
    `Workspace: "${workspace?.name ?? ""}" (id ${row.workspaceId}).`,
    `You are the ${kind} teammate, running on schedule.`,
    JOBS[kind](row.channelId),
    row.instructions && `The owner adds: ${row.instructions}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let changeSet = await proposeAndWait(
    row.workspaceId,
    row.userId,
    prompt,
    `teammate:${kind}`,
    `${LABELS[kind]} · scheduled`,
  );
  const actions = (changeSet.actions as unknown[] | null) ?? [];
  if (
    row.mode === "act" &&
    changeSet.status === "proposed" &&
    actions.length > 0
  ) {
    changeSet =
      (await applyChangeSet(
        row.workspaceId,
        row.userId,
        changeSet.id,
        actions.map((_, i) => i),
      )) ?? changeSet;
  }
  await db
    .update(aiTeammateTable)
    .set({ lastChangeSetId: changeSet.id })
    .where(eq(aiTeammateTable.id, row.id));

  // Tell the owner there's something to look at.
  if (changeSet.status !== "failed") {
    await createNotification({
      userId: row.userId,
      type: "ai_teammate",
      eventData: {
        workspaceId: row.workspaceId,
        kind,
        status: changeSet.status,
        actions: actions.length,
        summary: (changeSet.summary ?? "").slice(0, 300),
      },
      resourceId: changeSet.id,
      resourceType: "ai_change_set",
    });
  }
  return changeSet;
}

/** "Run now" from settings, whatever the schedule says. */
export async function runTeammateNow(
  workspaceId: string,
  userId: string,
  kind: TeammateKind,
) {
  const settings = await getAiSettings(workspaceId);
  if (!settings.enabled) {
    throw new HTTPException(403, { message: "Ask TeamOS is off" });
  }
  const [row] = await db
    .select()
    .from(aiTeammateTable)
    .where(
      and(
        eq(aiTeammateTable.workspaceId, workspaceId),
        eq(aiTeammateTable.userId, userId),
        eq(aiTeammateTable.kind, kind),
      ),
    );
  if (!row) {
    throw new HTTPException(404, { message: "Save this teammate first" });
  }
  const company = await getCompanySettings(workspaceId);
  const { day } = localNow(new Date(), company.timezone);
  // Runs in the background; the owner is notified when it's done.
  void runRow(row, day).catch((error) =>
    console.error("AI teammate run failed:", error),
  );
  return { started: true };
}

function localNow(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday =
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) +
    1;
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    weekday,
  };
}

let running = false;

/**
 * Every minute: start each enabled teammate whose time has come today (in
 * its company's timezone) and hasn't run today. One at a time, since each
 * run is a Claude session.
 */
export async function runDueTeammates(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const rows = await db
      .select()
      .from(aiTeammateTable)
      .where(eq(aiTeammateTable.enabled, true));
    for (const row of rows) {
      const ai = await getAiSettings(row.workspaceId);
      if (!ai.enabled || !ai.serverAvailable) continue;
      const company = await getCompanySettings(row.workspaceId);
      const local = localNow(now, company.timezone);
      const days = row.days.split(",").map(Number);
      if (!days.includes(local.weekday)) continue;
      if (local.time < row.time || row.lastRunDay === local.day) continue;
      await runRow(row, local.day).catch((error) =>
        console.error("AI teammate run failed:", error),
      );
    }
  } finally {
    running = false;
  }
}
