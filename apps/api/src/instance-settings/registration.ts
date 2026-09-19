import { eq } from "drizzle-orm";
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
import {
  REGISTRATION_KEY,
  readRegistrationOverride,
  registrationDisabledInEnv,
} from "../utils/registration-settings";
import { requireInstanceAdmin } from "../utils/require-instance-admin";

async function status() {
  const override = await readRegistrationOverride();
  const [editor] = override?.updatedBy
    ? await db
        .select({ name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, override.updatedBy))
    : [];

  return {
    disabled: override ? override.disabled : registrationDisabledInEnv(),
    // Whether the value in force comes from this page or DISABLE_REGISTRATION.
    source: override ? ("app" as const) : ("environment" as const),
    envDisabled: registrationDisabledInEnv(),
    updatedAt: override?.updatedAt ?? null,
    updatedByName: editor?.name ?? null,
  };
}

const statusSchema = z
  .object({
    disabled: z.boolean().openapi({
      description: "True when only invited people can create an account.",
    }),
    source: z.enum(["app", "environment"]),
    envDisabled: z.boolean().openapi({
      description: "What DISABLE_REGISTRATION says, for the reset option.",
    }),
    updatedAt: nullableResponseTimestamp,
    updatedByName: z.string().nullable(),
  })
  .openapi("InstanceRegistrationSettings");

const tags = ["Instance"];

const getRoute = createRoute({
  method: "get",
  operationId: "getInstanceRegistrationSettings",
  path: "/",
  tags,
  summary: "Registration settings",
  description:
    "Whether new people can sign up on this server. Saved here wins over DISABLE_REGISTRATION in the environment. Instance admin only.",
  middleware: [requireInstanceAdmin] as const,
  responses: {
    200: jsonResponse("Settings", statusSchema),
    403: errorResponse("Not the instance admin"),
  },
});

const saveRoute = createRoute({
  method: "put",
  operationId: "saveInstanceRegistrationSettings",
  path: "/",
  tags,
  summary: "Open or close registration",
  description:
    "When closed, an account can only be created from a valid workspace invitation. The first signup on an empty instance is always allowed, so a server can still be set up.",
  middleware: [requireInstanceAdmin] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            disabled: z.boolean(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Settings", statusSchema),
    403: errorResponse("Not the instance admin"),
  },
});

const clearRoute = createRoute({
  method: "delete",
  operationId: "clearInstanceRegistrationSettings",
  path: "/",
  tags,
  summary: "Follow the server setting again",
  description: "Registration falls back to DISABLE_REGISTRATION.",
  middleware: [requireInstanceAdmin] as const,
  responses: {
    200: jsonResponse("Settings", statusSchema),
    403: errorResponse("Not the instance admin"),
  },
});

const instanceRegistration = apiRouter()
  .openapi(getRoute, async (c) => c.json(await status(), 200))
  .openapi(saveRoute, async (c) => {
    const { disabled } = c.req.valid("json");
    const value = disabled ? "true" : "false";
    const updatedBy = c.get("userId");

    await db
      .insert(instanceSettingTable)
      .values({ key: REGISTRATION_KEY, value, updatedBy })
      .onConflictDoUpdate({
        target: instanceSettingTable.key,
        set: { value, updatedBy },
      });

    return c.json(await status(), 200);
  })
  .openapi(clearRoute, async (c) => {
    await db
      .delete(instanceSettingTable)
      .where(eq(instanceSettingTable.key, REGISTRATION_KEY));

    return c.json(await status(), 200);
  });

export default instanceRegistration;
