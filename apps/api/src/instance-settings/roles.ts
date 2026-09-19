import { DEFAULT_ROLE_NAMES, statement } from "@kaneo/permissions";
import { asc, count, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  responseTimestamp,
  z,
} from "../openapi";
import { requireInstanceAdmin } from "../utils/require-instance-admin";
import { syncWorkspaceRoleMirror } from "../utils/sync-workspace-role-mirror";

const tags = ["Instance"];

// `owner` is a static Better Auth role, not a catalog row, so it can never be
// edited or deleted here. The built-in names are editable but reserved: they
// are what an unseeded install falls back to.
const RESERVED_NAMES = new Set<string>([...DEFAULT_ROLE_NAMES, "owner"]);

// Same ceiling Better Auth applies per organization, so the mirror can never
// overflow it.
const MAX_ROLES = 25;

const ROLE_NAME = /^[a-z0-9][a-z0-9_-]{0,38}[a-z0-9]$/;

const permissionSchema = z
  .record(z.string(), z.array(z.string()))
  .openapi({ description: "Granted actions by resource." });

const instanceRoleSchema = z
  .object({
    id: z.string(),
    role: z.string(),
    permission: permissionSchema,
    isDefault: z.boolean().openapi({
      description: "A built-in name: editable, but reserved and undeletable.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("InstanceRole");

const instanceRoleListSchema = z
  .array(instanceRoleSchema)
  .openapi("InstanceRoleList");

const roleParam = z.object({
  role: z.string().openapi({ param: { name: "role", in: "path" } }),
});

function parsePermission(raw: string): Record<string, string[]> {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, string[]> = {};
    for (const [resource, actions] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (Array.isArray(actions)) {
        out[resource] = actions.filter(
          (action): action is string => typeof action === "string",
        );
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Keeps only resources and actions the permission vocabulary actually defines,
 * so a typo cannot create a permission nothing will ever check — and a crafted
 * payload cannot smuggle in a resource the UI hides.
 */
function sanitizePermission(
  input: Record<string, string[]>,
): Record<string, string[]> {
  const vocabulary = statement as Record<string, readonly string[]>;
  const out: Record<string, string[]> = {};

  for (const [resource, actions] of Object.entries(input)) {
    const known = vocabulary[resource];
    if (!known) continue;
    const kept = [...new Set(actions)].filter((action) =>
      known.includes(action),
    );
    if (kept.length > 0) out[resource] = kept;
  }

  return out;
}

function toResponse(row: typeof schema.instanceRoleTable.$inferSelect) {
  return {
    id: row.id,
    role: row.role,
    permission: parsePermission(row.permission),
    isDefault: (DEFAULT_ROLE_NAMES as readonly string[]).includes(row.role),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listRoles() {
  const rows = await db
    .select()
    .from(schema.instanceRoleTable)
    .orderBy(asc(schema.instanceRoleTable.role));
  return rows.map(toResponse);
}

async function findRole(role: string) {
  const [row] = await db
    .select()
    .from(schema.instanceRoleTable)
    .where(eq(schema.instanceRoleTable.role, role))
    .limit(1);
  return row ?? null;
}

const listRoute = createRoute({
  method: "get",
  operationId: "listInstanceRoles",
  path: "/",
  tags,
  summary: "List roles",
  description:
    "The instance-wide role catalog. One definition per role name, used by every workspace. Instance admin only.",
  middleware: [requireInstanceAdmin] as const,
  responses: {
    200: jsonResponse("The role catalog", instanceRoleListSchema),
    403: errorResponse("Not an instance admin"),
  },
});

const createRoleRoute = createRoute({
  method: "post",
  operationId: "createInstanceRole",
  path: "/",
  tags,
  summary: "Create a role",
  description:
    "Adds a role to the catalog. Unknown resources and actions are dropped. Instance admin only.",
  middleware: [requireInstanceAdmin] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            role: z.string(),
            permission: permissionSchema,
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("The new role", instanceRoleSchema),
    400: errorResponse("Invalid or reserved name, or the catalog is full"),
    403: errorResponse("Not an instance admin"),
    409: errorResponse("A role with that name already exists"),
  },
});

const updateRoleRoute = createRoute({
  method: "patch",
  operationId: "updateInstanceRole",
  path: "/{role}",
  tags,
  summary: "Change what a role may do",
  description:
    "Replaces the role's permissions everywhere at once. Instance admin only.",
  middleware: [requireInstanceAdmin] as const,
  request: {
    params: roleParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ permission: permissionSchema }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("The updated role", instanceRoleSchema),
    403: errorResponse("Not an instance admin"),
    404: errorResponse("No such role"),
  },
});

const deleteRoleRoute = createRoute({
  method: "delete",
  operationId: "deleteInstanceRole",
  path: "/{role}",
  tags,
  summary: "Delete a role",
  description:
    "Removes a role from the catalog and from every workspace. Refused while anyone still holds it, and for the built-in names. Instance admin only.",
  middleware: [requireInstanceAdmin] as const,
  request: { params: roleParam },
  responses: {
    200: jsonResponse("The remaining catalog", instanceRoleListSchema),
    400: errorResponse("A built-in role, or still in use"),
    403: errorResponse("Not an instance admin"),
    404: errorResponse("No such role"),
  },
});

/** How many people hold this role in any workspace. */
async function holdersOf(role: string): Promise<number> {
  const members = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable);

  return members.filter((member) =>
    member.role
      .split(",")
      .map((name) => name.trim())
      .includes(role),
  ).length;
}

const instanceRoles = apiRouter()
  .openapi(listRoute, async (c) => c.json(await listRoles(), 200))
  .openapi(createRoleRoute, async (c) => {
    const body = c.req.valid("json");
    const role = body.role.trim().toLowerCase();

    if (!ROLE_NAME.test(role)) {
      throw new HTTPException(400, {
        message:
          "A role name is 2-40 characters: lowercase letters, numbers, dashes and underscores.",
      });
    }
    if (RESERVED_NAMES.has(role)) {
      throw new HTTPException(400, {
        message: `"${role}" is a built-in role. Edit it instead of creating it.`,
      });
    }
    if (await findRole(role)) {
      throw new HTTPException(409, {
        message: `A role called "${role}" already exists.`,
      });
    }

    const [total] = await db
      .select({ value: count() })
      .from(schema.instanceRoleTable);
    if ((total?.value ?? 0) >= MAX_ROLES) {
      throw new HTTPException(400, {
        message: `An instance can hold ${MAX_ROLES} roles.`,
      });
    }

    const [row] = await db
      .insert(schema.instanceRoleTable)
      .values({
        role,
        permission: JSON.stringify(sanitizePermission(body.permission)),
        updatedBy: c.get("userId"),
      })
      .returning();
    if (!row) {
      throw new HTTPException(500, { message: "Could not create the role." });
    }

    await syncWorkspaceRoleMirror();

    return c.json(toResponse(row), 200);
  })
  .openapi(updateRoleRoute, async (c) => {
    const { role } = c.req.valid("param");
    const { permission } = c.req.valid("json");

    if (!(await findRole(role))) {
      throw new HTTPException(404, { message: `No role called "${role}".` });
    }

    const [row] = await db
      .update(schema.instanceRoleTable)
      .set({
        permission: JSON.stringify(sanitizePermission(permission)),
        updatedBy: c.get("userId"),
      })
      .where(eq(schema.instanceRoleTable.role, role))
      .returning();
    if (!row) {
      throw new HTTPException(404, { message: `No role called "${role}".` });
    }

    await syncWorkspaceRoleMirror();

    return c.json(toResponse(row), 200);
  })
  .openapi(deleteRoleRoute, async (c) => {
    const { role } = c.req.valid("param");

    if (RESERVED_NAMES.has(role)) {
      throw new HTTPException(400, {
        message: `"${role}" is a built-in role and can't be deleted.`,
      });
    }
    if (!(await findRole(role))) {
      throw new HTTPException(404, { message: `No role called "${role}".` });
    }

    const holders = await holdersOf(role);
    if (holders > 0) {
      throw new HTTPException(400, {
        message: `${holders} ${holders === 1 ? "person still holds" : "people still hold"} this role. Move them to another role first.`,
      });
    }

    await db
      .delete(schema.instanceRoleTable)
      .where(eq(schema.instanceRoleTable.role, role));

    await syncWorkspaceRoleMirror();

    return c.json(await listRoles(), 200);
  });

export default instanceRoles;
