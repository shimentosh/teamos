import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { runEngagement } from "../../apps/api/src/scheduler/engagement";
import { addWorkspaceMember } from "./helpers/company";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

// Company defaults: UTC, 09:00–17:00, Monday–Friday. 2026-09-28 is a Monday.
const at = (iso: string) => new Date(iso);

describe("engagement nudges", () => {
  it("sends the digest, nudges and weekly summary once, in working hours", async () => {
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
      userName: "Olivia",
    });
    const mia = await addWorkspaceMember(workspace.id, "member", "Mia");
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    let number = 1;
    const task = async (
      values: Partial<typeof schema.taskTable.$inferInsert>,
    ) => {
      const [row] = await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: mia.id,
          title: `Task ${number}`,
          number: number++,
          status: "to-do",
          columnId: columns.todo.id,
          createdAt: at("2026-09-28T08:00:00Z"),
          updatedAt: at("2026-09-28T08:00:00Z"),
          ...values,
        })
        .returning();
      return row;
    };
    const assigned = (taskId: string, when: string) =>
      db.insert(schema.activityTable).values({
        taskId,
        type: "created",
        userId: owner.id,
        createdAt: at(when),
      });

    // Due today, assigned this morning.
    const dueToday = await task({
      title: "Due today",
      dueDate: at("2026-09-28T00:00:00Z"),
    });
    await assigned(dueToday.id, "2026-09-28T08:00:00Z");
    // Assigned last Wednesday, never touched: not started.
    const waiting = await task({
      title: "Waiting",
      createdAt: at("2026-09-23T10:00:00Z"),
      updatedAt: at("2026-09-23T10:00:00Z"),
    });
    await assigned(waiting.id, "2026-09-23T10:00:00Z");
    // In progress, nothing since last Tuesday: stuck.
    const stuck = await task({
      title: "Stuck",
      status: "in-progress",
      columnId: columns.inProgress.id,
      createdAt: at("2026-09-22T10:00:00Z"),
      updatedAt: at("2026-09-22T10:00:00Z"),
    });
    await assigned(stuck.id, "2026-09-22T10:00:00Z");
    // Finished last Friday: counts in the weekly summary.
    await task({
      title: "Done",
      status: "done",
      columnId: columns.done.id,
      completedAt: at("2026-09-25T15:00:00Z"),
    });
    // Clocked in today, no time logged on any task.
    await db.insert(schema.attendanceSessionTable).values({
      workspaceId: workspace.id,
      userId: mia.id,
      clockIn: at("2026-09-28T09:00:00Z"),
    });

    const typesFor = async (userId: string) =>
      (
        await db
          .select()
          .from(schema.notificationTable)
          .orderBy(schema.notificationTable.createdAt)
      )
        .filter((n) => n.userId === userId)
        .map((n) => n.type);

    // Before work starts: nothing.
    await runEngagement(at("2026-09-28T08:55:00Z"));
    expect(await typesFor(mia.id)).toEqual([]);

    await runEngagement(at("2026-09-28T09:05:00Z"));
    await runEngagement(at("2026-09-28T09:40:00Z"));
    await runEngagement(at("2026-09-28T10:05:00Z"));
    // Running again in the same hour changes nothing.
    await runEngagement(at("2026-09-28T10:10:00Z"));
    await runEngagement(at("2026-09-28T16:35:00Z"));

    expect((await typesFor(mia.id)).sort()).toEqual(
      ["daily_digest", "end_of_day", "task_not_started", "task_stuck"].sort(),
    );
    expect(await typesFor(owner.id)).toEqual(["team_summary"]);

    const [digest] = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.type, "daily_digest"));
    expect(digest?.eventData).toMatchObject({
      dueTodayCount: 1,
      overdueCount: 0,
      newCount: 1,
    });
    const [summary] = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.type, "team_summary"));
    expect(summary?.eventData).toMatchObject({
      doneCount: 1,
      people: [expect.objectContaining({ name: "Mia", done: 1, open: 3 })],
    });
  });

  it("stays quiet on days off and approved leave", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const mia = await addWorkspaceMember(workspace.id, "member", "Mia");
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await db.insert(schema.taskTable).values({
      projectId: project.id,
      userId: mia.id,
      title: "Due Saturday",
      number: 1,
      status: "to-do",
      columnId: columns.todo.id,
      dueDate: at("2026-09-26T00:00:00Z"),
    });
    await db.insert(schema.leaveRequestTable).values({
      workspaceId: workspace.id,
      userId: mia.id,
      type: "annual",
      startDate: "2026-09-28",
      endDate: "2026-09-28",
      days: 1,
      status: "approved",
    });

    // Saturday morning, then Monday morning on leave.
    await runEngagement(at("2026-09-26T09:05:00Z"));
    await runEngagement(at("2026-09-28T09:05:00Z"));
    const sent = await db.select().from(schema.notificationTable);
    expect(sent.filter((n) => n.userId === mia.id)).toEqual([]);
  });
});
