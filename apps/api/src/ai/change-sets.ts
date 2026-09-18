import { and, desc, eq, gt, isNull, like, lt } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { auth } from "../auth";
import { ONLINE_WINDOW_MS } from "../company/presence";
import db from "../database";
import {
  agentDeviceTable,
  aiChangeSetTable,
  apikeyTable,
  workspaceAiSettingTable,
  workspaceTable,
} from "../database/schema";
import { claudeCodeAvailable, type RunEvent, runClaudeCode } from "./runner";
import { type AgentScope, permissionsFor } from "./scopes";

// ---------------------------------------------------------- settings

export async function getAiSettings(workspaceId: string) {
  const [row] = await db
    .select()
    .from(workspaceAiSettingTable)
    .where(eq(workspaceAiSettingTable.workspaceId, workspaceId));
  return {
    enabled: row?.enabled ?? false,
    engine: (row?.engine ?? "server") as "server" | "desktop",
    serverAvailable: claudeCodeAvailable(),
  };
}

export async function setAiSettings(
  workspaceId: string,
  actorId: string,
  input: { enabled: boolean; engine: "server" | "desktop" },
) {
  await db
    .insert(workspaceAiSettingTable)
    .values({ workspaceId, updatedBy: actorId, ...input })
    .onConflictDoUpdate({
      target: workspaceAiSettingTable.workspaceId,
      set: { ...input, updatedBy: actorId },
    });
  return getAiSettings(workspaceId);
}

// ----------------------------------------------------- temporary keys

const TEMP_TAG = '%"temporary":true%';

// A key that lives for one request: Claude reads with a read-only one, and
// TeamOS applies with a tasks one. Deleted right after; any left behind by a
// crash are swept on the next request.
async function createTemporaryKey(userId: string, scope: AgentScope) {
  await db
    .delete(apikeyTable)
    .where(
      and(
        like(apikeyTable.metadata, TEMP_TAG),
        lt(apikeyTable.createdAt, new Date(Date.now() - 30 * 60_000)),
      ),
    );
  return auth.api.createApiKey({
    body: {
      userId,
      name: "Ask TeamOS (temporary)",
      prefix: "tos_tmp_",
      permissions: permissionsFor(scope),
      metadata: { kind: "agent", scope, temporary: true },
      rateLimitEnabled: false,
    },
  });
}

async function withTemporaryKey<T>(
  userId: string,
  scope: AgentScope,
  fn: (key: string) => Promise<T>,
): Promise<T> {
  const created = await createTemporaryKey(userId, scope);
  try {
    return await fn(created.key);
  } finally {
    await db.delete(apikeyTable).where(eq(apikeyTable.id, created.id));
  }
}

// Applying runs through TeamOS's own routes in-process, so every permission
// check is the real one, with no network hop. Loaded lazily: the app imports
// this module.
let appPromise: Promise<{ request: typeof fetch }> | null = null;
function localApp() {
  appPromise ??= import("../index").then(
    (module) => module.default as unknown as { request: typeof fetch },
  );
  return appPromise;
}

async function api<T = unknown>(
  key: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const app = await localApp();
  const response = await app.request(path, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!response.ok) {
    const message =
      (json as { message?: string } | null)?.message ??
      `HTTP ${response.status}`;
    throw new Error(message);
  }
  return json as T;
}

// ------------------------------------------------------------ actions

const nullableString = z.string().nullable().optional();

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_task"),
    projectId: z.string(),
    title: z.string().min(1).max(300),
    description: z.string().max(5000).optional(),
    status: z.string().optional(),
    priority: z
      .enum(["no-priority", "low", "medium", "high", "urgent"])
      .optional(),
    assigneeId: z.string().optional(),
    dueDate: z.string().optional(),
    reason: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal("update_task"),
    taskId: z.string(),
    title: z.string().min(1).max(300).optional(),
    status: z.string().optional(),
    priority: z
      .enum(["no-priority", "low", "medium", "high", "urgent"])
      .optional(),
    assigneeId: nullableString,
    dueDate: nullableString,
    reason: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal("comment"),
    taskId: z.string(),
    body: z.string().min(1).max(4000),
    reason: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal("post_chat"),
    conversationId: z.string(),
    body: z.string().min(1).max(4000),
    reason: z.string().max(300).optional(),
  }),
]);
export type AiAction = z.infer<typeof actionSchema>;

const INSTRUCTIONS = `You are TeamOS's built-in assistant. Use only the teamos tools. You can read everything the person can, but you cannot change anything yourself: you PROPOSE changes and the person applies them.

Answer in the language the person wrote in. Keep "summary" short (at most 5 lines, plain words).

End your reply with exactly one fenced json block, and nothing after it:
\`\`\`json
{"summary": "…", "actions": [ … ]}
\`\`\`
Each action is one of:
- {"type":"create_task","projectId":"…","title":"…","description":"…","status":"to-do","priority":"no-priority|low|medium|high|urgent","assigneeId":"<user id>","dueDate":"<ISO date>","reason":"…"}
- {"type":"update_task","taskId":"…","title":"…","status":"<column slug>","priority":"…","assigneeId":"<user id or null>","dueDate":"<ISO date or null>","reason":"…"}
- {"type":"comment","taskId":"…","body":"…","reason":"…"}
- {"type":"post_chat","conversationId":"<chat channel id>","body":"…","reason":"…"}
Only include fields you want to set. Use real ids from the tools. Use "actions": [] when the answer needs no changes. Never propose deleting anything. At most 50 actions.`;

function parseProposal(text: string): {
  summary: string;
  actions: AiAction[];
  dropped: number;
} {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const last = blocks.at(-1)?.[1];
  const prose = text.replace(/```json[\s\S]*?```/g, "").trim();
  if (!last) return { summary: prose || text.trim(), actions: [], dropped: 0 };
  let parsed: { summary?: unknown; actions?: unknown };
  try {
    parsed = JSON.parse(last);
  } catch {
    return { summary: prose || text.trim(), actions: [], dropped: 0 };
  }
  const raw = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 50) : [];
  const actions: AiAction[] = [];
  for (const item of raw) {
    const result = actionSchema.safeParse(item);
    if (result.success) actions.push(result.data);
  }
  return {
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : prose,
    actions,
    dropped: raw.length - actions.length,
  };
}

// In-memory progress for the web to poll while Claude works.
const progress = new Map<string, string[]>();

export async function listChangeSets(workspaceId: string, userId: string) {
  return db
    .select()
    .from(aiChangeSetTable)
    .where(
      and(
        eq(aiChangeSetTable.workspaceId, workspaceId),
        eq(aiChangeSetTable.userId, userId),
      ),
    )
    .orderBy(desc(aiChangeSetTable.createdAt))
    .limit(20);
}

async function findChangeSet(workspaceId: string, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(aiChangeSetTable)
    .where(
      and(
        eq(aiChangeSetTable.id, id),
        eq(aiChangeSetTable.workspaceId, workspaceId),
        eq(aiChangeSetTable.userId, userId),
      ),
    );
  if (!row) throw new HTTPException(404, { message: "Not found" });
  return row;
}

export async function getChangeSet(
  workspaceId: string,
  userId: string,
  id: string,
) {
  const row = await findChangeSet(workspaceId, userId, id);
  if (
    row.status === "proposing" &&
    Date.now() - row.createdAt.getTime() > JOB_TIMEOUT_MS
  ) {
    await recordFailure(id, "Claude didn't answer in time; ask again");
    return { ...(await findChangeSet(workspaceId, userId, id)), progress: [] };
  }
  return { ...row, progress: progress.get(id) ?? [] };
}

const JOB_TIMEOUT_MS = 10 * 60_000;

// Built prompts waiting for a desktop to claim them, and the temporary key
// each claimed job holds. Jobs are short; a restart just fails them.
const pendingPrompts = new Map<string, string>();
const jobKeys = new Map<string, string>();

async function recordProposal(id: string, text: string) {
  const proposal = parseProposal(text);
  await db
    .update(aiChangeSetTable)
    .set({
      status: "proposed",
      summary: proposal.summary,
      actions: proposal.actions,
      error:
        proposal.dropped > 0
          ? `${proposal.dropped} proposed change(s) were malformed and left out`
          : null,
    })
    .where(
      and(
        eq(aiChangeSetTable.id, id),
        eq(aiChangeSetTable.status, "proposing"),
      ),
    );
}

async function recordFailure(id: string, message: string) {
  await db
    .update(aiChangeSetTable)
    .set({ status: "failed", error: message })
    .where(
      and(
        eq(aiChangeSetTable.id, id),
        eq(aiChangeSetTable.status, "proposing"),
      ),
    );
}

function addProgress(id: string, steps: string[]) {
  const all = [...(progress.get(id) ?? []), ...steps];
  progress.set(id, all.slice(-30));
}

/**
 * Starts Claude on a request and returns right away; the proposal lands on
 * the change set when Claude finishes. The web polls it.
 */
export async function startAsk(
  workspaceId: string,
  userId: string,
  input: {
    prompt: string;
    context?: { projectId?: string; taskId?: string; page?: string };
  },
) {
  const settings = await getAiSettings(workspaceId);
  if (!settings.enabled) {
    throw new HTTPException(403, {
      message: "Ask TeamOS is off for this workspace",
    });
  }
  if (settings.engine === "server" && !settings.serverAvailable) {
    throw new HTTPException(409, {
      message: "Claude Code isn't installed where TeamOS runs",
    });
  }
  if (settings.engine === "desktop") {
    const [device] = await db
      .select({ id: agentDeviceTable.id })
      .from(agentDeviceTable)
      .where(
        and(
          eq(agentDeviceTable.workspaceId, workspaceId),
          eq(agentDeviceTable.userId, userId),
          isNull(agentDeviceTable.revokedAt),
          gt(
            agentDeviceTable.lastSeenAt,
            new Date(Date.now() - ONLINE_WINDOW_MS),
          ),
        ),
      )
      .limit(1);
    if (!device) {
      throw new HTTPException(409, {
        message:
          "Open the TeamOS desktop app on your computer: it runs your Claude Code",
      });
    }
  }

  const [workspace] = await db
    .select({ name: workspaceTable.name })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId));

  const [row] = await db
    .insert(aiChangeSetTable)
    .values({
      workspaceId,
      userId,
      prompt: input.prompt,
      engine: settings.engine,
    })
    .returning();
  if (!row) throw new HTTPException(500, { message: "Failed to start" });
  progress.set(row.id, []);

  const where = [
    `Workspace: "${workspace?.name ?? ""}" (id ${workspaceId}).`,
    input.context?.projectId &&
      `They are looking at project id ${input.context.projectId}.`,
    input.context?.taskId &&
      `They are looking at task id ${input.context.taskId}.`,
    input.context?.page && `Page: ${input.context.page}.`,
  ]
    .filter(Boolean)
    .join(" ");
  const prompt = `${INSTRUCTIONS}\n\n${where}\n\nThe person asks:\n${input.prompt}`;

  if (settings.engine === "desktop") {
    // A desktop app of theirs picks it up (see claimDesktopJob).
    pendingPrompts.set(row.id, prompt);
    return { ...row, progress: [] as string[] };
  }

  void withTemporaryKey(userId, "read", (key) =>
    runClaudeCode({
      prompt,
      token: key,
      onEvent: (event: RunEvent) => {
        if (event.type === "tool") addProgress(row.id, [event.name]);
      },
    }),
  )
    .then((text) => recordProposal(row.id, text))
    .catch((error: unknown) =>
      recordFailure(
        row.id,
        error instanceof Error ? error.message : String(error),
      ),
    )
    .finally(() => {
      setTimeout(() => progress.delete(row.id), 60_000);
    });

  return { ...row, progress: [] as string[] };
}

/**
 * Runs Claude on the server and waits for the proposal. For scheduled
 * teammates, which have no browser polling for them.
 */
export async function proposeAndWait(
  workspaceId: string,
  userId: string,
  prompt: string,
  engine: string,
  label = prompt,
) {
  if (!claudeCodeAvailable()) {
    throw new Error("Claude Code isn't installed where TeamOS runs");
  }
  const [row] = await db
    .insert(aiChangeSetTable)
    // What the person sees as the request; Claude gets the full prompt.
    .values({ workspaceId, userId, prompt: label, engine })
    .returning();
  if (!row) throw new Error("Failed to start");
  try {
    const text = await withTemporaryKey(userId, "read", (key) =>
      runClaudeCode({ prompt: `${INSTRUCTIONS}\n\n${prompt}`, token: key }),
    );
    await recordProposal(row.id, text);
  } catch (error) {
    await recordFailure(
      row.id,
      error instanceof Error ? error.message : String(error),
    );
  }
  const [done] = await db
    .select()
    .from(aiChangeSetTable)
    .where(eq(aiChangeSetTable.id, row.id));
  return done ?? row;
}

// ------------------------------------------------ desktop bridge (device)

const publicApiUrl = (process.env.KANEO_API_URL || "http://localhost:1337")
  .replace(/\/api\/?$/, "")
  .replace(/\/+$/, "");

/**
 * The oldest request of this device's person waiting for a desktop, claimed
 * for this device. Comes with a read-only key that lives until the result.
 */
export async function claimDesktopJob(device: {
  id: string;
  userId: string;
  workspaceId: string;
}) {
  const [waiting] = await db
    .select({ id: aiChangeSetTable.id })
    .from(aiChangeSetTable)
    .where(
      and(
        eq(aiChangeSetTable.workspaceId, device.workspaceId),
        eq(aiChangeSetTable.userId, device.userId),
        eq(aiChangeSetTable.engine, "desktop"),
        eq(aiChangeSetTable.status, "proposing"),
        isNull(aiChangeSetTable.deviceId),
        gt(aiChangeSetTable.createdAt, new Date(Date.now() - JOB_TIMEOUT_MS)),
      ),
    )
    .orderBy(aiChangeSetTable.createdAt)
    .limit(1);
  if (!waiting) return null;
  const prompt = pendingPrompts.get(waiting.id);
  if (!prompt) {
    await recordFailure(waiting.id, "The request expired; ask again");
    return null;
  }
  const [claimed] = await db
    .update(aiChangeSetTable)
    .set({ deviceId: device.id, claimedAt: new Date() })
    .where(
      and(
        eq(aiChangeSetTable.id, waiting.id),
        isNull(aiChangeSetTable.deviceId),
      ),
    )
    .returning({ id: aiChangeSetTable.id });
  if (!claimed) return null;
  pendingPrompts.delete(waiting.id);

  const key = await createTemporaryKey(device.userId, "read");
  jobKeys.set(waiting.id, key.id);
  addProgress(waiting.id, ["desktop"]);
  return {
    id: waiting.id,
    prompt,
    mcpUrl: `${publicApiUrl}/api/mcp`,
    token: key.key,
  };
}

async function claimedJob(device: { id: string }, id: string) {
  const [row] = await db
    .select()
    .from(aiChangeSetTable)
    .where(
      and(
        eq(aiChangeSetTable.id, id),
        eq(aiChangeSetTable.deviceId, device.id),
      ),
    );
  if (!row) throw new HTTPException(404, { message: "Not your job" });
  return row;
}

export async function reportDesktopProgress(
  device: { id: string },
  id: string,
  steps: string[],
) {
  await claimedJob(device, id);
  addProgress(id, steps.slice(0, 20));
  return { ok: true };
}

export async function finishDesktopJob(
  device: { id: string },
  id: string,
  outcome: { text?: string; error?: string },
) {
  await claimedJob(device, id);
  const keyId = jobKeys.get(id);
  if (keyId) {
    await db.delete(apikeyTable).where(eq(apikeyTable.id, keyId));
    jobKeys.delete(id);
  }
  if (outcome.text) await recordProposal(id, outcome.text);
  else await recordFailure(id, outcome.error || "Claude stopped");
  setTimeout(() => progress.delete(id), 60_000);
  return { ok: true };
}

// --------------------------------------------------------------- apply

type TaskSnapshot = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  priority: string | null;
  userId: string | null;
  dueDate: string | null;
};

type ActionResult = {
  index: number;
  ok: boolean;
  error?: string;
  taskId?: string;
  created?: boolean;
  before?: Partial<TaskSnapshot>;
};

async function applyOne(
  key: string,
  workspaceId: string,
  action: AiAction,
): Promise<ActionResult> {
  if (action.type === "post_chat") {
    await api(key, `/api/chat/${action.conversationId}/messages`, {
      method: "POST",
      body: { workspaceId, body: action.body },
    });
    return { index: -1, ok: true };
  }
  if (action.type === "create_task") {
    const task = await api<{ id: string }>(
      key,
      `/api/task/${action.projectId}`,
      {
        method: "POST",
        body: {
          title: action.title,
          description: action.description ?? "",
          status: action.status ?? "to-do",
          priority: action.priority ?? "no-priority",
          ...(action.assigneeId && { userId: action.assigneeId }),
          ...(action.dueDate && { dueDate: action.dueDate }),
        },
      },
    );
    return { index: -1, ok: true, taskId: task.id, created: true };
  }
  if (action.type === "comment") {
    await api(key, "/api/activity/comment", {
      method: "POST",
      body: { taskId: action.taskId, comment: action.body },
    });
    return { index: -1, ok: true, taskId: action.taskId };
  }

  const before = await api<TaskSnapshot>(key, `/api/task/${action.taskId}`);
  const snapshot: Partial<TaskSnapshot> = {};
  const put = (path: string, body: unknown) =>
    api(key, `/api/task/${path}/${action.taskId}`, { method: "PUT", body });
  if (action.title !== undefined) {
    snapshot.title = before.title;
    await put("title", { title: action.title });
  }
  if (action.status !== undefined) {
    snapshot.status = before.status;
    await put("status", { status: action.status });
  }
  if (action.priority !== undefined) {
    snapshot.priority = before.priority;
    await put("priority", { priority: action.priority });
  }
  if (action.assigneeId !== undefined) {
    snapshot.userId = before.userId;
    await put("assignee", { userId: action.assigneeId ?? "" });
  }
  if (action.dueDate !== undefined) {
    snapshot.dueDate = before.dueDate;
    await put("due-date", { dueDate: action.dueDate ?? "" });
  }
  return { index: -1, ok: true, taskId: action.taskId, before: snapshot };
}

export async function applyChangeSet(
  workspaceId: string,
  userId: string,
  id: string,
  selected: number[],
) {
  const row = await findChangeSet(workspaceId, userId, id);
  if (row.status !== "proposed") {
    throw new HTTPException(409, { message: "Nothing to apply" });
  }
  const actions = (row.actions as AiAction[] | null) ?? [];
  const chosen = [...new Set(selected)].filter(
    (i) => Number.isInteger(i) && i >= 0 && i < actions.length,
  );

  // Applied as the person, through the normal API: every permission check
  // runs exactly as if they'd clicked it themselves.
  const results = await withTemporaryKey(userId, "tasks", async (key) => {
    const out: ActionResult[] = [];
    for (const index of chosen) {
      const action = actions[index] as AiAction;
      try {
        out.push({ ...(await applyOne(key, workspaceId, action)), index });
      } catch (error) {
        out.push({
          index,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return out;
  });

  const [updated] = await db
    .update(aiChangeSetTable)
    .set({ status: "applied", results, appliedAt: new Date() })
    .where(
      and(eq(aiChangeSetTable.id, id), eq(aiChangeSetTable.status, "proposed")),
    )
    .returning();
  return updated;
}

export async function undoChangeSet(
  workspaceId: string,
  userId: string,
  id: string,
) {
  const row = await findChangeSet(workspaceId, userId, id);
  if (row.status !== "applied") {
    throw new HTTPException(409, {
      message: "Only an applied change can be undone",
    });
  }
  const results = (row.results as ActionResult[] | null) ?? [];
  // Removing created tasks needs task:delete, so undo uses the person's
  // full reach; their role still decides.
  await withTemporaryKey(userId, "full", async (key) => {
    for (const result of [...results].reverse()) {
      if (!result.ok || !result.taskId) continue;
      try {
        if (result.created) {
          await api(key, `/api/task/${result.taskId}`, { method: "DELETE" });
          continue;
        }
        const before = result.before ?? {};
        const put = (path: string, body: unknown) =>
          api(key, `/api/task/${path}/${result.taskId}`, {
            method: "PUT",
            body,
          });
        if (before.title !== undefined)
          await put("title", { title: before.title });
        if (before.status !== undefined)
          await put("status", { status: before.status });
        if (before.priority !== undefined)
          await put("priority", { priority: before.priority ?? "no-priority" });
        if (before.userId !== undefined)
          await put("assignee", { userId: before.userId ?? "" });
        if (before.dueDate !== undefined)
          await put("due-date", { dueDate: before.dueDate ?? "" });
      } catch {
        // Best effort: a task deleted since can't be restored.
      }
    }
  });
  const [updated] = await db
    .update(aiChangeSetTable)
    .set({ status: "undone" })
    .where(eq(aiChangeSetTable.id, id))
    .returning();
  return updated;
}

export async function discardChangeSet(
  workspaceId: string,
  userId: string,
  id: string,
) {
  await findChangeSet(workspaceId, userId, id);
  const [updated] = await db
    .update(aiChangeSetTable)
    .set({ status: "discarded" })
    .where(
      and(eq(aiChangeSetTable.id, id), eq(aiChangeSetTable.status, "proposed")),
    )
    .returning();
  if (!updated) throw new HTTPException(409, { message: "Nothing to discard" });
  return updated;
}
