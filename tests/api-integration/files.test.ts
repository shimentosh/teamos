import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { addWorkspaceMember, requestAs } from "./helpers/company";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

type User = typeof schema.userTable.$inferSelect;

beforeEach(async () => {
  await resetTestDatabase();
});

async function upload(
  user: User,
  workspaceId: string,
  name: string,
  body: string | Buffer,
  folder = "",
  type = "text/plain",
) {
  mockAuthenticatedSession(user);
  const { app } = createApp();
  const query = new URLSearchParams({ workspaceId, name, folder });
  const response = await app.request(`/api/files/upload?${query}`, {
    method: "PUT",
    headers: { "Content-Type": type },
    body,
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: response.status, json };
}

// Public links are opened by anyone, without a session.
async function openPublic(url: string) {
  const { app } = createApp();
  const path = new URL(url).pathname;
  return app.request(path, { redirect: "manual" });
}

describe("files (stored in Postgres)", () => {
  it("lets members upload into folders and list them", async () => {
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    const alice = await addWorkspaceMember(workspace.id, "member", "Alice");

    expect(
      (await upload(alice, workspace.id, "brief.txt", "hello", "Design/Logos"))
        .status,
    ).toBe(200);
    await upload(owner, workspace.id, "root.txt", "top");

    const root = await requestAs(alice)(`/files?workspaceId=${workspace.id}`);
    expect(root.json.folders.map((f: { name: string }) => f.name)).toEqual([
      "Design",
    ]);
    expect(
      root.json.files.map((f: { filename: string }) => f.filename),
    ).toEqual(["root.txt"]);

    const logos = await requestAs(alice)(
      `/files?workspaceId=${workspace.id}&folder=Design/Logos`,
    );
    expect(logos.json.files[0]).toMatchObject({
      filename: "brief.txt",
      folder: "Design/Logos/",
      storage: "db",
      uploadedByName: "Alice",
      publicUrl: null,
    });
  });

  it("keeps viewers from uploading and refuses ../ folders", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const viewer = await addWorkspaceMember(workspace.id, "viewer");
    const member = await addWorkspaceMember(workspace.id, "member");
    expect((await upload(viewer, workspace.id, "a.txt", "x")).status).toBe(403);
    expect(
      (await upload(member, workspace.id, "a.txt", "x", "../other")).status,
    ).toBe(400);
  });

  it("shares a live link that works without signing in, until revoked", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const alice = await addWorkspaceMember(workspace.id, "member");
    const bob = await addWorkspaceMember(workspace.id, "member");
    const file = await upload(
      alice,
      workspace.id,
      "logo.png",
      "PNGDATA",
      "",
      "image/png",
    );
    const id = file.json.id as string;

    // Only the uploader (or file:manage) can share or delete.
    expect(
      (
        await requestAs(bob)(`/files/${id}/share`, {
          method: "POST",
          body: { workspaceId: workspace.id },
        })
      ).status,
    ).toBe(403);

    const shared = await requestAs(alice)(`/files/${id}/share`, {
      method: "POST",
      body: { workspaceId: workspace.id },
    });
    const url = shared.json.publicUrl as string;
    expect(url).toMatch(/\/api\/files\/public\/[A-Za-z0-9_-]{32}$/);

    const opened = await openPublic(url);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("content-type")).toBe("image/png");
    expect(await opened.text()).toBe("PNGDATA");

    await requestAs(alice)(`/files/${id}/share?workspaceId=${workspace.id}`, {
      method: "DELETE",
    });
    expect((await openPublic(url)).status).toBe(404);
  });

  it("serves active content as a download, never inline", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const file = await upload(
      user,
      workspace.id,
      "page.html",
      "<script>alert(1)</script>",
      "",
      "text/html",
    );
    const shared = await requestAs(user)(`/files/${file.json.id}/share`, {
      method: "POST",
      body: { workspaceId: workspace.id },
    });
    const opened = await openPublic(shared.json.publicUrl);
    expect(opened.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(opened.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("never serves script-capable types as themselves", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const file = await upload(
      user,
      workspace.id,
      "logo.svg",
      "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
      "",
      "image/svg+xml",
    );
    const shared = await requestAs(user)(`/files/${file.json.id}/share`, {
      method: "POST",
      body: { workspaceId: workspace.id },
    });
    const opened = await openPublic(shared.json.publicUrl);
    expect(opened.headers.get("content-type")).toBe("application/octet-stream");
    expect(opened.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(opened.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("refuses storage endpoints inside the server's network", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    for (const endpoint of [
      "http://example.com",
      "https://127.0.0.1:9000",
      "https://169.254.169.254",
      "https://localhost",
    ]) {
      const response = await requestAs(user)("/files/storage/account", {
        method: "PUT",
        body: {
          endpoint,
          bucket: "b",
          accessKeyId: "k",
          secretAccessKey: "s",
        },
      });
      expect(response.status, endpoint).toBe(400);
    }
  });

  it("lets admins delete other people's files, audit logged", async () => {
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    const alice = await addWorkspaceMember(workspace.id, "member");
    const bob = await addWorkspaceMember(workspace.id, "member");
    const file = await upload(alice, workspace.id, "a.txt", "x");
    const path = `/files/${file.json.id}?workspaceId=${workspace.id}`;

    expect((await requestAs(bob)(path, { method: "DELETE" })).status).toBe(403);
    expect((await requestAs(owner)(path, { method: "DELETE" })).status).toBe(
      200,
    );
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "file.deleted"));
    expect(audit).toHaveLength(1);
  });

  it("shows admins the owner's account bucket without its keys", async () => {
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
      userName: "Olivia",
    });
    const admin = await addWorkspaceMember(workspace.id, "admin", "Adam");
    const status = () =>
      requestAs(admin)(`/files/storage?workspaceId=${workspace.id}`);

    expect((await status()).json).toMatchObject({
      connected: false,
      source: null,
      ownerName: "Olivia",
    });

    await db.insert(schema.userStorageTable).values({
      userId: owner.id,
      endpoint: "https://acct.r2.cloudflarestorage.com",
      bucket: "olivia-files",
      accessKeyId: "AKIA-owner",
      secretAccessKey: "enc:v1:not-a-real-secret",
    });
    const connected = (await status()).json;
    expect(connected).toMatchObject({
      connected: true,
      source: "account",
      bucket: "olivia-files",
      ownerName: "Olivia",
      accessKeyId: null,
    });

    // The owner sees their own settings, keys included (never the secret).
    const mine = await requestAs(owner)("/files/storage/account");
    expect(mine.json).toMatchObject({
      connected: true,
      accessKeyId: "AKIA-owner",
    });
    expect(JSON.stringify(mine.json)).not.toContain("not-a-real-secret");
  });

  it("moves workspace buckets to the owner's account without stranding files", async () => {
    const { readFileSync } = await import("node:fs");
    const { sql } = await import("drizzle-orm");
    const { user: owner, workspace: first } = await createWorkspaceMember({
      role: "owner",
    });
    const [second] = await db
      .insert(schema.workspaceTable)
      .values({
        id: `workspace-second-${Date.now()}`,
        name: "Second",
        slug: `second-${Date.now()}`,
        createdAt: new Date(),
      })
      .returning();
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: second.id,
      userId: owner.id,
      role: "owner",
      joinedAt: new Date(),
    });
    const bucketRow = (workspaceId: string, bucket: string, at: string) => ({
      workspaceId,
      endpoint: "https://acct.r2.cloudflarestorage.com",
      bucket,
      accessKeyId: "k",
      secretAccessKey: "enc:v1:x",
      updatedAt: new Date(at),
    });
    // Two different buckets: the newer moves, the older stays put.
    await db
      .insert(schema.workspaceStorageTable)
      .values([
        bucketRow(first.id, "old-bucket", "2026-01-01"),
        bucketRow(second.id, "new-bucket", "2026-06-01"),
      ]);
    const s3File = (workspaceId: string, key: string) => ({
      workspaceId,
      uploadedBy: owner.id,
      filename: `${key}.txt`,
      mimeType: "text/plain",
      size: 1,
      storage: "s3",
      objectKey: key,
      kind: "file",
    });
    await db
      .insert(schema.storedFileTable)
      .values([s3File(first.id, "a"), s3File(second.id, "b")]);

    const migration = readFileSync(
      new URL("../../apps/api/drizzle/0067_empty_marvex.sql", import.meta.url),
      "utf8",
    );
    // The tables already exist in the test database; replay the data move.
    const dataPart = migration.slice(migration.indexOf("-- Move each"));
    for (const statement of dataPart.split("--> statement-breakpoint")) {
      if (statement.trim()) await db.execute(sql.raw(statement));
    }

    const [account] = await db.select().from(schema.userStorageTable);
    expect(account).toMatchObject({ userId: owner.id, bucket: "new-bucket" });
    const left = await db.select().from(schema.workspaceStorageTable);
    expect(left.map((r) => r.bucket)).toEqual(["old-bucket"]);
    const files = await db.select().from(schema.storedFileTable);
    const byKey = Object.fromEntries(
      files.map((f) => [f.objectKey, f.storageOwnerId]),
    );
    expect(byKey).toEqual({ a: null, b: owner.id });
  });

  it("refuses files over 10 MB until a bucket is connected", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    expect((await upload(user, workspace.id, "big.bin", big)).status).toBe(413);
  });
});

// Runs against any S3-compatible server (MinIO locally, R2 in real life)
// when S3_TEST_ENDPOINT and its keys are set.
// biome-ignore lint/suspicious/noUndeclaredEnvVars: optional, test-only
const endpoint = process.env.S3_TEST_ENDPOINT;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: optional, test-only
const accessKeyId = process.env.S3_TEST_ACCESS_KEY ?? "";
// biome-ignore lint/suspicious/noUndeclaredEnvVars: optional, test-only
const secretAccessKey = process.env.S3_TEST_SECRET_KEY ?? "";

describe.runIf(Boolean(endpoint))(
  "files (stored in an S3-compatible bucket)",
  () => {
    // MinIO runs on localhost, which the endpoint check refuses by default.
    beforeAll(() => {
      process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
    });
    afterAll(() => {
      // biome-ignore lint/suspicious/noUndeclaredEnvVars: set just above
      delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    });

    async function connectBucket(owner: User, workspaceId: string) {
      const bucket = `kaneo-test-${Date.now()}`;
      await new S3Client({
        endpoint,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      }).send(new CreateBucketCommand({ Bucket: bucket }));
      return requestAs(owner)("/files/storage/account", {
        method: "PUT",
        body: {
          endpoint,
          bucket,
          region: "us-east-1",
          accessKeyId,
          secretAccessKey,
        },
      });
    }

    it("tests the bucket, keeps the secret sealed, and stores files there", async () => {
      const { user: owner, workspace } = await createWorkspaceMember({
        role: "owner",
      });
      const member = await addWorkspaceMember(workspace.id, "member");

      const wrong = await requestAs(owner)("/files/storage/account", {
        method: "PUT",
        body: {
          endpoint,
          bucket: "does-not-exist-kaneo",
          accessKeyId,
          secretAccessKey,
        },
      });
      expect(wrong.status).toBe(400);

      const connected = await connectBucket(owner, workspace.id);
      expect(connected.json).toMatchObject({ connected: true, accessKeyId });
      expect(JSON.stringify(connected.json)).not.toContain(secretAccessKey);
      const [row] = await db.select().from(schema.userStorageTable);
      expect(row?.secretAccessKey.startsWith("enc:v1:")).toBe(true);

      // Only settings managers see or change storage.
      expect(
        (await requestAs(member)(`/files/storage?workspaceId=${workspace.id}`))
          .status,
      ).toBe(403);

      const file = await upload(
        member,
        workspace.id,
        "report.pdf",
        "%PDF-1.4 hi",
        "",
        "application/pdf",
      );
      expect(file.json).toMatchObject({ storage: "s3" });

      const shared = await requestAs(member)(`/files/${file.json.id}/share`, {
        method: "POST",
        body: { workspaceId: workspace.id },
      });
      const opened = await openPublic(shared.json.publicUrl);
      expect(opened.status).toBe(302);
      const signed = opened.headers.get("location") ?? "";
      const fetched = await fetch(signed);
      expect(await fetched.text()).toBe("%PDF-1.4 hi");

      // Files still in the bucket keep it connected.
      expect(
        (
          await requestAs(owner)("/files/storage/account", {
            method: "DELETE",
          })
        ).status,
      ).toBe(409);
      await requestAs(member)(
        `/files/${file.json.id}?workspaceId=${workspace.id}`,
        {
          method: "DELETE",
        },
      );
      expect(
        (
          await requestAs(owner)("/files/storage/account", {
            method: "DELETE",
          })
        ).status,
      ).toBe(200);
    });
  },
);

describe("file permission migration", () => {
  it("grants members upload and admins manage, once", async () => {
    const { readFileSync } = await import("node:fs");
    const { sql } = await import("drizzle-orm");
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceRoleTable).values([
      { workspaceId: workspace.id, role: "member", permission: "{}" },
      { workspaceId: workspace.id, role: "admin", permission: "{}" },
      { workspaceId: workspace.id, role: "viewer", permission: "{}" },
      {
        workspaceId: workspace.id,
        role: "manager",
        permission: JSON.stringify({ file: [] }),
      },
    ]);
    const file = new URL(
      "../../apps/api/drizzle/0051_grant_file_permissions.sql",
      import.meta.url,
    );
    await db.execute(sql.raw(readFileSync(file, "utf8")));
    await db.execute(sql.raw(readFileSync(file, "utf8")));

    const rows = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
    const by = Object.fromEntries(
      rows.map((r) => [r.role, JSON.parse(r.permission)]),
    );
    expect(by.member).toEqual({ file: ["upload"] });
    expect(by.admin).toEqual({ file: ["upload", "manage"] });
    expect(by.viewer).toEqual({});
    // An owner who already decided keeps their choice.
    expect(by.manager).toEqual({ file: [] });
  });
});
