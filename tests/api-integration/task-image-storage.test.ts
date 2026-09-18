import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const instanceBucket = process.env.S3_ENDPOINT;

beforeEach(async () => {
  await resetTestDatabase();
  // No R2 and no instance bucket: the workspace's files live in Postgres.
  process.env.S3_ENDPOINT = "";
});

afterEach(() => {
  process.env.S3_ENDPOINT = instanceBucket;
});

describe("images pasted into a task", () => {
  it("go where the workspace keeps its files, and are read back", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "With a picture",
        status: "to-do",
        columnId: columns.todo.id,
        number: 1,
        userId: user.id,
      })
      .returning();
    if (!task) throw new Error("no task");

    mockAuthenticatedSession(user);
    const { app } = createApp();
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
    ]);
    const res = await app.request(
      `/api/task/image-upload/${task.id}/direct?filename=shot.png&surface=description`,
      {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: png,
      },
    );
    expect(res.status).toBe(200);
    const { id, url } = (await res.json()) as { id: string; url: string };
    expect(url).toContain(`/asset/${id}`);

    const [asset] = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.id, id));
    expect(asset?.objectKey.startsWith("stored:")).toBe(true);
    const [file] = await db
      .select()
      .from(schema.storedFileTable)
      .where(eq(schema.storedFileTable.id, asset?.objectKey.slice(7) ?? ""));
    expect(file).toMatchObject({ kind: "asset", storage: "db" });

    const read = await app.request(`/api/asset/${id}`);
    expect(read.status).toBe(200);
    expect(read.headers.get("Content-Type")).toBe("image/png");
    expect([...new Uint8Array(await read.arrayBuffer())]).toEqual([...png]);

    // Pasted images never show up in the Files page.
    const list = await app.request(`/api/files?workspaceId=${workspace.id}`);
    const files = (await list.json()) as { files: unknown[] };
    expect(files.files).toHaveLength(0);
  });
});
