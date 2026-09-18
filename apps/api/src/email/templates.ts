import {
  isEmailConfigured,
  renderActivityEmail,
  renderSystemEmail,
  type SystemEmail,
} from "@kaneo/email";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { userTable } from "../database/schema";
import {
  buildNotificationEmail,
  buildWelcomeEmail,
  clientUrl,
  type EmailContext,
} from "../notification-preferences/email-content";
import {
  eventKeyOf,
  NOTIFICATION_EVENTS,
} from "../notification-preferences/events";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { enqueueEmail } from "./outbox";

// Sample data for previewing every email TeamOS sends. Nothing here is real;
// it only shows what each message looks like.
const sampleContext = (): EmailContext => ({
  workspaceId: "sample",
  workspaceName: "Acme Studio",
  workspaceLogo: null,
  projectName: "Website Redesign",
  taskTitle: "Fix the login page",
  actionUrl: `${clientUrl()}/dashboard`,
});

const SAMPLE_DATA: Record<string, Record<string, unknown>> = {
  task_status_changed: { oldStatus: "in-progress", newStatus: "done" },
  task_comment: {
    commenterName: "Nusrat Jahan",
    commentPreview: "Looks good. Can you add the error state too?",
  },
  task_mention: {
    mentionerName: "Tanvir Ahmed",
    commentPreview: "@you can you review this before Friday?",
  },
  due_date_reminder: { leadTimeMinutes: 1440, dueDate: "2026-09-25" },
  task_due_today: { dueDate: "2026-09-24" },
  task_due_soon: { dueDate: "2026-09-24" },
  task_overdue: { dueDate: "2026-09-18", daysOverdue: 1 },
  task_overdue_escalated: {
    dueDate: "2026-09-18",
    daysOverdue: 3,
    assigneeName: "Shakhawat Hossain",
  },
  time_entry_created: { actorName: "Farzana Akter" },
  daily_digest: {
    dueTodayCount: 2,
    overdueCount: 1,
    newCount: 1,
    openCount: 9,
    overdue: [
      { title: "Fix broken links on the blog", ref: "WEB-5", daysLate: 2 },
    ],
    dueToday: [
      { title: "Fix the login page", ref: "WEB-8" },
      { title: "Schedule newsletter", ref: "MKT-4" },
    ],
    fresh: [{ title: "Push notifications", ref: "APP-6" }],
  },
  task_deleted: { actorName: "Tanvir Ahmed", taskTitle: "Fix the login page" },
  project_task_created: { actorName: "Tanvir Ahmed" },
  project_task_deleted: {
    actorName: "Tanvir Ahmed",
    taskTitle: "Fix the login page",
  },
  task_not_started: { workdays: 2 },
  task_stuck: { workdays: 3, since: "2026-09-21" },
  end_of_day: {},
  team_summary: {
    doneCount: 14,
    openCount: 32,
    overdueCount: 3,
    people: [
      { name: "Shakhawat Hossain", done: 5, open: 9, overdue: 2 },
      { name: "Nusrat Jahan", done: 6, open: 7, overdue: 1 },
      { name: "Tanvir Ahmed", done: 3, open: 5, overdue: 0 },
    ],
  },
  chat_mention: {
    senderName: "Tanvir Ahmed",
    conversationTitle: "#design",
    excerpt: "@Nusrat can you share the final logo files today?",
  },
  role_changed: { oldRole: "member", newRole: "manager" },
  member_removed: {},
  leave_requested: {
    userName: "Shakhawat Hossain",
    type: "annual",
    startDate: "2026-10-05",
    endDate: "2026-10-07",
    days: 3,
    reason: "Family trip",
  },
  leave_withdrawn: {
    userName: "Shakhawat Hossain",
    type: "annual",
    startDate: "2026-10-05",
    endDate: "2026-10-07",
  },
  leave_approved: {
    type: "annual",
    startDate: "2026-10-05",
    endDate: "2026-10-07",
    days: 3,
  },
  leave_rejected: {
    type: "annual",
    startDate: "2026-10-05",
    endDate: "2026-10-07",
    days: 3,
    note: "The launch is that week. Could you move it?",
  },
  leave_cancelled: {
    type: "annual",
    startDate: "2026-10-05",
    endDate: "2026-10-07",
  },
  expense_submitted: {
    userName: "Farzana Akter",
    amount: 250000,
    currency: "BDT",
    category: "Travel",
    description: "Client visit, Chittagong",
    spentOn: "2026-09-16",
  },
  expense_approved: {
    amount: 250000,
    currency: "BDT",
    category: "Travel",
    spentOn: "2026-09-16",
  },
  expense_rejected: {
    amount: 250000,
    currency: "BDT",
    category: "Travel",
    spentOn: "2026-09-16",
    note: "Please attach the receipt.",
  },
  expense_paid: {
    amount: 250000,
    currency: "BDT",
    category: "Travel",
    spentOn: "2026-09-16",
  },
  payslip_ready: { year: 2026, month: 9, amount: 8500000, currency: "BDT" },
  member_joined: {
    userName: "Test Member",
    email: "member@example.com",
    role: "member",
  },
};

// Where each email sits in the gallery, and who receives it. "person" is
// the one the email is about (the assignee, the requester, the member).
const SECTIONS = {
  account: ["welcome", "magic_link", "otp", "password_reset"],
  team: [
    "invitation",
    "member_joined",
    "role_changed",
    "member_removed",
    "workspace_created",
    "trial_reminder",
  ],
  tasks: [
    "task_created",
    "task_assignee_changed",
    "task_status_changed",
    "task_comment",
    "task_mention",
    "task_deleted",
    "project_task_created",
    "project_task_deleted",
    "due_date_reminder",
    "task_due_today",
    "task_due_soon",
    "task_overdue",
    "task_overdue_escalated",
    "time_entry_created",
  ],
  nudges: [
    "daily_digest",
    "task_not_started",
    "task_stuck",
    "end_of_day",
    "team_summary",
  ],
  chat: ["chat_mention"],
  leave: [
    "leave_requested",
    "leave_withdrawn",
    "leave_approved",
    "leave_rejected",
    "leave_cancelled",
  ],
  money: [
    "expense_submitted",
    "expense_approved",
    "expense_rejected",
    "expense_paid",
    "payslip_ready",
  ],
} as const;

type Section = keyof typeof SECTIONS;

const AUDIENCE: Record<
  string,
  "person" | "approvers" | "admins" | "invitee" | "owner"
> = {
  magic_link: "person",
  otp: "person",
  password_reset: "person",
  welcome: "person",
  invitation: "invitee",
  trial_reminder: "owner",
};

const SYSTEM: Record<string, { subject: string; email: SystemEmail }> = {
  magic_link: {
    subject: "Login for TeamOS",
    email: {
      kind: "magic_link",
      props: { magicLink: `${clientUrl()}/auth/magic-link?token=sample` },
    },
  },
  otp: {
    subject: "Authentication code for TeamOS",
    email: { kind: "otp", props: { otp: "482913" } },
  },
  password_reset: {
    subject: "Reset your TeamOS password",
    email: {
      kind: "password_reset",
      props: {
        resetLink: `${clientUrl()}/auth/reset-password?token=sample`,
        userName: "Nusrat",
      },
    },
  },
  invitation: {
    subject: "Tanvir Ahmed invited you to Acme Studio on TeamOS",
    email: {
      kind: "invitation",
      props: {
        workspaceName: "Acme Studio",
        inviterName: "Tanvir Ahmed",
        inviterEmail: "tanvir@acme.example",
        invitationLink: `${clientUrl()}/invitation/accept/sample`,
        to: "nusrat@acme.example",
      },
    },
  },
  trial_reminder: {
    subject: "Your Acme Studio trial ends in 3 days",
    email: {
      kind: "trial_reminder",
      props: {
        workspaceName: "Acme Studio",
        daysLeft: 3,
        billingUrl: `${clientUrl()}/dashboard`,
      },
    },
  },
};

type Template = {
  type: string;
  section: Section;
  audience: string;
  /** The Settings → Notifications switch that turns it off, if any. */
  switchKey: string | null;
};

/** Every email TeamOS can send, in gallery order. */
function templates(): Template[] {
  const audienceOf = (type: string) => {
    if (AUDIENCE[type]) return AUDIENCE[type];
    const event = NOTIFICATION_EVENTS.find((e) =>
      (e.types as readonly string[]).includes(type),
    );
    return event?.audience === "everyone"
      ? "person"
      : (event?.audience ?? "person");
  };
  return (Object.keys(SECTIONS) as Section[]).flatMap((section) =>
    SECTIONS[section].map((type) => ({
      type,
      section,
      audience: audienceOf(type),
      switchKey: eventKeyOf(type),
    })),
  );
}

async function render(type: string) {
  const system = SYSTEM[type];
  if (system) {
    const { html, text } = await renderSystemEmail(system.email);
    return { subject: system.subject, html, text };
  }
  const email = build(type);
  const { html, text } = await renderActivityEmail(email.props);
  return { subject: email.subject, html, text };
}

const subjectOf = (type: string) =>
  SYSTEM[type]?.subject ?? build(type).subject;

function build(type: string) {
  if (type === "welcome") return buildWelcomeEmail();
  return buildNotificationEmail({
    type,
    eventData: SAMPLE_DATA[type] ?? {},
    context: sampleContext(),
    recipientName: "Nusrat Jahan",
    fallback: { title: type, body: "" },
  });
}

const templateSchema = z
  .object({
    type: z.string(),
    section: z.enum([
      "account",
      "team",
      "tasks",
      "nudges",
      "chat",
      "leave",
      "money",
    ]),
    audience: z.enum(["person", "approvers", "admins", "invitee", "owner"]),
    switchKey: z.string().nullable().openapi({
      description:
        "The Settings → Notifications switch that turns this email off; null when it is always sent.",
    }),
    subject: z.string(),
  })
  .openapi("EmailTemplate");

const listRoute = createRoute({
  method: "get",
  operationId: "listEmailTemplates",
  path: "/",
  tags: ["Email"],
  summary: "Email templates",
  description:
    "Every email TeamOS can send, with its subject as it reads with sample data.",
  responses: {
    200: jsonResponse("Templates", z.array(templateSchema)),
  },
});

const previewRoute = createRoute({
  method: "get",
  operationId: "previewEmailTemplate",
  path: "/{type}",
  tags: ["Email"],
  summary: "Preview an email",
  description: "The email rendered with sample data. Nothing is sent.",
  request: { params: z.object({ type: z.string() }) },
  responses: {
    200: jsonResponse(
      "Rendered email",
      z.object({ subject: z.string(), html: z.string(), text: z.string() }),
    ),
    404: errorResponse("No such template"),
  },
});

const sendTestRoute = createRoute({
  method: "post",
  operationId: "sendTestEmailTemplate",
  path: "/{type}/send",
  tags: ["Email"],
  summary: "Send me a test",
  description:
    "Sends the email with sample data to your own address only, through the normal queue, so it shows in your email log. At most 10 every 10 minutes.",
  request: { params: z.object({ type: z.string() }) },
  responses: {
    200: jsonResponse("Queued", z.object({ to: z.string() })),
    400: errorResponse("Email is not set up"),
    404: errorResponse("No such template"),
    429: errorResponse("Too many test emails; try again in a few minutes"),
  },
});

// Tests only ever go to the person asking; this keeps a stuck click from
// filling their inbox.
const TEST_LIMIT = 10;
const TEST_WINDOW_MS = 10 * 60 * 1000;
const recentTests = new Map<string, number[]>();

function allowTest(userId: string, now = Date.now()) {
  // Forget people whose window has passed, so the map stays small.
  for (const [id, times] of recentTests) {
    if (times.every((at) => now - at >= TEST_WINDOW_MS)) recentTests.delete(id);
  }
  const recent = (recentTests.get(userId) ?? []).filter(
    (at) => now - at < TEST_WINDOW_MS,
  );
  if (recent.length >= TEST_LIMIT) return false;
  recentTests.set(userId, [...recent, now]);
  return true;
}

const emailTemplates = apiRouter()
  .openapi(listRoute, async (c) =>
    c.json(
      templates().map((template) => ({
        ...template,
        subject: subjectOf(template.type),
      })) as z.infer<typeof templateSchema>[],
      200,
    ),
  )
  .openapi(previewRoute, async (c) => {
    const { type } = c.req.valid("param");
    if (!templates().some((template) => template.type === type)) {
      throw new HTTPException(404, { message: "No such template" });
    }
    return c.json(await render(type), 200);
  })
  .openapi(sendTestRoute, async (c) => {
    const { type } = c.req.valid("param");
    if (!templates().some((template) => template.type === type)) {
      throw new HTTPException(404, { message: "No such template" });
    }
    if (!isEmailConfigured()) {
      throw new HTTPException(400, {
        message: "Email isn't set up yet, so nothing can be sent",
      });
    }
    const userId = c.get("userId");
    if (!allowTest(userId)) {
      throw new HTTPException(429, {
        message: "Too many test emails. Try again in a few minutes.",
      });
    }
    const [me] = await db
      .select({ email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, userId));
    if (!me?.email) {
      throw new HTTPException(400, { message: "Your account has no email" });
    }
    const email = await render(type);
    await enqueueEmail({
      to: me.email,
      subject: `[Test] ${email.subject}`,
      html: email.html,
      text: email.text,
      category: "test",
      userId,
    });
    return c.json({ to: me.email }, 200);
  });

export default emailTemplates;
