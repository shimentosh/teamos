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

describe("expense categories", () => {
  it("starts with defaults, lets admins add and remove, and keeps one", async () => {
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    const member = await addWorkspaceMember(workspace.id, "member", "Mia");
    const list = async () =>
      (await requestAs(member)(`/expense-category?workspaceId=${workspace.id}`))
        .json as { id: string; name: string; icon: string }[];

    const defaults = await list();
    expect(defaults.map((c) => c.name)).toEqual([
      "Equipment",
      "Meals",
      "Other",
      "Software",
      "Travel",
    ]);
    expect(defaults.find((c) => c.name === "Travel")?.icon).toBe("Plane");

    const byMember = await requestAs(member)("/expense-category", {
      method: "POST",
      body: { workspaceId: workspace.id, name: "Fuel", icon: "Fuel" },
    });
    expect(byMember.status).toBe(403);

    const fuel = await requestAs(owner)("/expense-category", {
      method: "POST",
      body: { workspaceId: workspace.id, name: "Fuel", icon: "Fuel" },
    });
    expect(fuel.status).toBe(200);
    const duplicate = await requestAs(owner)("/expense-category", {
      method: "POST",
      body: { workspaceId: workspace.id, name: "fuel" },
    });
    expect(duplicate.status).toBe(409);

    const badIcon = await requestAs(owner)(
      `/expense-category/${fuel.json.id}`,
      {
        method: "PATCH",
        body: { workspaceId: workspace.id, icon: "<script>" },
      },
    );
    expect(badIcon.status).toBe(400);

    for (const category of await list()) {
      await requestAs(owner)(
        `/expense-category/${category.id}?workspaceId=${workspace.id}`,
        { method: "DELETE" },
      );
    }
    const left = await list();
    expect(left).toHaveLength(1);
  });

  it("files an expense against a task in its project, and only there", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "member" });
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const { project: other } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Launch ads",
        status: "to-do",
        columnId: columns.todo.id,
        number: 7,
      })
      .returning();
    const submit = (projectId: string | undefined) =>
      requestAs(user)("/requests/expenses", {
        method: "POST",
        body: {
          workspaceId: workspace.id,
          amount: 2500,
          // Members may still use a one-off category.
          category: "Ad spend",
          spentOn: "2026-09-10",
          projectId,
          taskId: task.id,
        },
      });

    expect((await submit(other.id)).status).toBe(400);
    expect((await submit(undefined)).status).toBe(400);

    const ok = await submit(project.id);
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      category: "Ad spend",
      taskId: task.id,
      taskTitle: "Launch ads",
      taskRef: `${project.slug}-7`,
    });
  });
});
