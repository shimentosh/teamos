import { describe, expect, it } from "vitest";
import {
  brandFor,
  buildNotificationEmail,
  type EmailContext,
} from "../../../apps/api/src/notification-preferences/email-content";

const context: EmailContext = {
  workspaceId: "w1",
  workspaceName: "Demo Company",
  workspaceLogo: null,
  projectName: "Website Redesign",
  taskTitle: "Fix the header",
  actionUrl: "https://app.example.com/task/1",
};

const build = (type: string, eventData: Record<string, unknown> = {}) =>
  buildNotificationEmail({
    type,
    eventData,
    context,
    recipientName: "Nusrat",
    fallback: { title: "Fallback title", body: "Fallback body" },
  });

describe("buildNotificationEmail", () => {
  it("gives an assignment a task card and an Open task button", () => {
    const email = build("task_assignee_changed");
    expect(email.subject).toBe("You've been assigned: Fix the header");
    expect(email.category).toBe("task_assigned");
    expect(email.props.card?.subtitle).toBe("Website Redesign · Demo Company");
    expect(email.props.primary).toEqual({
      label: "Open task",
      url: "https://app.example.com/task/1",
    });
    expect(email.props.manageUrl).toMatch(
      /\/dashboard\/settings\/account\/notifications$/,
    );
  });

  it("quotes comments as plain text", () => {
    const email = build("task_comment", {
      commenterName: "Tanvir",
      commentPreview: "<p>Looks <strong>great</strong>, ship it</p>",
    });
    expect(email.subject).toBe("Tanvir commented on Fix the header");
    expect(email.props.quote).toEqual({
      author: "Tanvir",
      text: "Looks great , ship it",
    });
  });

  it("marks overdue tasks as danger, with how late they are", () => {
    const email = build("task_overdue", {
      dueDate: "2026-09-17",
      daysOverdue: 3,
    });
    expect(email.subject).toBe("Overdue by 3 days: Fix the header");
    expect(email.props.card?.status).toEqual({
      label: "3 days late",
      tone: "danger",
    });
    expect(email.props.card?.details).toEqual([
      { label: "Was due", value: "Thu, Sep 17, 2026" },
    ]);
  });

  it("tells managers whose task is stuck", () => {
    const email = build("task_overdue_escalated", {
      dueDate: "2026-09-17",
      daysOverdue: 5,
      assigneeName: "Mia",
    });
    expect(email.subject).toBe("Mia's task is 5 days overdue: Fix the header");
    expect(email.category).toBe("task_escalated");
    expect(email.props.card?.details).toContainEqual({
      label: "Assigned to",
      value: "Mia",
    });
  });

  it("asks approvers to review leave, with the reason", () => {
    const email = build("leave_requested", {
      userName: "Nusrat Jahan",
      type: "annual",
      startDate: "2026-09-22",
      endDate: "2026-09-23",
      days: 2,
      reason: "Family event",
    });
    expect(email.subject).toBe(
      "Nusrat Jahan asked for annual leave (Tue, Sep 22, 2026 – Wed, Sep 23, 2026)",
    );
    expect(email.props.primary?.label).toBe("Review request");
    expect(email.props.quote?.text).toBe("Family event");
    expect(email.props.card?.details).toContainEqual({
      label: "Working days",
      value: "2",
    });
  });

  it("tells the person how their leave was decided, with the note", () => {
    const rejected = build("leave_rejected", {
      type: "sick",
      startDate: "2026-09-22",
      endDate: "2026-09-22",
      actorName: "Mona",
      note: "Release week",
    });
    expect(rejected.subject).toBe(
      "Your sick leave was rejected (Tue, Sep 22, 2026)",
    );
    expect(rejected.props.card?.status?.tone).toBe("danger");
    expect(rejected.props.quote).toEqual({
      author: "Mona",
      text: "Release week",
    });
  });

  it("tells approvers a request was withdrawn, with nothing to decide", () => {
    const email = build("leave_withdrawn", {
      userName: "Alice",
      type: "annual",
      startDate: "2026-09-21",
      endDate: "2026-09-22",
    });
    expect(email.category).toBe("leave_withdrawn");
    expect(email.subject).toMatch(/^Alice withdrew their annual leave request/);
    expect(email.props.card?.status).toEqual({
      label: "Withdrawn",
      tone: "neutral",
    });
  });

  it("welcomes a new member to admins, with their role", () => {
    const email = build("member_joined", {
      userName: "Rafi",
      email: "rafi@example.com",
      role: "member",
    });
    expect(email.category).toBe("member_joined");
    expect(email.subject).toBe("Rafi joined Demo Company");
    expect(email.props.card?.subtitle).toBe("rafi@example.com");
    expect(email.props.card?.details).toContainEqual({
      label: "Role",
      value: "Member",
    });
  });

  it("falls back to the stored wording for unknown types", () => {
    const email = build("something_new");
    expect(email.subject).toBe("Fallback title");
    expect(email.category).toBe("other");
  });
});

describe("brandFor", () => {
  it("only uses hosted https logos", () => {
    expect(
      brandFor({ ...context, workspaceLogo: "https://x.com/a.png" }).logoUrl,
    ).toBe("https://x.com/a.png");
    expect(
      brandFor({ ...context, workspaceLogo: "data:image/png;base64,AAAA" })
        .logoUrl,
    ).toBeNull();
  });
});
