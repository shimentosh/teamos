import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
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
  const { token } = (await paired.json()) as { token: string };
  return (body: unknown) =>
    app.request("/api/agent/device/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
}

const liveOf = async (viewer: User, workspaceId: string, userId: string) => {
  const response = await requestAs(viewer)(
    `/people/live?workspaceId=${workspaceId}`,
  );
  expect(response.status).toBe(200);
  return response.json.find((p: { userId: string }) => p.userId === userId);
};

describe("live activity", () => {
  it("shows the app in front to the person and to activity readers only", async () => {
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    const alice = await addWorkspaceMember(workspace.id, "member", "Alice");
    const bob = await addWorkspaceMember(workspace.id, "member", "Bob");
    const beat = await pair(alice, workspace.id);

    const since = new Date(Date.now() - 60_000).toISOString();
    const response = await beat({
      state: "active",
      current: { app: "Figma", domain: "www.figma.com", since },
    });
    expect(response.status).toBe(200);

    expect(await liveOf(owner, workspace.id, alice.id)).toMatchObject({
      state: "active",
      app: "Figma",
      domain: "figma.com",
      hasDesktopApp: true,
    });
    expect(await liveOf(alice, workspace.id, alice.id)).toMatchObject({
      app: "Figma",
    });
    // Another member sees that Alice is active, not what she's using.
    expect(await liveOf(bob, workspace.id, alice.id)).toMatchObject({
      state: "active",
      app: null,
      domain: null,
    });
    expect(await liveOf(owner, workspace.id, bob.id)).toMatchObject({
      state: "offline",
      hasDesktopApp: false,
    });
  });

  it("forgets the app when tracking is paused, and drops untracked domains", async () => {
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    await db.insert(schema.companySettingsTable).values({
      workspaceId: workspace.id,
      trackDomains: false,
    });
    const beat = await pair(owner, workspace.id);
    const since = new Date().toISOString();

    await beat({
      state: "active",
      current: { app: "Chrome", domain: "github.com", since },
    });
    expect(await liveOf(owner, workspace.id, owner.id)).toMatchObject({
      app: "Chrome",
      domain: null,
    });

    await beat({ state: "paused", current: { app: "Chrome", since } });
    expect(await liveOf(owner, workspace.id, owner.id)).toMatchObject({
      state: "paused",
      app: null,
    });
  });

  it("still accepts heartbeats from agents that don't send the current app", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const beat = await pair(user, workspace.id);
    expect((await beat({ state: "idle" })).status).toBe(200);
    expect(await liveOf(user, workspace.id, user.id)).toMatchObject({
      state: "idle",
    });
  });
});

describe("live running timers", () => {
  it("shows the task being timed only to people who may see that task", async () => {
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    const alice = await addWorkspaceMember(workspace.id, "member", "Alice");
    const bob = await addWorkspaceMember(workspace.id, "member", "Bob");
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Secret launch plan",
        userId: alice.id,
        number: 7,
      })
      .returning();
    await db.insert(schema.timeEntryTable).values({
      taskId: task.id,
      userId: alice.id,
      startTime: new Date(Date.now() - 5 * 60_000),
    });

    expect(await liveOf(owner, workspace.id, alice.id)).toMatchObject({
      timing: true,
      runningTask: { title: "Secret launch plan", ref: `${project.slug}-7` },
    });
    // Bob can't see Alice's tasks (no task:read_all): he learns she's
    // timing something, not what.
    expect(await liveOf(bob, workspace.id, alice.id)).toMatchObject({
      timing: true,
      runningTask: null,
    });
  });
});
