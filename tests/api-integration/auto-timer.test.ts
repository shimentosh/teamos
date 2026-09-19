import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { addWorkspaceMember, requestAs } from "./helpers/company";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantSeeAllTasks,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

type User = Parameters<typeof requestAs>[0];

async function setup() {
  const { user: alice, workspace } = await createWorkspaceMember({
    role: "owner",
  });
  // About who may act on a task, not who sees it: members see the board.
  await grantSeeAllTasks();
  const bob = await addWorkspaceMember(workspace.id, "member", "Bob");
  const { project, columns } = await createProjectFixture({
    workspaceId: workspace.id,
  });
  let number = 0;
  const task = async (
    status: "to-do" | "in-progress" | "in-review" | "done",
    assignee: User | null = alice,
  ) => {
    number += 1;
    const column = {
      "to-do": columns.todo,
      "in-progress": columns.inProgress,
      "in-review": columns.inReview,
      done: columns.done,
    }[status];
    const [row] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: `Task ${number}`,
        status,
        columnId: column.id,
        number,
        position: number,
        userId: assignee?.id ?? null,
      })
      .returning();
    if (!row) throw new Error("no task");
    return row.id;
  };
  return { alice, bob, workspaceId: workspace.id, task };
}

const move = (user: User, taskId: string, status: string) =>
  requestAs(user)(`/task/status/${taskId}`, {
    method: "PUT",
    body: { status },
  });

const runningFor = (userId: string) =>
  db
    .select()
    .from(schema.timeEntryTable)
    .where(
      and(
        eq(schema.timeEntryTable.userId, userId),
        isNull(schema.timeEntryTable.endTime),
      ),
    );

const statusOf = async (taskId: string) =>
  (
    await db
      .select({ status: schema.taskTable.status })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, taskId))
  )[0]?.status;

describe("timer follows task status", () => {
  it("starts when a task moves to In Progress and stops when it leaves", async () => {
    const { alice, task } = await setup();
    const id = await task("to-do");

    expect((await move(alice, id, "in-progress")).status).toBe(200);
    const [running] = await runningFor(alice.id);
    expect(running?.taskId).toBe(id);

    // Moving it again within In Progress isn't a new start.
    await move(alice, id, "in-progress");
    expect(await runningFor(alice.id)).toHaveLength(1);

    await move(alice, id, "in-review");
    expect(await runningFor(alice.id)).toHaveLength(0);
    const [entry] = await db
      .select()
      .from(schema.timeEntryTable)
      .where(eq(schema.timeEntryTable.taskId, id));
    expect(entry?.endTime).not.toBeNull();
  });

  it("switches the timer when another task starts", async () => {
    const { alice, task } = await setup();
    const first = await task("to-do");
    const second = await task("to-do");
    await move(alice, first, "in-progress");
    await move(alice, second, "in-progress");

    const running = await runningFor(alice.id);
    expect(running.map((r) => r.taskId)).toEqual([second]);
  });

  it("never starts a timer for someone else's task", async () => {
    const { alice, bob, task } = await setup();
    const bobs = await task("to-do", bob);
    await move(alice, bobs, "in-progress");
    expect(await runningFor(alice.id)).toHaveLength(0);
    expect(await runningFor(bob.id)).toHaveLength(0);

    // Unassigned work counts as the mover's.
    const open = await task("to-do", null);
    await move(bob, open, "in-progress");
    expect((await runningFor(bob.id))[0]?.taskId).toBe(open);
  });

  it("stops everyone's timer when the task leaves In Progress", async () => {
    const { alice, bob, task } = await setup();
    const id = await task("to-do", bob);
    await move(bob, id, "in-progress");
    // A lead moves it on for review.
    await move(alice, id, "in-review");
    expect(await runningFor(bob.id)).toHaveLength(0);
  });

  it("moves a waiting task to In Progress when its timer starts", async () => {
    const { alice, task } = await setup();
    const waiting = await task("to-do");
    const reviewing = await task("in-review");

    const start = (taskId: string) =>
      requestAs(alice)("/time-entry", {
        method: "POST",
        body: { taskId, startTime: new Date().toISOString() },
      });

    expect((await start(waiting)).status).toBe(200);
    expect(await statusOf(waiting)).toBe("in-progress");
    expect(await runningFor(alice.id)).toHaveLength(1);

    // Already past In Progress: tracking review time doesn't move it back.
    await start(reviewing);
    expect(await statusOf(reviewing)).toBe("in-review");
    expect((await runningFor(alice.id))[0]?.taskId).toBe(reviewing);
  });

  it("starts at most one timer for a bulk move", async () => {
    const { alice, task } = await setup();
    const ids = [await task("to-do"), await task("to-do"), await task("to-do")];
    const moved = await requestAs(alice)("/task/bulk", {
      method: "PATCH",
      body: { taskIds: ids, operation: "updateStatus", value: "in-progress" },
    });
    expect(moved.status).toBe(200);
    expect(await runningFor(alice.id)).toHaveLength(1);
  });

  it("saves a note and a reference once the timer stops", async () => {
    const { alice, bob, task } = await setup();
    const id = await task("to-do");
    await move(alice, id, "in-progress");
    const [running] = await runningFor(alice.id);
    await move(alice, id, "in-review");

    const note = (user: User, body: unknown) =>
      requestAs(user)(`/time-entry/${running?.id}/note`, {
        method: "PATCH",
        body,
      });

    const saved = await note(alice, {
      description: "Drafted the newsletter",
      reference: "https://docs.example.com/newsletter",
    });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({
      description: "Drafted the newsletter",
      reference: "https://docs.example.com/newsletter",
    });
    expect((await note(alice, { reference: "JIRA-12" })).json.reference).toBe(
      "JIRA-12",
    );

    // Script links never get stored.
    expect(
      (await note(alice, { reference: "javascript:alert(1)" })).status,
    ).toBe(400);
    // Someone else's time is theirs to describe.
    expect((await note(bob, { description: "mine now" })).status).toBe(403);
    // Empty clears the reference.
    expect((await note(alice, { reference: "" })).json.reference).toBeNull();
  });

  it("takes the reference with the note when stopping by hand", async () => {
    const { alice, task } = await setup();
    const id = await task("to-do");
    await move(alice, id, "in-progress");
    const [running] = await runningFor(alice.id);
    const stopped = await requestAs(alice)(`/time-entry/${running?.id}/stop`, {
      method: "POST",
      body: { description: "Fixed the header", reference: "PR #42" },
    });
    expect(stopped.json).toMatchObject({
      description: "Fixed the header",
      reference: "PR #42",
    });
  });
});
