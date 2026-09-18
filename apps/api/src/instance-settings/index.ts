import {
  deliverEmail,
  emailFrom,
  emailProvider,
  setEmailSettings,
} from "@kaneo/email";
import { eq, inArray } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { instanceSettingTable, userTable } from "../database/schema";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  nullableResponseTimestamp,
  z,
} from "../openapi";
import { isInstanceAdmin } from "../utils/is-instance-admin";
import { openSecret, sealSecret } from "../utils/secret-box";

const KEYS = {
  resendApiKey: "email.resendApiKey",
  from: "email.from",
} as const;

/**
 * A key sealed with a secret the server no longer has can't be opened;
 * treat it as unset so email falls back to the environment instead of
 * failing every read.
 */
function readKey(sealed: string) {
  try {
    return openSecret(sealed);
  } catch (error) {
    console.error("Saved Resend API key can't be decrypted", error);
    return null;
  }
}

async function readEmailSettings() {
  const rows = await db
    .select()
    .from(instanceSettingTable)
    .where(inArray(instanceSettingTable.key, Object.values(KEYS)));
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const key = byKey.get(KEYS.resendApiKey);
  return {
    resendApiKey: key ? readKey(key.value) : null,
    from: byKey.get(KEYS.from)?.value ?? null,
    updatedAt: key?.updatedAt ?? byKey.get(KEYS.from)?.updatedAt ?? null,
    updatedBy: key?.updatedBy ?? byKey.get(KEYS.from)?.updatedBy ?? null,
  };
}

/** Hands saved settings to the email package, over the environment. */
export async function loadEmailSettings() {
  try {
    const saved = await readEmailSettings();
    setEmailSettings({
      RESEND_API_KEY: saved.resendApiKey ?? undefined,
      EMAIL_FROM: saved.from ?? undefined,
    });
  } catch (error) {
    // Before migrations run there's no table yet; env settings still work.
    console.error("Could not load email settings", error);
  }
}

// Other API instances pick up a change within a minute.
let refresh: ReturnType<typeof setInterval> | null = null;
export function watchEmailSettings() {
  void loadEmailSettings();
  refresh ??= setInterval(() => void loadEmailSettings(), 60_000);
  refresh.unref?.();
}

async function requireInstanceAdmin(c: Context, next: Next) {
  if (!(await isInstanceAdmin(c))) {
    throw new HTTPException(403, {
      message: "Only the instance admin can change this",
    });
  }
  return next();
}

async function status() {
  const saved = await readEmailSettings();
  const provider = emailProvider();
  const [editor] = saved.updatedBy
    ? await db
        .select({ name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, saved.updatedBy))
    : [];
  return {
    provider,
    // Where the working settings come from: this page or server env vars.
    source: saved.resendApiKey
      ? ("app" as const)
      : provider
        ? ("environment" as const)
        : null,
    from: emailFrom(),
    savedFrom: saved.from,
    resendKeyHint: saved.resendApiKey
      ? `…${saved.resendApiKey.slice(-4)}`
      : null,
    updatedAt: saved.updatedAt,
    updatedByName: editor?.name ?? null,
  };
}

const statusSchema = z
  .object({
    provider: z.enum(["resend", "smtp"]).nullable(),
    source: z.enum(["app", "environment"]).nullable(),
    from: z.string().nullable(),
    savedFrom: z.string().nullable(),
    resendKeyHint: z.string().nullable().openapi({
      description: "The last four characters; the key itself is never sent.",
    }),
    updatedAt: nullableResponseTimestamp,
    updatedByName: z.string().nullable(),
  })
  .openapi("InstanceEmailSettings");

const tags = ["Instance"];

const getRoute = createRoute({
  method: "get",
  operationId: "getInstanceEmailSettings",
  path: "/",
  tags,
  summary: "Email delivery settings",
  description:
    "How this server sends email. Settings saved here win over RESEND_API_KEY / EMAIL_FROM in the environment. Instance admin only.",
  middleware: [requireInstanceAdmin] as const,
  responses: {
    200: jsonResponse("Settings", statusSchema),
    403: errorResponse("Not the instance admin"),
  },
});

const saveRoute = createRoute({
  method: "put",
  operationId: "saveInstanceEmailSettings",
  path: "/",
  tags,
  summary: "Save Resend settings",
  description:
    "Leave the key empty to keep the saved one. The key is stored encrypted and never returned.",
  middleware: [requireInstanceAdmin] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            resendApiKey: z
              .string()
              .trim()
              .regex(/^re_[A-Za-z0-9_]{8,}$/, "That isn't a Resend API key")
              .optional(),
            from: z.string().trim().min(3).max(200).openapi({
              example: "TeamOS <notifications@example.com>",
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Settings", statusSchema),
    400: errorResponse("No key saved yet, or not a Resend key"),
    403: errorResponse("Not the instance admin"),
  },
});

const clearRoute = createRoute({
  method: "delete",
  operationId: "clearInstanceEmailSettings",
  path: "/",
  tags,
  summary: "Remove saved settings",
  description: "Email falls back to the environment variables, if any.",
  middleware: [requireInstanceAdmin] as const,
  responses: {
    200: jsonResponse("Settings", statusSchema),
    403: errorResponse("Not the instance admin"),
  },
});

const testRoute = createRoute({
  method: "post",
  operationId: "sendInstanceTestEmail",
  path: "/test",
  tags,
  summary: "Send a test email",
  description:
    "Sends one email to you right away, and reports the provider's answer.",
  middleware: [requireInstanceAdmin] as const,
  responses: {
    200: jsonResponse(
      "Sent",
      z.object({ to: z.string(), provider: z.string() }),
    ),
    400: errorResponse("Email is not set up, or the provider refused"),
    403: errorResponse("Not the instance admin"),
  },
});

const instanceEmail = apiRouter()
  .openapi(getRoute, async (c) => c.json(await status(), 200))
  .openapi(saveRoute, async (c) => {
    const { resendApiKey, from } = c.req.valid("json");
    const saved = await readEmailSettings();
    if (!resendApiKey && !saved.resendApiKey) {
      throw new HTTPException(400, { message: "Paste your Resend API key" });
    }
    const updatedBy = c.get("userId");
    const upsert = (key: string, value: string) =>
      db
        .insert(instanceSettingTable)
        .values({ key, value, updatedBy })
        .onConflictDoUpdate({
          target: instanceSettingTable.key,
          set: { value, updatedBy },
        });
    if (resendApiKey) await upsert(KEYS.resendApiKey, sealSecret(resendApiKey));
    await upsert(KEYS.from, from);
    await loadEmailSettings();
    return c.json(await status(), 200);
  })
  .openapi(clearRoute, async (c) => {
    await db
      .delete(instanceSettingTable)
      .where(inArray(instanceSettingTable.key, Object.values(KEYS)));
    await loadEmailSettings();
    return c.json(await status(), 200);
  })
  .openapi(testRoute, async (c) => {
    const [me] = await db
      .select({ email: userTable.email, name: userTable.name })
      .from(userTable)
      .where(eq(userTable.id, c.get("userId")));
    if (!me) throw new HTTPException(400, { message: "No email address" });
    try {
      const result = await deliverEmail({
        to: me.email,
        subject: "TeamOS test email",
        html: `<p>Hi ${me.name.replace(/[<>&]/g, "")},</p><p>Email from TeamOS works. Invitations, reminders and notifications will reach your team.</p>`,
        text: `Hi ${me.name},\n\nEmail from TeamOS works. Invitations, reminders and notifications will reach your team.`,
        tags: [{ name: "category", value: "test" }],
      });
      return c.json({ to: me.email, provider: result.provider }, 200);
    } catch (error) {
      throw new HTTPException(400, {
        message:
          error instanceof Error ? error.message : "The email was not sent",
      });
    }
  });

export default instanceEmail;
