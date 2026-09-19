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
const { addWorkspaceMember, requestAs } = await import("./helpers/company");
const { resetTestDatabase } = await import("./helpers/database");
const { createProjectFixture, createWorkspaceMember, grantSeeAllTasks } =
  await import("./helpers/fixtures");

beforeEach(async () => {
  await resetTestDatabase();
});

// Owner acts; Bob (admin, sees every task) and Alice (member, sees only her
// own tasks) are on the team; Carol gets the task.
async function setup() {
  const { user: owner, workspace } = await createWorkspaceMember({
    role: "owner",
  });
  await grantSeeAllTasks("admin");
  const bob = await addWorkspaceMember(workspace.id, "admin", "Bob");
  const alice = await addWorkspaceMember(workspace.id, "member", "Alice");
  const carol = await addWorkspaceMember(workspace.id, "member", "Carol");
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  await db.insert(schema.projectMemberTable).values(
    [owner, bob, alice, carol].map((user) => ({
      projectId: project.id,
      userId: user.id,
    })),
  );
  const createTask = async (title: string) => {
    const created = await requestAs(owner)(`/task/${project.id}`, {
      method: "POST",
      body: {
        title,
        description: "",
        priority: "low",
        status: "to-do",
        userId: carol.id,
      },
    });
    expect(created.status).toBe(200);
    return created.json.id as string;
  };
  return { owner, bob, alice, carol, project, createTask };
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

describe("task activity notifications", () => {
  it("tells the project team about a new task, in the app and by email", async () => {
    const { owner, bob, alice, carol, project, createTask } = await setup();
    const taskId = await createTask("Fix the login page");

    const [notice] = await eventually(() =>
      notificationsFor(bob.id, "project_task_created"),
    );
    expect(notice).toMatchObject({
      resourceId: taskId,
      resourceType: "task",
      eventData: expect.objectContaining({
        taskTitle: "Fix the login page",
        projectId: project.id,
      }),
    });
    const [email] = await eventually(() =>
      emailsFor(bob.id, "project_activity"),
    );
    expect(email?.subject).toContain("Fix the login page");

    await settle();
    // Not the creator, not someone who can't see the task, and the assignee
    // hears through "New task for you" instead.
    expect(await notificationsFor(owner.id, "project_task_created")).toEqual(
      [],
    );
    expect(await notificationsFor(alice.id, "project_task_created")).toEqual(
      [],
    );
    expect(await notificationsFor(carol.id, "project_task_created")).toEqual(
      [],
    );
    expect(await notificationsFor(carol.id, "task_created")).toHaveLength(1);
  });

  it("tells the assignee and the team when a task is deleted", async () => {
    const { owner, bob, alice, carol, project, createTask } = await setup();
    const taskId = await createTask("Old banner");
    const deleted = await requestAs(owner)(`/task/${taskId}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);

    const [yours] = await eventually(() =>
      notificationsFor(carol.id, "task_deleted"),
    );
    expect(yours).toMatchObject({
      resourceId: project.id,
      resourceType: "project",
      eventData: expect.objectContaining({ taskTitle: "Old banner" }),
    });
    await eventually(() => emailsFor(carol.id, "task_deleted"));
    expect(await emailsFor(carol.id, "task_deleted")).toHaveLength(1);
    expect(
      await eventually(() => notificationsFor(bob.id, "project_task_deleted")),
    ).toHaveLength(1);

    await settle();
    expect(await notificationsFor(alice.id, "project_task_deleted")).toEqual(
      [],
    );
    expect(await notificationsFor(owner.id, "project_task_deleted")).toEqual(
      [],
    );
    // The assignee gets their own notice, not the team one too.
    expect(await notificationsFor(carol.id, "project_task_deleted")).toEqual(
      [],
    );
  });

  it("keeps bulk deletes to the assignees", async () => {
    const { owner, bob, carol, createTask } = await setup();
    const ids = [await createTask("One"), await createTask("Two")];
    const deleted = await requestAs(owner)("/task/bulk", {
      method: "PATCH",
      body: { taskIds: ids, operation: "delete" },
    });
    expect(deleted.status).toBe(200);

    expect(
      await eventually(() => notificationsFor(carol.id, "task_deleted"), 2),
    ).toHaveLength(2);
    await settle();
    expect(await notificationsFor(bob.id, "project_task_deleted")).toEqual([]);
  });

  it("follows the workspace rule when an admin turns the team notice off", async () => {
    const { owner, bob, project, createTask } = await setup();
    const rule = await requestAs(owner)(
      "/notification-policy/project_activity",
      {
        method: "PUT",
        body: {
          workspaceId: project.workspaceId,
          inApp: false,
          email: false,
          locked: true,
        },
      },
    );
    expect(rule.status).toBe(200);
    await createTask("Quiet task");
    await settle();
    expect(await notificationsFor(bob.id, "project_task_created")).toEqual([]);
    expect(await emailsFor(bob.id, "project_activity")).toEqual([]);
  });
});
