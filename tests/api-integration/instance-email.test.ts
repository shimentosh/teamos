import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { addWorkspaceMember, requestAs } from "./helpers/company";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

async function makeInstanceAdmin(userId: string) {
  const [user] = await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, userId))
    .returning();
  return user;
}

describe("instance email settings", () => {
  it("lets only the instance admin save a Resend key, kept sealed", async () => {
    const { user: owner } = await createWorkspaceMember({ role: "owner" });
    const body = {
      resendApiKey: "re_test_abcdef12345678",
      from: "TeamOS <hi@example.com>",
    };

    // A workspace owner is not the instance admin.
    const refused = await requestAs(owner)("/instance/email", {
      method: "PUT",
      body,
    });
    expect(refused.status).toBe(403);

    const admin = await makeInstanceAdmin(owner.id);
    const saved = await requestAs(admin)("/instance/email", {
      method: "PUT",
      body,
    });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({
      provider: "resend",
      source: "app",
      from: "TeamOS <hi@example.com>",
      resendKeyHint: "…5678",
    });
    expect(JSON.stringify(saved.json)).not.toContain("abcdef");
    const [row] = await db
      .select()
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.key, "email.resendApiKey"));
    expect(row?.value.startsWith("enc:v1:")).toBe(true);

    const notAKey = await requestAs(admin)("/instance/email", {
      method: "PUT",
      body: { resendApiKey: "sk_live_nope", from: "a@b.co" },
    });
    expect(notAKey.status).toBe(400);

    const cleared = await requestAs(admin)("/instance/email", {
      method: "DELETE",
    });
    expect(cleared.json).toMatchObject({ source: null, resendKeyHint: null });
  });

  it("previews every email template with sample data", async () => {
    const { user } = await createWorkspaceMember({ role: "member" });
    const list = await requestAs(user)("/email-templates");
    expect(list.status).toBe(200);
    const types = list.json.map((t: { type: string }) => t.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "welcome",
        "chat_mention",
        "role_changed",
        "member_removed",
        "leave_requested",
        "payslip_ready",
      ]),
    );
    for (const type of types) {
      const preview = await requestAs(user)(`/email-templates/${type}`);
      expect(preview.status, type).toBe(200);
      // Rendering is stubbed here; packages/email tests the real HTML.
      expect(preview.json.html.length, type).toBeGreaterThan(0);
      expect(preview.json.subject.length, type).toBeGreaterThan(0);
    }
    const subjects = Object.fromEntries(
      list.json.map((t: { type: string; subject: string }) => [
        t.type,
        t.subject,
      ]),
    );
    expect(subjects).toMatchObject({
      welcome: "Welcome to TeamOS",
      chat_mention: "Tanvir Ahmed mentioned you in #design",
      role_changed: "You're now Manager in Acme Studio",
      member_removed: "You were removed from Acme Studio",
    });
    // Each email says where it belongs, who gets it and what turns it off.
    const byType = Object.fromEntries(
      list.json.map((t: { type: string }) => [t.type, t]),
    );
    expect(byType.magic_link).toMatchObject({
      section: "account",
      audience: "person",
      switchKey: null,
    });
    expect(byType.leave_requested).toMatchObject({
      section: "leave",
      audience: "approvers",
      switchKey: "leave_requested",
    });
    expect(byType.invitation).toMatchObject({ audience: "invitee" });
    expect((await requestAs(user)("/email-templates/nope")).status).toBe(404);

    // A test only ever goes to you, and needs email to be set up first.
    const noEmail = await requestAs(user)("/email-templates/welcome/send", {
      method: "POST",
    });
    expect(noEmail.status).toBe(400);
    expect(
      (await requestAs(user)("/email-templates/nope/send", { method: "POST" }))
        .status,
    ).toBe(404);
  });
});

describe("chat mentions", () => {
  it("notifies mentioned members of the conversation only", async () => {
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
      userName: "Olivia",
    });
    const inChannel = await addWorkspaceMember(workspace.id, "member", "Mia");
    const outside = await addWorkspaceMember(workspace.id, "member", "Omar");

    const channel = await requestAs(owner)("/chat/channels", {
      method: "POST",
      body: {
        workspaceId: workspace.id,
        name: "design",
        isPrivate: true,
        memberIds: [inChannel.id],
      },
    });
    expect(channel.status).toBe(200);

    const sent = await requestAs(owner)(`/chat/${channel.json.id}/messages`, {
      method: "POST",
      body: {
        workspaceId: workspace.id,
        body: `@[Mia](user:${inChannel.id}) and @[Omar](user:${outside.id}) and @[Olivia](user:${owner.id}) look`,
      },
    });
    expect(sent.status).toBe(200);

    // Mentions are sent in the background.
    let rows: (typeof schema.notificationTable.$inferSelect)[] = [];
    for (let i = 0; i < 20 && rows.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      rows = await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.type, "chat_mention"));
    }
    expect(rows.map((r) => r.userId)).toEqual([inChannel.id]);
    expect(rows[0]).toMatchObject({
      resourceType: "chat",
      resourceId: channel.json.id,
    });
  });
});
