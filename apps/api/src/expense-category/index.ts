import { and, asc, count, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { expenseCategoryTable } from "../database/schema";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  responseTimestamp,
  z,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";

const tags = ["Expense categories"];
const workspaceQuery = z.object({ workspaceId: z.string() });
const idParam = z.object({ id: z.string() });
const json = <T>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

// A lucide icon name; the web app only offers a fixed set and falls back to
// a tag for anything it does not know.
const icon = z
  .string()
  .regex(/^[A-Z][A-Za-z0-9]{1,39}$/, "Unknown icon")
  .openapi({ example: "Plane" });

const categorySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    icon: z.string(),
    createdAt: responseTimestamp,
  })
  .openapi("ExpenseCategory");

const DEFAULTS = [
  { name: "Travel", icon: "Plane" },
  { name: "Meals", icon: "Utensils" },
  { name: "Equipment", icon: "Laptop" },
  { name: "Software", icon: "AppWindow" },
  { name: "Other", icon: "Tag" },
];

const columns = {
  id: expenseCategoryTable.id,
  name: expenseCategoryTable.name,
  icon: expenseCategoryTable.icon,
  createdAt: expenseCategoryTable.createdAt,
};

async function listCategories(workspaceId: string) {
  const rows = await db
    .select(columns)
    .from(expenseCategoryTable)
    .where(eq(expenseCategoryTable.workspaceId, workspaceId))
    .orderBy(asc(expenseCategoryTable.name));
  if (rows.length > 0) return rows;
  // First use: start with the usual five. The unique index makes two
  // concurrent first loads harmless.
  await db
    .insert(expenseCategoryTable)
    .values(DEFAULTS.map((d) => ({ ...d, workspaceId })))
    .onConflictDoNothing();
  return db
    .select(columns)
    .from(expenseCategoryTable)
    .where(eq(expenseCategoryTable.workspaceId, workspaceId))
    .orderBy(asc(expenseCategoryTable.name));
}

const manage = requireWorkspacePermission({ workspace: ["manage_settings"] });

const listRoute = createRoute({
  method: "get",
  operationId: "listExpenseCategories",
  path: "/",
  tags,
  summary: "Expense categories",
  description:
    "The categories people pick when filing an expense, by name. A workspace starts with Travel, Meals, Equipment, Software and Other.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: workspaceQuery },
  responses: { 200: jsonResponse("Categories", z.array(categorySchema)) },
});

const createCategoryRoute = createRoute({
  method: "post",
  operationId: "createExpenseCategory",
  path: "/",
  tags,
  summary: "Add a category",
  middleware: [workspaceAccess.fromBody(), manage] as const,
  request: {
    body: json(
      z.object({
        workspaceId: z.string(),
        name: z.string().trim().min(1).max(60),
        icon: icon.optional(),
      }),
    ),
  },
  responses: {
    200: jsonResponse("The category", categorySchema),
    403: errorResponse("Missing workspace:manage_settings"),
    409: errorResponse("A category with that name exists"),
  },
});

const updateCategoryRoute = createRoute({
  method: "patch",
  operationId: "updateExpenseCategory",
  path: "/{id}",
  tags,
  summary: "Change a category's icon",
  description:
    "Names are not renamed here: expenses keep the name they were filed with.",
  middleware: [workspaceAccess.fromBody(), manage] as const,
  request: {
    params: idParam,
    body: json(z.object({ workspaceId: z.string(), icon })),
  },
  responses: {
    200: jsonResponse("The category", categorySchema),
    403: errorResponse("Missing workspace:manage_settings"),
    404: errorResponse("Not found"),
  },
});

const deleteCategoryRoute = createRoute({
  method: "delete",
  operationId: "deleteExpenseCategory",
  path: "/{id}",
  tags,
  summary: "Remove a category",
  description:
    "It stops being offered; expenses already filed under it keep the name.",
  middleware: [workspaceAccess.fromQuery(), manage] as const,
  request: { params: idParam, query: workspaceQuery },
  responses: {
    200: jsonResponse("Removed", z.object({ id: z.string() })),
    403: errorResponse("Missing workspace:manage_settings"),
    409: errorResponse("It is the last category"),
  },
});

const inWorkspace = (id: string, workspaceId: string) =>
  and(
    eq(expenseCategoryTable.id, id),
    eq(expenseCategoryTable.workspaceId, workspaceId),
  );

const expenseCategory = apiRouter()
  .openapi(listRoute, async (c) =>
    c.json(await listCategories(c.req.valid("query").workspaceId), 200),
  )
  .openapi(createCategoryRoute, async (c) => {
    const { workspaceId, name, icon: iconName } = c.req.valid("json");
    const [created] = await db
      .insert(expenseCategoryTable)
      .values({
        workspaceId,
        name,
        icon: iconName ?? "Tag",
        createdBy: c.get("userId"),
      })
      .onConflictDoNothing()
      .returning(columns);
    if (!created) {
      throw new HTTPException(409, {
        message: "A category with that name already exists",
      });
    }
    return c.json(created, 200);
  })
  .openapi(updateCategoryRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { workspaceId, icon: iconName } = c.req.valid("json");
    const [updated] = await db
      .update(expenseCategoryTable)
      .set({ icon: iconName })
      .where(inWorkspace(id, workspaceId))
      .returning(columns);
    if (!updated) throw new HTTPException(404, { message: "Not found" });
    return c.json(updated, 200);
  })
  .openapi(deleteCategoryRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { workspaceId } = c.req.valid("query");
    // An empty list would be refilled with the defaults on the next load.
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(expenseCategoryTable)
      .where(eq(expenseCategoryTable.workspaceId, workspaceId));
    if (n <= 1) {
      throw new HTTPException(409, {
        message: "Keep at least one category",
      });
    }
    await db.delete(expenseCategoryTable).where(inWorkspace(id, workspaceId));
    return c.json({ id }, 200);
  });

export default expenseCategory;
