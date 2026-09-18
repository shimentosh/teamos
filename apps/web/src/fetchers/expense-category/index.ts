import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";

export type ExpenseCategory = InferResponseType<
  (typeof client)["expense-category"]["$get"],
  200
>[number];

async function unwrap<T>(response: {
  ok: boolean;
  text: () => Promise<string>;
  json: () => Promise<T>;
}) {
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {}
    throw new Error(message);
  }
  return response.json();
}

export const expenseCategoryApi = {
  list: async (workspaceId: string) =>
    unwrap(await client["expense-category"].$get({ query: { workspaceId } })),
  create: async (workspaceId: string, name: string, icon?: string) =>
    unwrap(
      await client["expense-category"].$post({
        json: { workspaceId, name, ...(icon ? { icon } : {}) },
      }),
    ),
  setIcon: async (workspaceId: string, id: string, icon: string) =>
    unwrap(
      await client["expense-category"][":id"].$patch({
        param: { id },
        json: { workspaceId, icon },
      }),
    ),
  remove: async (workspaceId: string, id: string) =>
    unwrap(
      await client["expense-category"][":id"].$delete({
        param: { id },
        query: { workspaceId },
      }),
    ),
};
