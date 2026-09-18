# TeamOS: live activity and "Claude brain"

Two features, planned together because they share the desktop agent:

1. **Live activity.** While the TeamOS desktop app is running, the web shows what each person is working in right now, and their day so far.
2. **Claude brain.** A setting that lets Claude run the workspace: sort and create tasks where they belong, break work down, write reports and chase overdue items. It can run on a Claude API key on the server, or through the Claude Code already installed on someone's computer.

Everything below builds on what exists today:

- **Desktop agent:** the Tauri agent samples the foreground app every 5 s, and the domain when the company allows it. It uploads activity spans and heartbeats.
- **MCP server:** `/api/mcp` has about 40 tools (projects, tasks, comments, labels, relations, time entries, search) with OAuth and API-key auth.
- **Roles:** roles and audit log for Owner / Admin / Manager / Employee.

Nothing is thrown away.

---

## Part A: Live activity

### What people see

| Where | What |
|---|---|
| **People** list | A live dot per person (● active · ◐ idle · ○ away · offline), plus "VS Code · 12m" and the task they're timing. |
| **Live board** (new, `/people/live`) | One card per person: state, current app with its icon, time in it, running task timer, clocked-in time, today's worked hours. It updates in real time, groups by department, and can filter to "working now". |
| **Person → Activity** | A "Now" card, and today's **timeline strip**: a horizontal bar coloured by app from clock-in until now, with idle gaps shown. Hovering a slice shows app, domain and duration. Top apps and domains for today. |
| **Task page** | While someone times a task, their live app shows next to the timer ("Nusrat · Figma · 34m"). |
| **Sidebar work card** (yourself) | "Desktop app: tracking · Figma". You always see exactly what is being shared about you. |
| **Desktop agent window** | The same "Now" line and today's top apps, so the employee sees what their manager sees. |

### Privacy lines (unchanged, and written into the UI)

- The agent sends the app name, the website domain (only if the company turned domains on) and active/idle state. Never window titles, keystrokes, screenshots, clipboard or page paths.
- A company setting, **"Show live app to managers"**, is off by default. When it's off, others see only the state dot. Your own view always shows everything.
- Live data needs `activity:read_all`, the same permission as the Activity tab today.

### How it works

**Agent (Rust):**
- The heartbeat body gains `current: { app, domain?, since, state }`.
- The agent sends a heartbeat when the foreground app changes, and at least every 30 s. It debounces changes under 10 s, so alt-tab doesn't flood the server.

**API:**
- Three new columns on `agent_device`: `current_app`, `current_domain`, `current_since`.
- An in-memory "last seen" cache, so a heartbeat is one cheap update. It is written to the database at most every 60 s per device.
- Each change publishes `presence.changed` on the existing event bus. The user WebSocket delivers it only to viewers allowed to see it, and Redis fan-out works unchanged.
- `GET /people/live?workspaceId` returns everyone's current state in one query for the Live board.
- `GET /agent/activity/timeline?userId&day` returns today's spans merged into slices for the timeline strip, reusing `activity_span`.

**Web:**
- A `useLivePresence(workspaceId)` hook holds a map of userId to live state, fed by the WebSocket.
- Components: `<LiveDot>`, `<LiveAppChip>` and `<DayTimeline>`, reused on the People page, the Live board, the person page and tasks.

**Cost and performance:** about 1 small request per person per 30 s. For 100 people that's ~3 requests per second, which is nothing for Hono and Postgres.

---

## Part B: Claude brain

Four layers. Each one works on its own and ships in order.

### B1. Connect Claude, in one click (Settings → AI & agents)

A new settings page, visible to people with `workspace:manage`:

- **Connect Claude Code:** generates a **scoped agent key** and shows one copy-paste command:
  ```bash
  claude mcp add --transport http teamos https://<your-teamos>/api/mcp \
    --header "x-api-key: tos_agent_…"
  ```
  OAuth login works as well, and the page shows the `claude mcp add` form without a key for that.
- **Connect Claude Desktop:** the same thing as a JSON snippet.
- **Scopes** per key: *Read only* · *Tasks & projects* · *Everything I can do*. An agent key can never do more than the person who made it. Pay and salary tools are always off for agent keys unless an Owner turns them on.
- Every change an agent makes is audit logged and shows in task activity as **"Dev User via Claude"**, so people can tell human edits from agent edits.
- A **kill switch** revokes all agent keys at once.

### B2. Teach the MCP server the whole company

Today's tools cover projects and tasks. New tools, following the same patterns:

- **People and work:**
  - `list_people` (roles, departments, workload: open tasks and hours this week);
  - `get_person_workload`;
  - `attendance_summary` (who is in, late or on leave).
- **Time and reports:**
  - `timesheet` (by person, project or range);
  - `project_health` (the same numbers as the Projects page);
  - `workspace_overview` (the six numbers from My work).
- **Checklists:** `add_checklist`, `add_checklist_items` and `complete_checklist_item`.
- **Expenses:** `list_expenses`, `submit_expense`, and `decide_expense` (only with `request:approve`).
- **Chat:** `post_chat_message` to a channel, for standups and reports.
- **Bulk editing:** `bulk_update_tasks` (move, assign, label or prioritise many tasks at once), with `dry_run: true` returning the planned diff instead of applying it.

**MCP prompts** that become ready-made workflows in Claude Code and Claude Desktop:

| Prompt | What it does |
|---|---|
| `/triage` | Sort new and unassigned tasks: label, prioritise, assign by workload, flag duplicates. |
| `/plan-my-day` | My overdue and due-today tasks, the timer order, and what to push. |
| `/break-down <task>` | Turn a task into a checklist, or into sub-tasks with estimates. |
| `/notes-to-tasks` | Paste meeting notes or a transcript, and get tasks in the right projects with owners and dates. |
| `/weekly-report` | Done, slipped and time per project, with a short summary posted to chat or email. |
| `/rebalance` | Spot overloaded people and suggest reassignments. |

### B3. "Ask TeamOS": Claude inside the app

- **⌘J anywhere** opens an assistant panel. It knows where you are, so on a project board "organize this" means that board.
- **Plan → Review → Apply.** Claude never silently edits:
  1. It answers with a **change set** of cards: "Create 6 tasks in Marketing Launch", "Move MKT-5 to In Review", "Assign 3 tasks to Nusrat (lightest load)", each with before and after.
  2. You tick or untick cards and press **Apply**. Every applied change set gets an **Undo**.
  3. A per-workspace switch allows "auto-apply small changes" (≤ 5 actions, nothing destructive) for people who trust it.
- **Shortcuts in context:**
  - Board: **Organize** (group, dedupe, fix statuses) and **Fill gaps** (missing owners, dates, priorities).
  - Task: **Break into checklist**, **Estimate**, **Write description**.
  - My work: **Plan my day**.
  - Reports and Projects: **Explain this week** and **What's at risk?**
  - Chat message: **Turn into task**.
  - Expenses: **Categorise** and **Flag anything unusual**.
- **Two engines**, chosen in Settings → AI:
  - **Claude API (server).** An Anthropic key is stored encrypted, the same way as the R2 secret. The API runs the tool loop in-process with the same MCP tools, acting as the signed-in user. It works for everyone, and nothing needs installing. Default model: `claude-sonnet-5`, with `claude-opus-5` for big reorganisations.
  - **My Claude Code (local bridge).** This uses the Claude Code already installed on your computer and your own Claude plan, with no API key on the server (see B3a).

### B3a. The local Claude Code bridge (through the TeamOS desktop app)

This is what makes "Claude Code is installed, so send the requests live through that app" real:

```
Web "Ask TeamOS"  ──►  API queues an agent_job for your paired device
                          │  (one per request, signed, expires in 2 min)
Desktop agent  ◄──────────┘  job arrives on the next heartbeat (≤ 30 s,
      │                      or instantly over a long-poll)
      │  asks you once: "TeamOS wants to run Claude on: 'organize Marketing
      │  Launch'. Allow?"  [Allow once] [Always for me] [Deny]
      ▼
claude -p "<prompt + page context>" \
  --output-format stream-json --verbose \
  --mcp-config <temp file: TeamOS MCP + a short-lived key scoped to you> \
  --allowedTools "mcp__teamos__*"          # nothing else: no shell, no files
      │
      └─► streams events back to the API ─► the web shows Claude working live,
          then the change set to review
```

**Safety built in:**
- Claude runs with **only** the TeamOS tools, so it can't touch files or a shell.
- Its key lives 10 minutes and is scoped to your permissions.
- The job text comes from your own signed-in session.
- The desktop asks before the first run.
- The job and each tool call are audit logged.

**If the desktop app isn't running**, the panel offers the server engine instead, or shows "Open the TeamOS app to use your Claude Code".

### B4. AI teammates (scheduled agents)

Agents that work on their own, set up in Settings → AI → Teammates:

| Teammate | Default schedule | Job |
|---|---|---|
| **Triage** | 9:00 every workday | Label, prioritise and assign new tasks; merge duplicates (as suggestions). |
| **Standup** | 10:30 every workday | Post "yesterday / today / blocked" per person to #standup, from time entries and status changes. |
| **Overdue nudger** | 16:00 | A friendly reminder to owners of tasks due today or overdue, with a one-click new date. |
| **Weekly report** | Friday 17:00 | Summary email and chat post for the owner, per project and per person. |
| **Expense checker** | On each submission | Pre-fill the category, spot duplicates, flag missing receipts. |

Each teammate has:
- editable **instructions**, in plain language, in Bangla or English;
- a **schedule**, and the **role it acts as**;
- a **mode**: *suggest* (drafts a change set for a human) or *act* (applies, with undo);
- a **budget**: maximum actions and tokens per run.

A **run log** shows every run: what it read, what it changed, the cost, and an **Undo run** button.

### Guardrails, one place

- **Task text is untrusted.** Tool results are fenced as data, and agents can't exceed their key. Destructive actions (delete, bulk move over 20 tasks, anything touching pay) always need a human to approve.
- **AI is off per workspace until an Owner turns it on.** The settings page says exactly what is sent to Anthropic.
- **Employee activity data** (Part A) is excluded from AI tools unless the Owner explicitly allows it.
- **Rate limits:** per agent key and per workspace.
- **Monthly cap:** a spending cap for the server engine.

---

## Data model additions

| Table / column | Why |
|---|---|
| `agent_device.current_app`, `current_domain`, `current_since` | Live "now" per device |
| `workspace_ai_setting` (engine, encrypted API key, model, auto-apply, monthly cap, activity-in-AI flag) | B1 and B3 settings |
| `agent_key` (or Better Auth API keys with `metadata.kind = "agent"`, a scope list and `created_by`) | Scoped agent keys, B1 |
| `ai_change_set` (who, source, status, actions JSON with before/after) | Review, apply and undo, B3 |
| `ai_agent` (teammate: name, instructions, schedule, role, mode, budget) | B4 |
| `ai_run` (agent or user, engine, tokens, cost, status, change_set_id) | Run log, B4 |
| `agent_job` (device, prompt, context, key id, status, stream cursor) | Local Claude Code bridge, B3a |

All of these are additive migrations, so existing installs upgrade in place.

---

## Build order

Each phase ships on its own and is useful by itself.

| # | Phase | Size | You get |
|---|---|---|---|
| 1 | **Live now:** heartbeat `current`, presence events, People live column, person "Now" card | 1–2 days | See who is working in what, right now |
| 2 | **Day timeline and Live board** | 1–2 days | The whole team's day at a glance |
| 3 | **AI settings and one-click Claude Code / Desktop connect**, scoped agent keys, "via Claude" audit | 1 day | Claude Code manages TeamOS today, from your terminal |
| 4 | **MCP for the company layer and prompts** (`/triage`, `/notes-to-tasks`, `/weekly-report`, …) | 2–3 days | Claude understands people, time, reports and expenses |
| 5 | **Ask TeamOS panel** (server engine), change sets, apply and undo, context shortcuts | 3–4 days | Claude inside the app, safely |
| 6 | **Local Claude Code bridge** through the desktop agent | 2–3 days | Your own Claude plan does the work, live |
| 7 | **AI teammates:** schedules, run log, undo run | 3 days | Triage, standups and reports that run themselves |

## Status (built)

| # | Phase | Status |
|---|---|---|
| 1 | Live now | Done. The agent sends the app in front with every heartbeat (a switch is reported after 10 s). `agent_device.current_*` (migration 0074), `PRESENCE_CHANGED` over the user WebSocket, `GET /people/live`. |
| 2 | Day timeline + Live board | Done. People → Live tab; person → Activity shows a Now card and today's strip. |
| 3 | Connect Claude | Done. Settings → Account → AI & agents: scoped agent keys (read / tasks / full), a one-command `claude mcp add`, and a kill switch. `/api/mcp` accepts API keys; read-only keys can't make any non-GET request. |
| 4 | MCP for the company layer | Done. 9 more tools (people, workload, live, today, attendance, timesheet, project health, reports, expenses, bulk with dry run, checklists, chat) and 5 prompts (triage, plan_my_day, notes_to_tasks, weekly_report, rebalance). |
| 5 | Ask TeamOS (server engine) | Done. Ctrl/⌘+J. Claude reads with a temporary read-only key and proposes a change set; TeamOS applies the ticked actions in-process as the person; undo restores what they replaced. `ai_change_set` + `workspace_ai_setting` (0077). |
| 6 | Local Claude Code bridge | Done. Engine "each person's own Claude Code": the desktop app long-polls `/agent/device/ai-jobs/next`, runs `claude -p` with only the TeamOS tools once the person turned on "Run Claude for TeamOS", and hands back progress and the answer (0078). |
| 7 | AI teammates | Done. Triage, standup, overdue nudger and weekly report, each with time, weekdays, suggest/act, channel and extra instructions; run by the scheduler every minute in the company timezone; the owner is notified (0079). |

Decisions taken: only the app in front (no list of open apps); live apps visible to people with `activity:read_all` (owner and admin by default, and roles can grant managers); Claude always proposes and people apply (teammates in "act" mode apply with undo).

## Decisions needed before starting (original)

1. **Live apps:** only the app in front, which I recommend and which the agent already samples, or also a list of other open apps? A list of open apps is more invasive and needs a new OS permission on macOS.
2. **Who sees others' live apps:** Owner and Admin only, or managers too?
3. **First engine for Ask TeamOS:** the server with a Claude API key (works for everyone) or your local Claude Code first?
4. **Auto-apply:** always review, or allow small changes to apply straight away?
