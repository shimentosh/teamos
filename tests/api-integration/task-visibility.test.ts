import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { addWorkspaceMember, requestAs } from "./helpers/company";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

type User = Parameters<typeof requestAs>[0];

async function setup() {
  const { user: owner, workspace } = await createWorkspaceMember({
    role: "owner",
  });
  const member = await addWorkspaceMember(workspace.id, "member", "Mina");
  const manager = await addWorkspaceMember(workspace.id, "manager", "Mo");
  const { project, columns } = await createProjectFixture({
    workspaceId: workspace.id,
  });
  const other = await createProjectFixture({ workspaceId: workspace.id });

  let number = 0;
  const task = async (
    assignee: User | null,
    projectId = project.id,
    columnId = columns.todo.id,
  ) => {
    number += 1;
    const [row] = await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: `Task ${number}`,
        status: "to-do",
        columnId,
        number,
        position: number,
        userId: assignee?.id ?? null,
      })
      .returning();
    if (!row) throw new Error("no task");
    return row.id;
  };
  return {
    owner,
    member,
    manager,
    workspaceId: workspace.id,
    project,
    other: other.project,
    otherTodo: other.columns.todo.id,
    task,
  };
}

const listIds = async (user: User, projectId: string) => {
  const res = await requestAs(user)(`/task/tasks/${projectId}`);
  expect(res.status).toBe(200);
  const board = res.json.data as {
    columns: { tasks: { id: string }[] }[];
    plannedTasks: { id: string }[];
    archivedTasks: { id: string }[];
  };
  return [
    ...board.columns.flatMap((c) => c.tasks),
    ...board.plannedTasks,
    ...board.archivedTasks,
  ].map((t) => t.id);
};

describe("members see only the tasks assigned to them", () => {
  it("filters the board, and hides other tasks and their details", async () => {
    const { owner, member, manager, project, task } = await setup();
    const mine = await task(member);
    const theirs = await task(owner);
    const open = await task(null);

    expect(await listIds(member, project.id)).toEqual([mine]);
    expect((await listIds(manager, project.id)).sort()).toEqual(
      [mine, theirs, open].sort(),
    );

    const as = requestAs(member);
    expect((await as(`/task/${mine}`)).status).toBe(200);
    expect((await as(`/task/${theirs}`)).status).toBe(404);
    expect((await as(`/task/${open}`)).status).toBe(404);
    // Everything keyed by a task is bounded the same way.
    expect((await as(`/activity/${theirs}`)).status).toBe(404);
    expect((await as(`/time-entry/task/${theirs}`)).status).toBe(404);
    expect(
      (
        await as(`/task/status/${theirs}`, {
          method: "PUT",
          body: { status: "done" },
        })
      ).status,
    ).toBe(404);
    const bulk = await as("/task/bulk", {
      method: "PATCH",
      body: {
        taskIds: [mine, theirs],
        operation: "updateStatus",
        value: "done",
      },
    });
    expect(bulk.status).toBe(404);
  });

  it("scopes the project list, its rollups, search and export", async () => {
    const { owner, member, workspaceId, project, other, otherTodo, task } =
      await setup();
    await task(member);
    await task(owner);
    await task(owner, other.id, otherTodo);

    const projects = await requestAs(member)(
      `/project?workspaceId=${workspaceId}`,
    );
    const list = projects.json as {
      id: string;
      statistics: { totalTasks: number };
    }[];
    // The other project has none of their tasks and they're not on its team.
    expect(list.map((p) => p.id)).toEqual([project.id]);
    expect(list[0]?.statistics.totalTasks).toBe(1);
    expect((await requestAs(member)(`/project/${other.id}`)).status).toBe(404);

    const search = await requestAs(member)(
      `/search?q=Task&workspaceId=${workspaceId}&type=tasks`,
    );
    const found = (search.json as { results: { title: string }[] }).results;
    expect(found.map((r) => r.title)).toEqual(["Task 1"]);

    const exported = await requestAs(member)(`/task/export/${project.id}`);
    expect((exported.json as { tasks: unknown[] }).tasks).toHaveLength(1);
  });

  it("shows team projects, and keeps tasks they create", async () => {
    const { owner, member, workspaceId, other } = await setup();

    const added = await requestAs(owner)(`/project/${other.id}/members`, {
      method: "POST",
      body: { userId: member.id },
    });
    expect(added.status).toBe(200);
    // Members can't manage the team.
    expect(
      (
        await requestAs(member)(`/project/${other.id}/members/${member.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(403);

    const projects = await requestAs(member)(
      `/project?workspaceId=${workspaceId}`,
    );
    const onTeam = (
      projects.json as { id: string; memberIds: string[] }[]
    ).find((p) => p.id === other.id);
    expect(onTeam?.memberIds).toEqual([member.id]);

    const created = await requestAs(member)(`/task/${other.id}`, {
      method: "POST",
      body: {
        title: "My own",
        description: "",
        priority: "low",
        status: "to-do",
      },
    });
    expect(created.status).toBe(200);
    expect((created.json as { userId: string }).userId).toBe(member.id);
    expect(await listIds(member, other.id)).toEqual([
      (created.json as { id: string }).id,
    ]);
  });

  it("lets a role grant the whole view back", async () => {
    const { owner, member, project, task } = await setup();
    await task(owner);
    const [row] = await db
      .select()
      .from(schema.instanceRoleTable)
      .where(eq(schema.instanceRoleTable.role, "member"));
    const permission = row
      ? JSON.parse(row.permission)
      : { task: ["create", "read", "update"] };
    permission.task = [...permission.task, "read_all"];
    await db
      .insert(schema.instanceRoleTable)
      .values({ role: "member", permission: JSON.stringify(permission) })
      .onConflictDoUpdate({
        target: schema.instanceRoleTable.role,
        set: { permission: JSON.stringify(permission) },
      });
    expect(await listIds(member, project.id)).toHaveLength(1);
  });
});
