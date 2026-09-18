import type { ActivityEmailProps, EmailBrand } from "@kaneo/email";

// One place that decides what each notification email says and where its
// buttons go. Every email uses the same mother layout (packages/email).

export type EmailContext = {
  workspaceId: string;
  workspaceName: string;
  workspaceLogo: string | null;
  projectName: string | null;
  taskTitle: string | null;
  /** Where the main button goes: the task, the leave page, … */
  actionUrl: string | null;
};

export type NotificationEmail = {
  subject: string;
  category: string;
  props: ActivityEmailProps;
};

export const clientUrl = () =>
  (process.env.KANEO_CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "");

type Data = Record<string, unknown> | null;

const str = (data: Data, key: string) => {
  const value = data?.[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const num = (data: Data, key: string) => {
  const value = data?.[key];
  return typeof value === "number" ? value : null;
};

/** Rich-text comments arrive as HTML or markdown; emails show plain words. */
function plain(text: string | null, max = 280) {
  if (!text) return null;
  const clean = text
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_`>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function leadTime(minutes: number | null) {
  if (!minutes) return "soon";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `in ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `in ${minutes} minutes`;
}

function formatDay(day: string | null) {
  if (!day) return null;
  const date = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function dateRange(start: string | null, end: string | null) {
  const from = formatDay(start);
  const to = formatDay(end);
  if (!from) return null;
  return !to || to === from ? from : `${from} – ${to}`;
}

const LEAVE_TYPES: Record<string, string> = {
  annual: "Annual leave",
  sick: "Sick leave",
  unpaid: "Unpaid leave",
};

function money(minor: number | null, currency: string | null) {
  if (minor === null) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency ?? ""}`.trim();
  }
}

const monthName = (year: number | null, month: number | null) =>
  year && month
    ? new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(year, month - 1, 15)))
    : null;

type Brief = { title: string; ref: string | null; daysLate?: number };

/** A list of tasks from event data, as "REF Title" lines. */
const briefs = (data: Data, key: string): Brief[] => {
  const value = data?.[key];
  return Array.isArray(value)
    ? value.filter(
        (item): item is Brief =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Brief).title === "string",
      )
    : [];
};

const line = (task: Brief) =>
  task.ref ? `${task.ref} · ${task.title}` : task.title;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const humanStatus = (status: string | null) =>
  status
    ? status.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase())
    : null;

export function brandFor(context: EmailContext): EmailBrand {
  return {
    name: context.workspaceName,
    // Only a hosted https image; data URLs are blocked by most mail clients.
    logoUrl: context.workspaceLogo?.startsWith("https://")
      ? context.workspaceLogo
      : null,
  };
}

export function buildNotificationEmail(input: {
  type: string;
  eventData: Data;
  context: EmailContext;
  recipientName: string | null;
  fallback: { title: string; body: string };
}): NotificationEmail {
  const { type, eventData: data, context, fallback } = input;
  const workspace = context.workspaceName;
  const task = context.taskTitle ?? str(data, "taskTitle") ?? "a task";
  const project = context.projectName;
  const open = context.actionUrl;
  const base = {
    brand: brandFor(context),
    manageUrl: `${clientUrl()}/dashboard/settings/account/notifications`,
  };
  const taskCard = {
    title: task,
    subtitle: project ? `${project} · ${workspace}` : workspace,
  };
  const openTask = open ? { label: "Open task", url: open } : null;
  const taskReason = `You get this because you work on tasks in ${workspace}.`;

  switch (type) {
    case "task_assignee_changed":
    case "task_created": {
      const heading =
        type === "task_created"
          ? `New task for you: ${task}`
          : `You've been assigned: ${task}`;
      return {
        subject: heading,
        category: "task_assigned",
        props: {
          ...base,
          preview: `${task} is now on your plate${project ? ` in ${project}` : ""}.`,
          eyebrow: "Task assigned",
          heading,
          intro: "It's yours now. Open it to see the details and get started.",
          card: {
            ...taskCard,
            status: { label: "Assigned to you", tone: "info" },
          },
          primary: openTask,
          reason: taskReason,
        },
      };
    }
    case "project_task_created": {
      const who = str(data, "actorName") ?? "Someone";
      const where = project ?? str(data, "projectName");
      const heading = `${who} added ${task}`;
      return {
        subject: where ? `New in ${where}: ${task}` : `New task: ${task}`,
        category: "project_activity",
        props: {
          ...base,
          preview: `${who} added a task${where ? ` to ${where}` : ""}.`,
          eyebrow: "New task",
          heading,
          intro:
            "A new task in a project you're on. Open it to see who has it and when it's due.",
          card: { ...taskCard, status: { label: "New", tone: "info" } },
          primary: openTask,
          reason: "You get this because you're on this project's team.",
        },
      };
    }
    case "task_deleted":
    case "project_task_deleted": {
      const who = str(data, "actorName") ?? "Someone";
      const where = project ?? str(data, "projectName");
      const yours = type === "task_deleted";
      const heading = yours
        ? `${who} deleted your task ${task}`
        : `${who} deleted ${task}`;
      return {
        subject: heading,
        category: yours ? "task_deleted" : "project_activity",
        props: {
          ...base,
          preview: `${task} was deleted${where ? ` from ${where}` : ""}.`,
          eyebrow: "Task deleted",
          heading,
          intro: yours
            ? "It's off your list. If it was deleted by mistake, ask them or a workspace admin about it."
            : "It's no longer on the project's board.",
          card: {
            title: task,
            subtitle: where ? `${where} · ${workspace}` : workspace,
            status: { label: "Deleted", tone: "danger" },
          },
          primary: open ? { label: "Open project", url: open } : null,
          reason: yours
            ? "You get this because the task was assigned to you."
            : "You get this because you're on this project's team.",
        },
      };
    }
    case "task_status_changed": {
      const from = humanStatus(str(data, "oldStatus"));
      const to = humanStatus(str(data, "newStatus"));
      return {
        subject: to ? `${task} moved to ${to}` : `${task} changed status`,
        category: "task_status",
        props: {
          ...base,
          preview: to ? `${task} is now ${to}.` : `${task} changed status.`,
          eyebrow: "Status changed",
          heading: to ? `${task} is now ${to}` : `${task} changed status`,
          card: {
            ...taskCard,
            status: to ? { label: to, tone: "success" } : null,
            details:
              from && to ? [{ label: "Moved", value: `${from} → ${to}` }] : [],
          },
          primary: openTask,
          reason: "You get this because the task is assigned to you.",
        },
      };
    }
    case "task_comment":
    case "task_mention": {
      const mention = type === "task_mention";
      const who =
        str(data, mention ? "mentionerName" : "commenterName") ?? "Someone";
      const heading = mention
        ? `${who} mentioned you in ${task}`
        : `${who} commented on ${task}`;
      const words = plain(str(data, "commentPreview"));
      return {
        subject: heading,
        category: mention ? "task_mention" : "task_comment",
        props: {
          ...base,
          preview: words ?? heading,
          eyebrow: mention ? "Mention" : "New comment",
          heading,
          card: taskCard,
          quote: words ? { author: who, text: words } : null,
          primary: open
            ? { label: mention ? "Reply" : "View comment", url: open }
            : null,
          reason: mention
            ? "You get this because someone mentioned you."
            : "You get this because the task is assigned to you.",
        },
      };
    }
    case "due_date_reminder": {
      const when = leadTime(num(data, "leadTimeMinutes"));
      const due = formatDay(str(data, "dueDate"));
      return {
        subject: `Due ${when}: ${task}`,
        category: "task_due",
        props: {
          ...base,
          preview: `${task} is due ${when}. Plan the time for it now.`,
          eyebrow: "Coming up",
          heading: `${task} is due ${when}`,
          intro:
            "A heads-up while there's still time to plan. If it won't make it, move the date now rather than later.",
          card: {
            ...taskCard,
            status: { label: `Due ${when}`, tone: "info" },
            details: due ? [{ label: "Due", value: due }] : [],
          },
          primary: openTask,
          reason: "You get this because the task is assigned to you.",
        },
      };
    }
    case "task_due_today": {
      const due = formatDay(str(data, "dueDate"));
      return {
        subject: `Due today: ${task}`,
        category: "task_due_today",
        props: {
          ...base,
          preview: `${task} is due today.`,
          eyebrow: "Due today",
          heading: `${task} is due today`,
          intro:
            "Make it one of today's first things. Mark it done when you finish, so nobody has to chase it.",
          card: {
            ...taskCard,
            status: { label: "Due today", tone: "warning" },
            details: due ? [{ label: "Due", value: due }] : [],
          },
          primary: openTask,
          reason: "You get this because the task is assigned to you.",
        },
      };
    }
    case "task_due_soon": {
      return {
        subject: `Last call: ${task} is due by end of day`,
        category: "task_last_call",
        props: {
          ...base,
          preview: `About two hours left today for ${task}.`,
          eyebrow: "Last call",
          heading: `${task} is due by end of day`,
          intro:
            "About two hours of the workday are left. Finish it, or move the due date before it turns overdue.",
          card: {
            ...taskCard,
            status: { label: "Due in ~2 hours", tone: "warning" },
          },
          callout: {
            tone: "warning",
            text: "Moving the date is fine. An honest plan beats a surprise tomorrow.",
          },
          primary: openTask,
          reason: "You get this because the task is assigned to you.",
        },
      };
    }
    case "task_overdue": {
      const late = num(data, "daysOverdue") ?? 1;
      const due = formatDay(str(data, "dueDate"));
      const lateText = `${late} ${late === 1 ? "day" : "days"}`;
      const escalated = str(data, "stage") === "escalate";
      return {
        subject: `Overdue by ${lateText}: ${task}`,
        category: "task_overdue",
        props: {
          ...base,
          preview: `${task} was due ${due ?? "earlier"} and is still open.`,
          eyebrow: "Overdue",
          heading: `${task} is ${lateText} overdue`,
          intro: escalated
            ? "It's been a few workdays, so your manager has been told as well. Finish it, move the date, or leave a comment on what's blocking it."
            : "It's still open. Finish it, move the date, or leave a comment on what's blocking it.",
          card: {
            ...taskCard,
            status: { label: `${lateText} late`, tone: "danger" },
            details: due ? [{ label: "Was due", value: due }] : [],
          },
          primary: openTask,
          reason: "You get this because the task is assigned to you.",
        },
      };
    }
    case "daily_digest": {
      const dueToday = briefs(data, "dueToday");
      const overdue = briefs(data, "overdue");
      const fresh = briefs(data, "fresh");
      const dueCount = num(data, "dueTodayCount") ?? dueToday.length;
      const lateCount = num(data, "overdueCount") ?? overdue.length;
      const newCount = num(data, "newCount") ?? fresh.length;
      const parts = [
        dueCount ? `${dueCount} due today` : null,
        lateCount ? `${lateCount} overdue` : null,
        newCount ? `${newCount} new` : null,
      ].filter(Boolean);
      const summary = parts.join(", ") || "a clear board";
      const more = (shown: number, total: number) =>
        total > shown ? [`…and ${total - shown} more`] : [];
      return {
        subject: `Your day in ${workspace}: ${summary}`,
        category: "daily_digest",
        props: {
          ...base,
          preview: `Today: ${summary}.`,
          eyebrow: "Your day",
          heading: `Good morning. Today: ${summary}`,
          intro:
            "Start with anything overdue, then what's due today. Move a date if a plan changed, so your team isn't surprised.",
          card: {
            title: workspace,
            details: [
              { label: "Due today", value: String(dueCount) },
              { label: "Overdue", value: String(lateCount) },
              { label: "New for you", value: String(newCount) },
              {
                label: "Open in total",
                value: String(num(data, "openCount") ?? 0),
              },
            ],
          },
          body: [
            ...(overdue.length
              ? [
                  "Overdue",
                  ...overdue.map(
                    (t) =>
                      `• ${line(t)}${t.daysLate ? ` (${plural(t.daysLate, "workday")} late)` : ""}`,
                  ),
                  ...more(overdue.length, lateCount),
                ]
              : []),
            ...(dueToday.length
              ? [
                  "Due today",
                  ...dueToday.map((t) => `• ${line(t)}`),
                  ...more(dueToday.length, dueCount),
                ]
              : []),
            ...(fresh.length
              ? [
                  "New for you",
                  ...fresh.map((t) => `• ${line(t)}`),
                  ...more(fresh.length, newCount),
                ]
              : []),
          ],
          primary: open ? { label: "Open My work", url: open } : null,
          reason: `You get this each workday morning when something needs you in ${workspace}.`,
        },
      };
    }
    case "task_not_started": {
      const days = num(data, "workdays") ?? 2;
      return {
        subject: `Not started yet: ${task}`,
        category: "task_not_started",
        props: {
          ...base,
          preview: `${task} was assigned to you ${plural(days, "workday")} ago.`,
          eyebrow: "Waiting to start",
          heading: `${task} hasn't been started`,
          intro: `It was assigned to you ${plural(days, "workday")} ago and is still in the first column. Move it along when you begin, or say what's in the way.`,
          card: {
            ...taskCard,
            status: { label: "Not started", tone: "warning" },
          },
          primary: openTask,
          reason: "You get this because the task is assigned to you.",
        },
      };
    }
    case "task_stuck": {
      const days = num(data, "workdays") ?? 3;
      const since = formatDay(str(data, "since"));
      return {
        subject: `No progress for ${plural(days, "workday")}: ${task}`,
        category: "task_stuck",
        props: {
          ...base,
          preview: `Nothing has changed on ${task} since ${since ?? "a while"}.`,
          eyebrow: "Stuck?",
          heading: `${task} hasn't moved in ${plural(days, "workday")}`,
          intro:
            "No updates, comments or time logged since then. A quick comment on where it stands helps everyone, and so does asking for help.",
          card: {
            ...taskCard,
            status: { label: "In progress", tone: "info" },
            details: since ? [{ label: "Last activity", value: since }] : [],
          },
          primary: openTask,
          reason: "You get this because the task is assigned to you.",
        },
      };
    }
    case "end_of_day":
      return {
        subject: "What did you work on today?",
        category: "end_of_day",
        props: {
          ...base,
          preview: "No time logged on any task today.",
          eyebrow: "End of day",
          heading: "What did you work on today?",
          intro:
            "You're clocked in, but no time is logged on a task yet. Log it now, or add a short note when you clock out, while the day is fresh.",
          primary: open ? { label: "Open attendance", url: open } : null,
          reason: `You get this on workdays you clock in to ${workspace} without logging time.`,
        },
      };
    case "team_summary": {
      const people = Array.isArray(data?.people)
        ? (data.people as {
            name: string;
            done: number;
            open: number;
            overdue: number;
          }[])
        : [];
      const done = num(data, "doneCount") ?? 0;
      const late = num(data, "overdueCount") ?? 0;
      return {
        subject: `${workspace} this week: ${done} done, ${late} overdue`,
        category: "team_summary",
        props: {
          ...base,
          preview: `${done} tasks finished last week; ${late} overdue now.`,
          eyebrow: "Team summary",
          heading: `Last week in ${workspace}`,
          intro:
            late > 0
              ? "Most of the week went through. The overdue ones are worth a quick check-in: help, a new date, or someone else."
              : "Nothing is overdue. A good week.",
          card: {
            title: workspace,
            details: [
              { label: "Finished last week", value: String(done) },
              { label: "Open now", value: String(num(data, "openCount") ?? 0) },
              { label: "Overdue now", value: String(late) },
            ],
          },
          body: people.length
            ? [
                "By person",
                ...people.map(
                  (p) =>
                    `• ${p.name}: ${p.done} done · ${p.open} open${p.overdue ? ` · ${p.overdue} overdue` : ""}`,
                ),
              ]
            : null,
          primary: open ? { label: "Open people", url: open } : null,
          reason: `You get this on the first workday of each week because you look after people in ${workspace}.`,
        },
      };
    }
    case "task_overdue_escalated": {
      const late = num(data, "daysOverdue") ?? 3;
      const due = formatDay(str(data, "dueDate"));
      const who = str(data, "assigneeName") ?? "Someone";
      const lateText = `${late} ${late === 1 ? "day" : "days"}`;
      return {
        subject: `${who}'s task is ${lateText} overdue: ${task}`,
        category: "task_escalated",
        props: {
          ...base,
          preview: `${task} (assigned to ${who}) is ${lateText} late.`,
          eyebrow: "Needs attention",
          heading: `${task} is ${lateText} overdue`,
          intro: `${who} has had reminders since the due date. A quick check-in usually unblocks it: help, move the date, or reassign.`,
          card: {
            ...taskCard,
            status: { label: `${lateText} late`, tone: "danger" },
            details: [
              { label: "Assigned to", value: who },
              ...(due ? [{ label: "Was due", value: due }] : []),
            ],
          },
          primary: openTask,
          reason: `You get this because you look after people in ${workspace}.`,
        },
      };
    }
    case "time_entry_created":
      return {
        subject: `Time logged on ${task}`,
        category: "time_entry",
        props: {
          ...base,
          preview: `Someone logged time on ${task}.`,
          eyebrow: "Time tracked",
          heading: `Time was logged on ${task}`,
          card: taskCard,
          primary: openTask,
          reason: "You get this because you own the task.",
        },
      };
    case "leave_requested": {
      const who = str(data, "userName") ?? "Someone";
      const kind = LEAVE_TYPES[str(data, "type") ?? ""] ?? "Leave";
      const range = dateRange(str(data, "startDate"), str(data, "endDate"));
      const days = num(data, "days");
      return {
        subject: `${who} asked for ${kind.toLowerCase()}${range ? ` (${range})` : ""}`,
        category: "leave_requested",
        props: {
          ...base,
          preview: `${who} is waiting for your decision.`,
          eyebrow: "Leave request",
          heading: `${who} asked for ${kind.toLowerCase()}`,
          intro: "Approve or reject it; they'll get an email either way.",
          card: {
            title: kind,
            subtitle: range,
            status: { label: "Waiting for you", tone: "warning" },
            details: [
              ...(days !== null
                ? [{ label: "Working days", value: String(days) }]
                : []),
              { label: "Workspace", value: workspace },
            ],
          },
          quote: str(data, "reason")
            ? { author: who, text: str(data, "reason") as string }
            : null,
          primary: open ? { label: "Review request", url: open } : null,
          reason: `You get this because you approve leave in ${workspace}.`,
        },
      };
    }
    case "leave_withdrawn": {
      const who = str(data, "userName") ?? "Someone";
      const kind = LEAVE_TYPES[str(data, "type") ?? ""] ?? "Leave";
      const range = dateRange(str(data, "startDate"), str(data, "endDate"));
      return {
        subject: `${who} withdrew their ${kind.toLowerCase()} request${range ? ` (${range})` : ""}`,
        category: "leave_withdrawn",
        props: {
          ...base,
          preview: `Nothing to decide: ${who} withdrew the request.`,
          eyebrow: "Leave request",
          heading: `${who} withdrew a ${kind.toLowerCase()} request`,
          intro:
            "There's nothing left to decide. Those days stay working days.",
          card: {
            title: kind,
            subtitle: range,
            status: { label: "Withdrawn", tone: "neutral" },
            details: [{ label: "Workspace", value: workspace }],
          },
          primary: open ? { label: "View requests", url: open } : null,
          reason: `You get this because you approve leave in ${workspace}.`,
        },
      };
    }
    case "member_joined": {
      const who = str(data, "userName") ?? "Someone";
      const email = str(data, "email");
      const role = humanStatus(str(data, "role"));
      return {
        subject: `${who} joined ${workspace}`,
        category: "member_joined",
        props: {
          ...base,
          preview: `${who} accepted the invitation to ${workspace}.`,
          eyebrow: "New member",
          heading: `${who} joined ${workspace}`,
          intro:
            "They accepted their invitation. Check their role, department and working hours so attendance and pay work from day one.",
          card: {
            title: who,
            subtitle: email,
            details: [
              ...(role ? [{ label: "Role", value: role }] : []),
              { label: "Workspace", value: workspace },
            ],
          },
          primary: open ? { label: "Open people", url: open } : null,
          reason: `You get this because you manage ${workspace}.`,
        },
      };
    }
    case "leave_approved":
    case "leave_rejected":
    case "leave_cancelled": {
      const kind = LEAVE_TYPES[str(data, "type") ?? ""] ?? "Leave";
      const range = dateRange(str(data, "startDate"), str(data, "endDate"));
      const actor = str(data, "actorName") ?? "Your approver";
      const note = str(data, "note");
      const outcome =
        type === "leave_approved"
          ? { word: "approved", tone: "success" as const, label: "Approved" }
          : type === "leave_rejected"
            ? { word: "rejected", tone: "danger" as const, label: "Rejected" }
            : {
                word: "called off",
                tone: "neutral" as const,
                label: "Cancelled",
              };
      return {
        subject: `Your ${kind.toLowerCase()} was ${outcome.word}${range ? ` (${range})` : ""}`,
        category: "leave_decided",
        props: {
          ...base,
          preview: `${actor} ${outcome.word} your ${kind.toLowerCase()}.`,
          eyebrow: "Leave update",
          heading: `Your ${kind.toLowerCase()} was ${outcome.word}`,
          intro:
            type === "leave_approved"
              ? "Enjoy the time off. It's on the team calendar now."
              : type === "leave_rejected"
                ? "Talk to your approver if you'd like to pick other dates."
                : "Those days are working days again.",
          card: {
            title: kind,
            subtitle: range,
            status: { label: outcome.label, tone: outcome.tone },
            details: [{ label: "Decided by", value: actor }],
          },
          quote: note ? { author: actor, text: note } : null,
          primary: open ? { label: "View my leave", url: open } : null,
          reason: `You get this because you asked for leave in ${workspace}.`,
        },
      };
    }
    case "expense_submitted": {
      const who = str(data, "userName") ?? "Someone";
      const amount = money(num(data, "amount"), str(data, "currency"));
      const category = str(data, "category") ?? "Expense";
      const spent = formatDay(str(data, "spentOn"));
      const note = str(data, "description");
      return {
        subject: `${who} submitted an expense${amount ? ` of ${amount}` : ""}`,
        category: "expense_submitted",
        props: {
          ...base,
          preview: `${who} is waiting for your approval.`,
          eyebrow: "Expense",
          heading: `${who} submitted ${amount ?? "an expense"}`,
          intro: "Check the receipt and approve or reject it.",
          card: {
            title: amount ?? category,
            subtitle: category,
            status: { label: "Waiting for you", tone: "warning" },
            details: [
              ...(spent ? [{ label: "Spent on", value: spent }] : []),
              { label: "Workspace", value: workspace },
            ],
          },
          quote: note ? { author: who, text: note } : null,
          primary: open ? { label: "Review expense", url: open } : null,
          reason: `You get this because you approve expenses in ${workspace}.`,
        },
      };
    }
    case "expense_approved":
    case "expense_rejected":
    case "expense_paid": {
      const amount = money(num(data, "amount"), str(data, "currency"));
      const actor = str(data, "actorName") ?? "Your approver";
      const outcome =
        type === "expense_paid"
          ? { word: "paid back", tone: "success" as const, label: "Paid" }
          : type === "expense_approved"
            ? { word: "approved", tone: "success" as const, label: "Approved" }
            : { word: "rejected", tone: "danger" as const, label: "Rejected" };
      return {
        subject: `Your expense${amount ? ` of ${amount}` : ""} was ${outcome.word}`,
        category: "expense_decided",
        props: {
          ...base,
          preview: `${actor} marked your expense ${outcome.label.toLowerCase()}.`,
          eyebrow: "Expense update",
          heading: `Your expense was ${outcome.word}`,
          intro:
            type === "expense_approved"
              ? "It will be paid back with the next payout."
              : type === "expense_paid"
                ? "The money is on its way to you."
                : "Ask your approver if something was missing.",
          card: {
            title: amount ?? "Expense",
            subtitle: str(data, "category"),
            status: { label: outcome.label, tone: outcome.tone },
            details: [{ label: "By", value: actor }],
          },
          primary: open ? { label: "View my expenses", url: open } : null,
          reason: `You get this because you submitted an expense in ${workspace}.`,
        },
      };
    }
    case "payslip_ready": {
      const period = monthName(num(data, "year"), num(data, "month"));
      const forPeriod = period ? ` for ${period}` : "";
      return {
        subject: `Your payslip${forPeriod} is ready`,
        category: "payslip",
        props: {
          ...base,
          preview: `Your payslip${forPeriod} is ready to view.`,
          eyebrow: "Payroll",
          heading: `Your payslip${forPeriod} is ready`,
          // Pay is private: the email only says where to look.
          intro:
            "For your privacy the amounts are not in this email. Open TeamOS to see them.",
          card: period
            ? {
                title: period,
                subtitle: workspace,
                status: { label: "Ready", tone: "success" },
              }
            : null,
          primary: open ? { label: "View payslip", url: open } : null,
          reason: `You get this because you are paid through ${workspace}.`,
        },
      };
    }
    case "chat_mention": {
      const who = str(data, "senderName") ?? "Someone";
      const where = str(data, "conversationTitle");
      const excerpt = plain(str(data, "excerpt"));
      const heading = where
        ? `${who} mentioned you in ${where}`
        : `${who} mentioned you in chat`;
      return {
        subject: heading,
        category: "chat_mention",
        props: {
          ...base,
          preview: excerpt ?? heading,
          eyebrow: "Mentioned in chat",
          heading,
          quote: excerpt ? { author: who, text: excerpt } : null,
          primary: open ? { label: "Reply in chat", url: open } : null,
          reason: `You get this because someone mentioned you in ${workspace}'s chat.`,
        },
      };
    }
    case "role_changed": {
      const role = humanStatus(str(data, "newRole")) ?? "a new role";
      const previous = humanStatus(str(data, "oldRole"));
      const by = str(data, "changedByName");
      return {
        subject: `You're now ${role} in ${workspace}`,
        category: "membership",
        props: {
          ...base,
          preview: `Your role in ${workspace} changed to ${role}.`,
          eyebrow: "Role changed",
          heading: `You're now ${role} in ${workspace}`,
          intro: by
            ? `${by} changed your role. What you can see and do in ${workspace} follows the new role right away.`
            : `What you can see and do in ${workspace} follows the new role right away.`,
          card: {
            title: workspace,
            status: { label: role, tone: "info" },
            details: previous
              ? [{ label: "Changed", value: `${previous} → ${role}` }]
              : [],
          },
          primary: open ? { label: "Open workspace", url: open } : null,
          reason: `You get this because you're a member of ${workspace}.`,
        },
      };
    }
    case "member_removed": {
      const by = str(data, "removedByName");
      return {
        subject: `You were removed from ${workspace}`,
        category: "membership",
        props: {
          ...base,
          preview: `You no longer have access to ${workspace}.`,
          eyebrow: "Access removed",
          heading: `You were removed from ${workspace}`,
          intro: by
            ? `${by} removed you from ${workspace}. Its projects, chat and files are no longer available to you.`
            : "Its projects, chat and files are no longer available to you.",
          callout: {
            tone: "neutral",
            text: "If this looks like a mistake, ask an admin of the workspace to invite you again.",
          },
          reason: `You get this because you were a member of ${workspace}.`,
        },
      };
    }
    case "workspace_created":
      return {
        subject: `Welcome to ${workspace}`,
        category: "workspace",
        props: {
          ...base,
          preview: `${workspace} is ready.`,
          eyebrow: "Welcome",
          heading: `${workspace} is ready`,
          intro: "Invite your team, create a project and start planning.",
          primary: open ? { label: "Open workspace", url: open } : null,
          reason: "You get this because you created this workspace.",
        },
      };
    default:
      return {
        subject: fallback.title,
        category: "other",
        props: {
          ...base,
          preview: fallback.body,
          heading: fallback.title,
          intro: fallback.body,
          primary: open ? { label: "Open in TeamOS", url: open } : null,
          reason: `You get this because you're a member of ${workspace}.`,
        },
      };
  }
}

/**
 * Sent once, right after someone creates an account. Not tied to a
 * workspace, so it has no notification switch; it is transactional.
 */
// The address isn't verified yet when this goes out, so it carries nothing
// the person typed: a signup can't turn it into a message to a stranger.
export function buildWelcomeEmail(): NotificationEmail {
  const app = clientUrl();
  return {
    subject: "Welcome to TeamOS",
    category: "welcome",
    props: {
      brand: { name: "TeamOS", logoUrl: null },
      preview: "Your account is ready. Here's how to get your team going.",
      eyebrow: "Welcome",
      heading: "Welcome to TeamOS",
      intro:
        "Your account is ready. TeamOS keeps your team's work, time, attendance and pay in one place.",
      body: [
        "1. Create a workspace for your company, or open the invitation someone sent you.",
        "2. Invite your team and set their roles, departments and working hours.",
        "3. Start a project, assign tasks, and clock in from the sidebar or the desktop app.",
      ],
      primary: { label: "Open TeamOS", url: `${app}/dashboard` },
      reason: "You get this because you just created a TeamOS account.",
    },
  };
}
