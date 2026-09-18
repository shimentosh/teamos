import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession } from "./helpers/auth";
import { addWorkspaceMember, requestAs } from "./helpers/company";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type User = typeof schema.userTable.$inferSelect;

beforeEach(async () => {
  await resetTestDatabase();
});

const asKey = async (
  key: string,
  path: string,
  init?: { method?: string; body?: unknown },
) => {
  const { app } = createApp();
  const response = await app.request(`/api${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {}
  // biome-ignore lint/suspicious/noExplicitAny: tests read fields ad hoc
  return { status: response.status, json: json as any };
};

async function seedTask(workspaceId: string, userId?: string) {
  const { project } = await createProjectFixture({ workspaceId });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Write the launch post",
      priority: "no-priority",
      userId: userId ?? null,
      // Clear of the numbers the API hands out to new tasks.
      number: 900,
    })
    .returning();
  return { project, task };
}

describe("agent keys", () => {
  it("limit Claude to their scope, can't mint keys, and die with the kill switch", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { project } = await seedTask(workspace.id);
    const make = async (scope: string) =>
      (
        await requestAs(user)("/ai/agent-keys", {
          method: "POST",
          body: { scope, name: `${scope} key` },
        })
      ).json;
    const read = await make("read");
    const tasks = await make("tasks");
    expect(read.key).toMatch(/^tos_agent_/);

    const newTask = {
      title: "From Claude",
      description: "",
      priority: "low",
      status: "to-do",
    };
    expect(
      (await asKey(read.key, `/project?workspaceId=${workspace.id}`)).status,
    ).toBe(200);
    expect(
      (
        await asKey(read.key, `/task/${project.id}`, {
          method: "POST",
          body: newTask,
        })
      ).status,
    ).toBe(403);
    const created = await asKey(tasks.key, `/task/${project.id}`, {
      method: "POST",
      body: newTask,
    });
    expect(created.status).toBe(200);
    // Tasks keys can't delete.
    expect(
      (await asKey(tasks.key, `/task/${created.json.id}`, { method: "DELETE" }))
        .status,
    ).toBe(403);
    // A key can't make more keys.
    expect(
      (
        await asKey(tasks.key, "/ai/agent-keys", {
          method: "POST",
          body: { scope: "full" },
        })
      ).status,
    ).toBe(403);

    const listed = await requestAs(user)("/ai/agent-keys");
    expect(listed.json.map((k: { scope: string }) => k.scope).sort()).toEqual([
      "read",
      "tasks",
    ]);
    const revoked = await requestAs(user)("/ai/agent-keys", {
      method: "DELETE",
    });
    expect(revoked.json).toEqual({ revoked: 2 });
    // Otherwise the mocked session would stand in for the dead key.
    mockAnonymousSession();
    expect(
      (await asKey(read.key, `/project?workspaceId=${workspace.id}`)).status,
    ).toBe(401);
  });

  it("are accepted by the MCP endpoint", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    const key = (
      await requestAs(user)("/ai/agent-keys", {
        method: "POST",
        body: { scope: "read" },
      })
    ).json.key;
    const { app } = createApp();
    const response = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
    });
    expect(response.status).toBe(200);
  });
});

describe("Ask TeamOS", () => {
  it("is switched on only by people who manage workspace settings", async () => {
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    const member = await addWorkspaceMember(workspace.id, "member");
    const body = {
      workspaceId: workspace.id,
      enabled: true,
      engine: "desktop",
    };
    expect(
      (await requestAs(member)("/ai/settings", { method: "PUT", body })).status,
    ).toBe(403);
    const saved = await requestAs(owner)("/ai/settings", {
      method: "PUT",
      body,
    });
    expect(saved.json).toMatchObject({ enabled: true, engine: "desktop" });
    // Off unless someone turns it on.
    const other = await createWorkspaceMember({ role: "owner" });
    expect(
      (
        await requestAs(other.user)("/ai/ask", {
          method: "POST",
          body: { workspaceId: other.workspace.id, prompt: "hi" },
        })
      ).status,
    ).toBe(403);
  });

  it("applies the ticked changes as the person, and undoes them", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { task } = await seedTask(workspace.id);
    const [changeSet] = await db
      .insert(schema.aiChangeSetTable)
      .values({
        workspaceId: workspace.id,
        userId: user.id,
        prompt: "Make it urgent",
        engine: "server",
        status: "proposed",
        actions: [
          { type: "update_task", taskId: task.id, priority: "urgent" },
          { type: "update_task", taskId: task.id, title: "Not ticked" },
        ],
      })
      .returning();

    const applied = await requestAs(user)(
      `/ai/change-sets/${changeSet.id}/apply`,
      { method: "POST", body: { workspaceId: workspace.id, actions: [0] } },
    );
    expect(applied.json.status).toBe("applied");
    const [after] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(after).toMatchObject({
      priority: "urgent",
      title: "Write the launch post",
    });

    await requestAs(user)(`/ai/change-sets/${changeSet.id}/undo`, {
      method: "POST",
      body: { workspaceId: workspace.id },
    });
    const [undone] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(undone.priority).toBe("no-priority");
    // Temporary keys are gone once each step is done.
    expect(await db.select().from(schema.apikeyTable)).toHaveLength(0);
  });

  it("isn't yours to apply when it's someone else's", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const other = await addWorkspaceMember(workspace.id, "admin");
    const [changeSet] = await db
      .insert(schema.aiChangeSetTable)
      .values({
        workspaceId: workspace.id,
        userId: user.id,
        prompt: "x",
        engine: "server",
        status: "proposed",
        actions: [],
      })
      .returning();
    expect(
      (
        await requestAs(other)(`/ai/change-sets/${changeSet.id}/apply`, {
          method: "POST",
          body: { workspaceId: workspace.id, actions: [] },
        })
      ).status,
    ).toBe(404);
  });
});

describe("desktop bridge", () => {
  async function pair(user: User, workspaceId: string) {
    const code = await requestAs(user)("/agent/pairing-code", {
      method: "POST",
      body: { workspaceId },
    });
    const { app } = createApp();
    const paired = await app.request("/api/agent/device/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: code.json.code,
        deviceName: "Laptop",
        platform: "windows",
      }),
    });
    return ((await paired.json()) as { token: string }).token;
  }

  it("hands the request to the person's desktop and turns its answer into a proposal", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { task } = await seedTask(workspace.id);
    await requestAs(user)("/ai/settings", {
      method: "PUT",
      body: { workspaceId: workspace.id, enabled: true, engine: "desktop" },
    });
    // No desktop app online yet.
    expect(
      (
        await requestAs(user)("/ai/ask", {
          method: "POST",
          body: { workspaceId: workspace.id, prompt: "Make it low" },
        })
      ).status,
    ).toBe(409);

    const device = await pair(user, workspace.id);
    const beat = await asKey(device, "/agent/device/heartbeat", {
      method: "POST",
      body: { state: "active" },
    });
    expect(beat.json.settings.aiBridge).toBe(true);

    const asked = await requestAs(user)("/ai/ask", {
      method: "POST",
      body: { workspaceId: workspace.id, prompt: "Make it low" },
    });
    expect(asked.json.status).toBe("proposing");

    const next = await asKey(device, "/agent/device/ai-jobs/next");
    expect(next.json.job).toMatchObject({ id: asked.json.id });
    expect(next.json.job.prompt).toContain("Make it low");
    // The job's key only reads.
    expect(
      (
        await asKey(next.json.job.token, `/task/status/${task.id}`, {
          method: "PUT",
          body: { status: "done" },
        })
      ).status,
    ).toBe(403);

    await asKey(device, `/agent/device/ai-jobs/${asked.json.id}/progress`, {
      method: "POST",
      body: { steps: ["list_tasks"] },
    });
    const answer = `Done.\n\`\`\`json\n${JSON.stringify({
      summary: "Setting it to low.",
      actions: [{ type: "update_task", taskId: task.id, priority: "low" }],
    })}\n\`\`\``;
    await asKey(device, `/agent/device/ai-jobs/${asked.json.id}/result`, {
      method: "POST",
      body: { text: answer },
    });

    const proposal = await requestAs(user)(
      `/ai/change-sets/${asked.json.id}?workspaceId=${workspace.id}`,
    );
    expect(proposal.json).toMatchObject({
      status: "proposed",
      summary: "Setting it to low.",
      actions: [{ type: "update_task", taskId: task.id, priority: "low" }],
    });
    // The job's key was revoked with the answer.
    mockAnonymousSession();
    expect(
      (await asKey(next.json.job.token, `/project?workspaceId=${workspace.id}`))
        .status,
    ).toBe(401);
  });
});
