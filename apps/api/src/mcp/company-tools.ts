import { z } from "zod";
import {
  ApiClient,
  errorResult,
  type McpToolRegistrar,
  type McpToolResult,
  run,
} from "./tools";

// The company layer for Claude: people and who's in, time, reports,
// expenses, checklists, chat, and bulk task edits with a dry run. Every tool
// calls the REST API as the key's owner, so roles and key scopes apply.

const id = z.string().trim().min(1);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("A calendar day, YYYY-MM-DD");
const iso = z.string().datetime({ offset: true });

function query(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, value);
  }
  return qs.toString();
}

export function registerCompanyTools(
  server: McpToolRegistrar,
  baseUrl: string,
  token: string,
): void {
  const client = new ApiClient(baseUrl, token);
  const tool = <S extends z.ZodObject>(
    name: string,
    config: { description: string; inputSchema: S },
    callback: (args: z.output<S>) => Promise<McpToolResult>,
  ) =>
    server.registerTool(name, config, async (args) => {
      const parsed = config.inputSchema.safeParse(args);
      if (!parsed.success) return errorResult(z.prettifyError(parsed.error));
      return callback(parsed.data);
    });
  const get = (path: string) => run(() => client.json(path));
  const send = (path: string, method: string, body: unknown) =>
    run(() => client.json(path, { method, body: JSON.stringify(body) }));

  // ------------------------------------------------------------- people

  tool(
    "list_people",
    {
      description:
        "Everyone in the workspace: name, title, department, status, and whether they're clocked in or online now. Use it to find user ids for assigning.",
      inputSchema: z.object({ workspaceId: id }),
    },
    (a) => get(`/api/people?${query({ workspaceId: a.workspaceId })}`),
  );

  tool(
    "people_workload",
    {
      description:
        "Per person: open tasks, overdue tasks, hours this week, leave. Use it to spread work fairly before assigning or rebalancing.",
      inputSchema: z.object({ workspaceId: id }),
    },
    (a) => get(`/api/people/overview?${query({ workspaceId: a.workspaceId })}`),
  );

  tool(
    "live_people",
    {
      description:
        "Who is working right now: active, idle, paused or offline from the desktop app, the running task timer, and (if allowed) the app in front.",
      inputSchema: z.object({ workspaceId: id }),
    },
    (a) => get(`/api/people/live?${query({ workspaceId: a.workspaceId })}`),
  );

  tool(
    "person_tasks",
    {
      description:
        "One person's tasks across all projects, in their own order, with status, due date, estimate and time tracked.",
      inputSchema: z.object({ workspaceId: id, userId: id }),
    },
    (a) =>
      get(
        `/api/people/${encodeURIComponent(a.userId)}/tasks?${query({ workspaceId: a.workspaceId })}`,
      ),
  );

  // ------------------------------------------------------- today & time

  tool(
    "company_today",
    {
      description:
        "The six numbers an owner checks first: present now, due today, overdue, worked today, pending leave, open payrolls.",
      inputSchema: z.object({ workspaceId: id }),
    },
    (a) =>
      get(`/api/overview/company?${query({ workspaceId: a.workspaceId })}`),
  );

  tool(
    "attendance_day",
    {
      description:
        "Everyone's attendance for one day: first in, last out, worked and overtime, on leave.",
      inputSchema: z.object({ workspaceId: id, day }),
    },
    (a) => get(`/api/attendance/team?${query(a)}`),
  );

  tool(
    "timesheet",
    {
      description:
        "Time entries in a range (ISO timestamps, `to` exclusive), optionally for one person or project. Other people's entries need timeEntry:read_all.",
      inputSchema: z.object({
        workspaceId: id,
        from: iso,
        to: iso,
        userId: id.optional(),
        projectId: id.optional(),
      }),
    },
    (a) => get(`/api/time-entry?${query(a)}`),
  );

  tool(
    "project_health",
    {
      description:
        "Every project with open, done and overdue task counts, due this week, next due date, estimate, time tracked in the last 30 days, team and last activity.",
      inputSchema: z.object({ workspaceId: id }),
    },
    (a) => get(`/api/project?${query({ workspaceId: a.workspaceId })}`),
  );

  tool(
    "report_summary",
    {
      description:
        "Work done in a date range: tasks completed and created, time per project and person. Without report:read it covers only you.",
      inputSchema: z.object({
        workspaceId: id,
        from: day,
        to: day,
        projectId: id.optional(),
        userId: id.optional(),
      }),
    },
    (a) => get(`/api/reports/summary?${query(a)}`),
  );

  // ----------------------------------------------------------- expenses

  tool(
    "list_expenses",
    {
      description:
        "Expenses in the workspace (approvers see everyone's), filtered by status, person or spend date.",
      inputSchema: z.object({
        workspaceId: id,
        status: z.enum(["pending", "approved", "rejected", "paid"]).optional(),
        userId: id.optional(),
        from: day.optional(),
        to: day.optional(),
      }),
    },
    (a) => get(`/api/requests/expenses/all?${query(a)}`),
  );

  tool(
    "submit_expense",
    {
      description:
        "File an expense for yourself. `amount` is in minor units (e.g. 150000 = 1,500.00).",
      inputSchema: z.object({
        workspaceId: id,
        amount: z.number().int().min(1),
        category: z.string().trim().min(1).max(60),
        spentOn: day,
        description: z.string().max(500).optional(),
        projectId: id.optional(),
      }),
    },
    (a) => send("/api/requests/expenses", "POST", a),
  );

  // ----------------------------------------------------- tasks, in bulk

  tool(
    "bulk_update_tasks",
    {
      description:
        "Change many tasks at once: status, priority, assignee, due date, add or remove a label. Always call with dryRun: true first and show the person the plan; deleting is not available here.",
      inputSchema: z.object({
        taskIds: z.array(id).min(1).max(200),
        operation: z.enum([
          "updateStatus",
          "updatePriority",
          "updateAssignee",
          "addLabel",
          "removeLabel",
          "updateDueDate",
        ]),
        value: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Status slug, priority, user id, label id or ISO date; null clears an assignee or due date",
          ),
        dryRun: z.boolean().default(true),
      }),
    },
    async (a) => {
      if (a.dryRun) {
        const tasks = await Promise.all(
          a.taskIds.map((taskId) =>
            client
              .json<{
                id: string;
                title: string;
                status: string;
                priority: string;
                userId: string | null;
                dueDate: string | null;
              }>(`/api/task/${encodeURIComponent(taskId)}`)
              .catch(() => ({ id: taskId, error: "not found or no access" })),
          ),
        );
        return run(async () => ({
          dryRun: true,
          operation: a.operation,
          value: a.value ?? null,
          tasks,
          next: "Call again with dryRun: false to apply.",
        }));
      }
      return send("/api/task/bulk", "PATCH", {
        taskIds: a.taskIds,
        operation: a.operation,
        value: a.value ?? null,
      });
    },
  );

  tool(
    "add_checklist",
    {
      description:
        "Add a named checklist to a task. Sub-tasks created with create_task_relation (type subtask) can then be grouped under it.",
      inputSchema: z.object({
        taskId: id,
        title: z.string().trim().min(1).max(120).optional(),
      }),
    },
    (a) => send("/api/checklist", "POST", a),
  );

  // --------------------------------------------------------------- chat

  tool(
    "list_chat_conversations",
    {
      description:
        "Your channels and direct messages, with unread counts. Use it to find a channel id to post to.",
      inputSchema: z.object({ workspaceId: id }),
    },
    (a) => get(`/api/chat?${query({ workspaceId: a.workspaceId })}`),
  );

  tool(
    "post_chat_message",
    {
      description:
        "Post a message to a channel or DM you're in, e.g. a standup summary or report. Keep it short; Markdown links work.",
      inputSchema: z.object({
        workspaceId: id,
        conversationId: id,
        body: z.string().trim().min(1).max(4000),
      }),
    },
    (a) =>
      send(
        `/api/chat/${encodeURIComponent(a.conversationId)}/messages`,
        "POST",
        { workspaceId: a.workspaceId, body: a.body },
      ),
  );
}

// ------------------------------------------------------------- prompts

type PromptResult = {
  messages: Array<{
    role: "user";
    content: { type: "text"; text: string };
  }>;
};

type PromptServer = {
  registerPrompt(
    name: string,
    config: {
      title?: string;
      description?: string;
      argsSchema?: z.ZodRawShape;
    },
    callback: (args: Record<string, string>) => PromptResult,
  ): unknown;
};

const ask = (text: string): PromptResult => ({
  messages: [{ role: "user", content: { type: "text", text } }],
});

const HOUSE_RULES = `Work in TeamOS through the teamos tools only.
- Start with list_workspaces if you don't know the workspace id.
- Before changing anything, show me the plan as a short list and wait for "ok" unless I said to go ahead.
- For many changes use bulk_update_tasks with dryRun first.
- Never delete tasks. Keep answers short.`;

/**
 * Ready-made workflows. In Claude Code they show up as /mcp__teamos__<name>.
 */
export function registerMcpPrompts(server: PromptServer): void {
  const workspace = { workspace: z.string().optional() };

  server.registerPrompt(
    "triage",
    {
      title: "Triage",
      description:
        "Sort unassigned and unprioritised tasks: priorities, owners by workload, duplicates.",
      argsSchema: { ...workspace, project: z.string().optional() },
    },
    ({ workspace: w, project }) =>
      ask(`${HOUSE_RULES}

Triage ${project ? `the project "${project}"` : "all projects"}${w ? ` in workspace "${w}"` : ""}:
1. Find open tasks with no assignee, no priority or no due date.
2. Use people_workload to see who has room.
3. Propose: a priority for each, an owner (lightest fitting load), a due date where obvious, and any likely duplicates.
4. After I confirm, apply with bulk_update_tasks.`),
  );

  server.registerPrompt(
    "plan_my_day",
    {
      title: "Plan my day",
      description: "Order my overdue and due-today work, and say what to push.",
      argsSchema: workspace,
    },
    () =>
      ask(`${HOUSE_RULES}

Plan my day: use whoami, then person_tasks for me. List what's overdue and due today, suggest an order (with estimates), and name up to three things to push to later. Don't change anything unless I ask.`),
  );

  server.registerPrompt(
    "notes_to_tasks",
    {
      title: "Notes → tasks",
      description:
        "Turn meeting notes or a transcript into tasks in the right projects, with owners and dates.",
      argsSchema: { notes: z.string() },
    },
    ({ notes }) =>
      ask(`${HOUSE_RULES}

Turn these notes into tasks. Match each to the best project (list_projects), pick owners from list_people by name mentioned, set due dates when a date or "by Friday" is mentioned. Show the table first; create after I confirm.

Notes:
${notes}`),
  );

  server.registerPrompt(
    "weekly_report",
    {
      title: "Weekly report",
      description:
        "What got done, what slipped and time per project this week; optionally post it to a channel.",
      argsSchema: { ...workspace, channel: z.string().optional() },
    },
    ({ channel }) =>
      ask(`${HOUSE_RULES}

Write this week's report (Monday to today): use report_summary, project_health and people_workload. Sections: Done, Slipped (overdue), Time per project, Risks for next week. Under 200 words.${channel ? ` Then post it to the "${channel}" channel with post_chat_message.` : ""}`),
  );

  server.registerPrompt(
    "rebalance",
    {
      title: "Rebalance work",
      description: "Spot overloaded people and suggest reassignments.",
      argsSchema: workspace,
    },
    () =>
      ask(`${HOUSE_RULES}

Use people_workload and project_health. Find anyone with clearly more open or overdue work than the rest, and propose specific reassignments (task → person) that even things out. Apply with bulk_update_tasks after I confirm.`),
  );
}
