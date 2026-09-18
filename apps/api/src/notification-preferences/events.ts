/**
 * Everything someone can be notified about, and who gets it. Each person can
 * turn an event off in the app and/or by email from Settings → Account →
 * Notifications. Keys match the email categories in email-content.ts, so the
 * delivery log and the switches speak the same language.
 */
export const NOTIFICATION_EVENTS = [
  // Work you're part of.
  {
    key: "task_assigned",
    audience: "everyone",
    types: ["task_assignee_changed", "task_created"],
  },
  { key: "task_status", audience: "everyone", types: ["task_status_changed"] },
  { key: "task_comment", audience: "everyone", types: ["task_comment"] },
  { key: "task_mention", audience: "everyone", types: ["task_mention"] },
  { key: "task_due", audience: "everyone", types: ["due_date_reminder"] },
  { key: "task_overdue", audience: "everyone", types: ["task_overdue"] },
  { key: "time_entry", audience: "everyone", types: ["time_entry_created"] },
  // Your own requests and pay.
  {
    key: "leave_decided",
    audience: "everyone",
    types: ["leave_approved", "leave_rejected", "leave_cancelled"],
  },
  {
    key: "expense_decided",
    audience: "everyone",
    types: ["expense_approved", "expense_rejected", "expense_paid"],
  },
  { key: "payslip", audience: "everyone", types: ["payslip_ready"] },
  // For people who approve requests.
  { key: "leave_requested", audience: "approvers", types: ["leave_requested"] },
  { key: "leave_withdrawn", audience: "approvers", types: ["leave_withdrawn"] },
  {
    key: "expense_submitted",
    audience: "approvers",
    types: ["expense_submitted"],
  },
  // For workspace admins.
  { key: "member_joined", audience: "admins", types: ["member_joined"] },
  { key: "workspace", audience: "admins", types: ["workspace_created"] },
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number]["key"];
export type NotificationAudience =
  (typeof NOTIFICATION_EVENTS)[number]["audience"];
export type EventSettings = Record<
  string,
  { inApp?: boolean; email?: boolean }
>;

const byType = new Map<string, NotificationEventKey>(
  NOTIFICATION_EVENTS.flatMap((event) =>
    event.types.map((type) => [type, event.key] as const),
  ),
);

export const isNotificationEventKey = (
  key: string,
): key is NotificationEventKey =>
  NOTIFICATION_EVENTS.some((event) => event.key === key);

/** The switch a notification type falls under, or null when it has none. */
export function eventKeyOf(type: string | null | undefined) {
  return type ? (byType.get(type) ?? null) : null;
}

type LegacySwitches = {
  taskAssignmentEnabled?: boolean;
  taskCommentEnabled?: boolean;
  taskStatusChangeEnabled?: boolean;
  dueDateReminderEnabled?: boolean;
};

/**
 * The four task switches that predate per-event settings. They still decide
 * for anyone who hasn't touched the new switches, and the due-date scheduler
 * reads `dueDateReminderEnabled` directly.
 */
export function legacyInApp(
  key: NotificationEventKey,
  preference: LegacySwitches | null | undefined,
) {
  switch (key) {
    case "task_assigned":
      return preference?.taskAssignmentEnabled;
    case "task_comment":
    case "task_mention":
      return preference?.taskCommentEnabled;
    case "task_status":
      return preference?.taskStatusChangeEnabled;
    case "task_due":
    case "task_overdue":
      return preference?.dueDateReminderEnabled;
    default:
      return undefined;
  }
}

/** Never configured means on, for both the app and email. */
export function eventEnabled(
  key: NotificationEventKey,
  channel: "inApp" | "email",
  preference:
    | (LegacySwitches & { eventSettings?: EventSettings | null })
    | null
    | undefined,
) {
  const explicit = preference?.eventSettings?.[key]?.[channel];
  if (explicit !== undefined) return explicit;
  if (channel === "inApp") return legacyInApp(key, preference) ?? true;
  return true;
}
