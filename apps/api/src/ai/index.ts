import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  applyChangeSet,
  discardChangeSet,
  getAiSettings,
  getChangeSet,
  listChangeSets,
  setAiSettings,
  startAsk,
  undoChangeSet,
} from "./change-sets";
import {
  createAgentKey,
  listAgentKeys,
  revokeAgentKey,
  revokeAllAgentKeys,
} from "./controllers";
import { AGENT_SCOPES } from "./scopes";
import {
  listTeammates,
  runTeammateNow,
  saveTeammate,
  TEAMMATE_KINDS,
} from "./teammates";

const tags = ["AI agents"];

// Only a signed-in person manages agent keys; a key can't mint more keys.
async function sessionOnly(c: Context, next: Next) {
  if (c.get("apiKey")) {
    throw new HTTPException(403, {
      message: "Agent keys are managed from a signed-in session",
    });
  }
  await next();
}

const publicApiUrl = (process.env.KANEO_API_URL || "http://localhost:1337")
  .replace(/\/api\/?$/, "")
  .replace(/\/+$/, "");

const agentKeySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    start: z.string().nullable(),
    scope: z.enum(AGENT_SCOPES),
    enabled: z.boolean(),
    lastUsedAt: nullableResponseTimestamp,
    createdAt: responseTimestamp,
  })
  .openapi("AgentKey");

const createdKeySchema = z
  .object({
    id: z.string(),
    key: z.string().openapi({ description: "Shown once; store it now." }),
    name: z.string(),
    scope: z.enum(AGENT_SCOPES),
  })
  .openapi("CreatedAgentKey");

const connectInfoRoute = createRoute({
  method: "get",
  operationId: "getAgentConnectInfo",
  path: "/connect",
  tags,
  summary: "Where Claude connects",
  description: "The MCP address to give Claude Code or Claude Desktop.",
  middleware: [sessionOnly] as const,
  responses: {
    200: jsonResponse(
      "Connection details",
      z.object({ mcpUrl: z.string() }).openapi("AgentConnectInfo"),
    ),
  },
});

const listKeysRoute = createRoute({
  method: "get",
  operationId: "listAgentKeys",
  path: "/agent-keys",
  tags,
  summary: "Your agent keys",
  description:
    "Keys you made for Claude, newest first. The key itself is never shown again.",
  middleware: [sessionOnly] as const,
  responses: {
    200: jsonResponse("Agent keys", z.array(agentKeySchema)),
  },
});

const createKeyRoute = createRoute({
  method: "post",
  operationId: "createAgentKey",
  path: "/agent-keys",
  tags,
  summary: "Make a key for Claude",
  description:
    "An API key limited to a scope (read, tasks, or everything your role allows except pay, audit, settings and people management). Works for the REST API and /api/mcp.",
  middleware: [sessionOnly] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().trim().max(60).optional(),
            scope: z.enum(AGENT_SCOPES),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("The new key", createdKeySchema),
  },
});

const revokeKeyRoute = createRoute({
  method: "delete",
  operationId: "revokeAgentKey",
  path: "/agent-keys/{id}",
  tags,
  summary: "Revoke an agent key",
  description: "The key stops working immediately.",
  middleware: [sessionOnly] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonResponse("Revoked", z.object({ id: z.string() })),
    404: errorResponse("Not one of your agent keys"),
  },
});

const revokeAllRoute = createRoute({
  method: "delete",
  operationId: "revokeAllAgentKeys",
  path: "/agent-keys",
  tags,
  summary: "Revoke every agent key",
  description: "The kill switch: all of your agent keys stop working at once.",
  middleware: [sessionOnly] as const,
  responses: {
    200: jsonResponse(
      "How many were revoked",
      z.object({ revoked: z.number() }),
    ),
  },
});

// ------------------------------------------------------- Ask TeamOS

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    engine: z.enum(["server", "desktop"]),
    serverAvailable: z.boolean().openapi({
      description: "Claude Code is installed where TeamOS runs.",
    }),
  })
  .openapi("AiSettings");

const changeSetSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    prompt: z.string(),
    summary: z.string().nullable(),
    status: z.enum([
      "proposing",
      "proposed",
      "applied",
      "discarded",
      "undone",
      "failed",
    ]),
    actions: z.array(z.record(z.string(), z.unknown())).nullable(),
    results: z.array(z.record(z.string(), z.unknown())).nullable(),
    error: z.string().nullable(),
    progress: z.array(z.string()).optional(),
    createdAt: responseTimestamp,
    appliedAt: nullableResponseTimestamp,
  })
  .openapi("AiChangeSet");

const wsQuery = z.object({ workspaceId: z.string() });
const idParam = z.object({ id: z.string() });
const json = <T>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const getSettingsRoute = createRoute({
  method: "get",
  operationId: "getAiSettings",
  path: "/settings",
  tags,
  summary: "Ask TeamOS settings",
  description: "Whether Claude is on for the workspace, and how it runs.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: wsQuery },
  responses: { 200: jsonResponse("Settings", settingsSchema) },
});

const setSettingsRoute = createRoute({
  method: "put",
  operationId: "setAiSettings",
  path: "/settings",
  tags,
  summary: "Turn Ask TeamOS on or off",
  description: "Needs workspace:manage_settings.",
  middleware: [
    sessionOnly,
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  ] as const,
  request: {
    body: json(
      z.object({
        workspaceId: z.string(),
        enabled: z.boolean(),
        engine: z.enum(["server", "desktop"]),
      }),
    ),
  },
  responses: {
    200: jsonResponse("Settings", settingsSchema),
    403: errorResponse("Missing workspace:manage_settings"),
  },
});

const askRoute = createRoute({
  method: "post",
  operationId: "askTeamOs",
  path: "/ask",
  tags,
  summary: "Ask Claude",
  description:
    "Starts Claude on a request. It reads as you and proposes changes; nothing is applied until you apply the change set. Poll the returned change set until it isn't `proposing`.",
  middleware: [sessionOnly, workspaceAccess.fromBody()] as const,
  request: {
    body: json(
      z.object({
        workspaceId: z.string(),
        prompt: z.string().trim().min(1).max(8000),
        context: z
          .object({
            projectId: z.string().optional(),
            taskId: z.string().optional(),
            page: z.string().max(200).optional(),
          })
          .optional(),
      }),
    ),
  },
  responses: {
    200: jsonResponse("The change set, still proposing", changeSetSchema),
    403: errorResponse("Ask TeamOS is off"),
    409: errorResponse("Claude isn't available here"),
  },
});

const listChangeSetsRoute = createRoute({
  method: "get",
  operationId: "listAiChangeSets",
  path: "/change-sets",
  tags,
  summary: "Your recent requests",
  middleware: [sessionOnly, workspaceAccess.fromQuery()] as const,
  request: { query: wsQuery },
  responses: { 200: jsonResponse("Newest first", z.array(changeSetSchema)) },
});

const getChangeSetRoute = createRoute({
  method: "get",
  operationId: "getAiChangeSet",
  path: "/change-sets/{id}",
  tags,
  summary: "One request, with live progress while Claude works",
  middleware: [sessionOnly, workspaceAccess.fromQuery()] as const,
  request: { params: idParam, query: wsQuery },
  responses: {
    200: jsonResponse("The change set", changeSetSchema),
    404: errorResponse("Not found"),
  },
});

const applyRoute = createRoute({
  method: "post",
  operationId: "applyAiChangeSet",
  path: "/change-sets/{id}/apply",
  tags,
  summary: "Apply the ticked changes",
  description:
    "Applies the chosen actions as you, through the normal API, recording what they replaced so the change can be undone.",
  middleware: [sessionOnly, workspaceAccess.fromBody()] as const,
  request: {
    params: idParam,
    body: json(
      z.object({
        workspaceId: z.string(),
        actions: z.array(z.number().int().min(0)).max(50),
      }),
    ),
  },
  responses: {
    200: jsonResponse("Applied", changeSetSchema),
    409: errorResponse("Not a proposal"),
  },
});

const undoRoute = createRoute({
  method: "post",
  operationId: "undoAiChangeSet",
  path: "/change-sets/{id}/undo",
  tags,
  summary: "Undo an applied change",
  description:
    "Puts back what each applied action replaced and removes tasks it created.",
  middleware: [sessionOnly, workspaceAccess.fromBody()] as const,
  request: {
    params: idParam,
    body: json(z.object({ workspaceId: z.string() })),
  },
  responses: {
    200: jsonResponse("Undone", changeSetSchema),
    409: errorResponse("Not applied"),
  },
});

const discardRoute = createRoute({
  method: "post",
  operationId: "discardAiChangeSet",
  path: "/change-sets/{id}/discard",
  tags,
  summary: "Discard a proposal",
  middleware: [sessionOnly, workspaceAccess.fromBody()] as const,
  request: {
    params: idParam,
    body: json(z.object({ workspaceId: z.string() })),
  },
  responses: {
    200: jsonResponse("Discarded", changeSetSchema),
    409: errorResponse("Not a proposal"),
  },
});

// --------------------------------------------------------- teammates

const teammateSchema = z
  .object({
    kind: z.enum(TEAMMATE_KINDS),
    enabled: z.boolean(),
    instructions: z.string().nullable(),
    time: z.string(),
    days: z.string(),
    mode: z.enum(["suggest", "act"]),
    channelId: z.string().nullable(),
    lastRunAt: nullableResponseTimestamp,
    lastChangeSetId: z.string().nullable(),
  })
  .openapi("AiTeammate");

const kindParam = z.object({ kind: z.enum(TEAMMATE_KINDS) });

const listTeammatesRoute = createRoute({
  method: "get",
  operationId: "listAiTeammates",
  path: "/teammates",
  tags,
  summary: "Your AI teammates",
  description:
    "Triage, standup, overdue and weekly: Claude on a schedule, working with your permissions.",
  middleware: [sessionOnly, workspaceAccess.fromQuery()] as const,
  request: { query: wsQuery },
  responses: { 200: jsonResponse("Teammates", z.array(teammateSchema)) },
});

const saveTeammateRoute = createRoute({
  method: "put",
  operationId: "saveAiTeammate",
  path: "/teammates/{kind}",
  tags,
  summary: "Set up a teammate",
  middleware: [sessionOnly, workspaceAccess.fromBody()] as const,
  request: {
    params: kindParam,
    body: json(
      z.object({
        workspaceId: z.string(),
        enabled: z.boolean(),
        instructions: z.string().max(2000).nullable().optional(),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
        days: z
          .string()
          .regex(/^[1-7](,[1-7])*$/, "ISO weekdays, e.g. 1,2,3,4,5"),
        mode: z.enum(["suggest", "act"]),
        channelId: z.string().nullable().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The teammate", teammateSchema) },
});

const runTeammateRoute = createRoute({
  method: "post",
  operationId: "runAiTeammate",
  path: "/teammates/{kind}/run",
  tags,
  summary: "Run a teammate now",
  description: "Starts it in the background; you're notified when it's done.",
  middleware: [sessionOnly, workspaceAccess.fromBody()] as const,
  request: {
    params: kindParam,
    body: json(z.object({ workspaceId: z.string() })),
  },
  responses: {
    200: jsonResponse("Started", z.object({ started: z.boolean() })),
    404: errorResponse("Not set up yet"),
  },
});

const ai = apiRouter()
  .openapi(connectInfoRoute, (c) =>
    c.json({ mcpUrl: `${publicApiUrl}/api/mcp` }, 200),
  )
  .openapi(listKeysRoute, async (c) =>
    c.json(await listAgentKeys(c.get("userId")), 200),
  )
  .openapi(createKeyRoute, async (c) =>
    c.json(await createAgentKey(c.get("userId"), c.req.valid("json")), 200),
  )
  .openapi(revokeAllRoute, async (c) =>
    c.json(await revokeAllAgentKeys(c.get("userId")), 200),
  )
  .openapi(getSettingsRoute, async (c) =>
    c.json(await getAiSettings(c.req.valid("query").workspaceId), 200),
  )
  .openapi(setSettingsRoute, async (c) => {
    const { workspaceId, ...input } = c.req.valid("json");
    return c.json(
      await setAiSettings(workspaceId, c.get("userId"), input),
      200,
    );
  })
  .openapi(askRoute, async (c) => {
    const { workspaceId, ...input } = c.req.valid("json");
    return c.json(
      present(await startAsk(workspaceId, c.get("userId"), input)),
      200,
    );
  })
  .openapi(listChangeSetsRoute, async (c) =>
    c.json(
      (
        await listChangeSets(c.req.valid("query").workspaceId, c.get("userId"))
      ).map(present),
      200,
    ),
  )
  .openapi(getChangeSetRoute, async (c) =>
    c.json(
      present(
        await getChangeSet(
          c.req.valid("query").workspaceId,
          c.get("userId"),
          c.req.valid("param").id,
        ),
      ),
      200,
    ),
  )
  .openapi(applyRoute, async (c) => {
    const { workspaceId, actions } = c.req.valid("json");
    return c.json(
      present(
        await applyChangeSet(
          workspaceId,
          c.get("userId"),
          c.req.valid("param").id,
          actions,
        ),
      ),
      200,
    );
  })
  .openapi(undoRoute, async (c) =>
    c.json(
      present(
        await undoChangeSet(
          c.req.valid("json").workspaceId,
          c.get("userId"),
          c.req.valid("param").id,
        ),
      ),
      200,
    ),
  )
  .openapi(discardRoute, async (c) =>
    c.json(
      present(
        await discardChangeSet(
          c.req.valid("json").workspaceId,
          c.get("userId"),
          c.req.valid("param").id,
        ),
      ),
      200,
    ),
  )
  .openapi(listTeammatesRoute, async (c) =>
    c.json(
      await listTeammates(c.req.valid("query").workspaceId, c.get("userId")),
      200,
    ),
  )
  .openapi(saveTeammateRoute, async (c) => {
    const { workspaceId, ...input } = c.req.valid("json");
    const saved = await saveTeammate(
      workspaceId,
      c.get("userId"),
      c.req.valid("param").kind,
      input,
    );
    if (!saved) throw new HTTPException(500, { message: "Failed to save" });
    return c.json(saved, 200);
  })
  .openapi(runTeammateRoute, async (c) =>
    c.json(
      await runTeammateNow(
        c.req.valid("json").workspaceId,
        c.get("userId"),
        c.req.valid("param").kind,
      ),
      200,
    ),
  )
  .openapi(revokeKeyRoute, async (c) =>
    c.json(await revokeAgentKey(c.get("userId"), c.req.valid("param").id), 200),
  );

type ChangeSetRow = {
  id: string;
  workspaceId: string;
  prompt: string;
  summary: string | null;
  status: string;
  actions: unknown;
  results: unknown;
  error: string | null;
  createdAt: Date;
  appliedAt: Date | null;
  progress?: string[];
};

type ChangeSetStatus =
  | "proposing"
  | "proposed"
  | "applied"
  | "discarded"
  | "undone"
  | "failed";

function present(row: ChangeSetRow | undefined) {
  if (!row) throw new HTTPException(409, { message: "Already changed" });
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    prompt: row.prompt,
    summary: row.summary,
    status: row.status as ChangeSetStatus,
    actions: (row.actions as Record<string, unknown>[] | null) ?? null,
    results: (row.results as Record<string, unknown>[] | null) ?? null,
    error: row.error,
    progress: row.progress,
    createdAt: row.createdAt,
    appliedAt: row.appliedAt,
  };
}

export default ai;
