import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";

export type NotificationPolicy = InferResponseType<
  (typeof client)["notification-policy"]["$get"],
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

export const notificationPolicyApi = {
  list: async (workspaceId: string) =>
    unwrap(
      await client["notification-policy"].$get({ query: { workspaceId } }),
    ),
  set: async (
    workspaceId: string,
    key: string,
    rule: { inApp: boolean; email: boolean; locked: boolean },
  ) =>
    unwrap(
      await client["notification-policy"][":key"].$put({
        param: { key },
        json: { workspaceId, ...rule },
      }),
    ),
  reset: async (workspaceId: string, key: string) =>
    unwrap(
      await client["notification-policy"][":key"].$delete({
        param: { key },
        query: { workspaceId },
      }),
    ),
};
