import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Sending always works; the tests look at what was queued.
vi.mock("@kaneo/email", async () => {
  const mock = await import("./mocks/email");
  return {
    ...mock,
    isEmailConfigured: () => true,
    emailProvider: () => "resend",
    deliverEmail: async () => ({ provider: "resend", id: "re_test" }),
  };
});

const { default: db, schema } = await import("../../apps/api/src/database");
const { publishEvent } = await import("../../apps/api/src/events");
const { zonedDay } = await import("../../apps/api/src/company/zoned-time");
const { addWorkspaceMember, requestAs } = await import("./helpers/company");
const { resetTestDatabase } = await import("./helpers/database");
const { createWorkspaceMember } = await import("./helpers/fixtures");

beforeEach(async () => {
  await resetTestDatabase();
});

// Every day is a work day, so today is always a valid leave day.
async function company() {
  const { user: owner, workspace } = await createWorkspaceMember({
    role: "owner",
  });
  await db.insert(schema.companySettingsTable).values({
    workspaceId: workspace.id,
    timezone: "Asia/Dhaka",
    workDays: "1,2,3,4,5,6,7",
  });
  const alice = await addWorkspaceMember(workspace.id, "member", "Alice");
  return {
    owner,
    alice,
    workspaceId: workspace.id,
    today: zonedDay(new Date(), "Asia/Dhaka"),
  };
}

// Notifications and emails are written just after the response.
async function eventually<T>(read: () => Promise<T[]>, want = 1) {
  let rows: T[] = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    rows = await read();
    if (rows.length >= want) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return rows;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

const notificationsFor = (userId: string, type: string) =>
  db
    .select()
    .from(schema.notificationTable)
    .where(
      and(
        eq(schema.notificationTable.userId, userId),
        eq(schema.notificationTable.type, type),
      ),
    );

const emailsFor = (userId: string, category: string) =>
  db
    .select()
    .from(schema.emailOutboxTable)
    .where(
      and(
        eq(schema.emailOutboxTable.userId, userId),
        eq(schema.emailOutboxTable.category, category),
      ),
    );

describe("notification events", () => {
  it("lists every event, all on until someone changes them", async () => {
    const { alice } = await company();
    const prefs = await requestAs(alice)("/notification-preferences");
    const keys = prefs.json.events.map((e: { key: string }) => e.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "task_assigned",
        "leave_requested",
        "leave_withdrawn",
        "member_joined",
        "payslip",
      ]),
    );
    expect(
      prefs.json.events.every(
        (e: { inApp: boolean; email: boolean }) => e.inApp && e.email,
      ),
    ).toBe(true);
    expect(
      prefs.json.events.find(
        (e: { key: string }) => e.key === "leave_requested",
      ).audience,
    ).toBe("approvers");

    const unknown = await requestAs(alice)("/notification-preferences", {
      method: "PUT",
      body: { events: { not_a_thing: { email: false } } },
    });
    expect(unknown.status).toBe(400);
  });

  it("keeps the app notification but skips the email when email is off", async () => {
    const { owner, alice, workspaceId, today } = await company();
    await requestAs(owner)("/notification-preferences", {
      method: "PUT",
      body: { events: { leave_requested: { email: false } } },
    });

    await requestAs(alice)("/requests/leave", {
      method: "POST",
      body: { workspaceId, type: "sick", startDate: today, endDate: today },
    });

    expect(
      await eventually(() => notificationsFor(owner.id, "leave_requested")),
    ).toHaveLength(1);
    await settle();
    expect(await emailsFor(owner.id, "leave_requested")).toHaveLength(0);
  });

  it("drops the notification entirely when it's off in the app", async () => {
    const { owner, alice, workspaceId, today } = await company();
    await requestAs(owner)("/notification-preferences", {
      method: "PUT",
      body: { events: { leave_requested: { inApp: false } } },
    });
    await requestAs(alice)("/requests/leave", {
      method: "POST",
      body: { workspaceId, type: "sick", startDate: today, endDate: today },
    });
    await settle();
    expect(await notificationsFor(owner.id, "leave_requested")).toHaveLength(0);
  });

  it("keeps the older task switches and the new ones in step", async () => {
    const { alice } = await company();
    // An older client turning assignment off…
    await requestAs(alice)("/notification-preferences", {
      method: "PUT",
      body: { taskAssignmentEnabled: false },
    });
    let prefs = await requestAs(alice)("/notification-preferences");
    expect(
      prefs.json.events.find((e: { key: string }) => e.key === "task_assigned")
        .inApp,
    ).toBe(false);

    // …and the new switches updating the column the scheduler reads.
    await requestAs(alice)("/notification-preferences", {
      method: "PUT",
      body: {
        events: { task_due: { inApp: false }, task_overdue: { inApp: false } },
      },
    });
    prefs = await requestAs(alice)("/notification-preferences");
    expect(prefs.json.dueDateReminderEnabled).toBe(false);
    await requestAs(alice)("/notification-preferences", {
      method: "PUT",
      body: { events: { task_overdue: { inApp: true } } },
    });
    prefs = await requestAs(alice)("/notification-preferences");
    // Still needed for overdue alerts.
    expect(prefs.json.dueDateReminderEnabled).toBe(true);
  });

  it("tells approvers when a request is withdrawn", async () => {
    const { owner, alice, workspaceId, today } = await company();
    const requested = await requestAs(alice)("/requests/leave", {
      method: "POST",
      body: { workspaceId, type: "annual", startDate: today, endDate: today },
    });
    await requestAs(alice)(`/requests/leave/${requested.json.id}/cancel`, {
      method: "POST",
      body: { workspaceId },
    });

    const [withdrawn] = await eventually(() =>
      notificationsFor(owner.id, "leave_withdrawn"),
    );
    expect(withdrawn?.eventData).toMatchObject({ userName: "Alice" });
    const [email] = await eventually(() =>
      emailsFor(owner.id, "leave_withdrawn"),
    );
    expect(email?.subject).toMatch(/^Alice withdrew their annual leave/);
  });

  it("tells workspace admins when someone joins, not the newcomer", async () => {
    const { owner, alice, workspaceId } = await company();
    await publishEvent("member.joined", {
      workspaceId,
      userId: alice.id,
      userName: "Alice",
      email: alice.email,
      role: "member",
    });

    const [joined] = await eventually(() =>
      notificationsFor(owner.id, "member_joined"),
    );
    expect(joined).toBeTruthy();
    await settle();
    expect(await notificationsFor(alice.id, "member_joined")).toHaveLength(0);
    const [email] = await eventually(() =>
      emailsFor(owner.id, "member_joined"),
    );
    expect(email?.subject).toMatch(/^Alice joined /);
  });

  it("shows people only their own emails, across workspaces", async () => {
    const { owner, alice, workspaceId, today } = await company();
    await requestAs(alice)("/requests/leave", {
      method: "POST",
      body: { workspaceId, type: "sick", startDate: today, endDate: today },
    });
    await eventually(() => emailsFor(owner.id, "leave_requested"));

    const mine = await requestAs(owner)("/email-log/mine");
    expect(mine.status).toBe(200);
    expect(mine.json.entries[0]).toMatchObject({
      category: "leave_requested",
      toEmail: owner.email,
    });
    expect(mine.json.entries[0].workspaceName).toBeTruthy();
    expect((await requestAs(alice)("/email-log/mine")).json.entries).toEqual(
      [],
    );

    // Nobody can retry someone else's email.
    const [row] = await emailsFor(owner.id, "leave_requested");
    await db
      .update(schema.emailOutboxTable)
      .set({ status: "failed" })
      .where(eq(schema.emailOutboxTable.id, row?.id ?? ""));
    const stolen = await requestAs(alice)(`/email-log/mine/${row?.id}/retry`, {
      method: "POST",
    });
    expect(stolen.status).toBe(404);
    const retried = await requestAs(owner)(`/email-log/mine/${row?.id}/retry`, {
      method: "POST",
    });
    expect(retried.status).toBe(200);
  });
});
