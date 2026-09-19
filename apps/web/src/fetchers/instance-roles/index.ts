import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";

export type InstanceRole = InferResponseType<
  (typeof client)["instance"]["roles"]["$get"],
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

export const instanceRolesApi = {
  list: async () => unwrap(await client.instance.roles.$get()),
  create: async (json: {
    role: string;
    permission: Record<string, string[]>;
  }) => unwrap(await client.instance.roles.$post({ json })),
  update: async ({
    role,
    permission,
  }: {
    role: string;
    permission: Record<string, string[]>;
  }) =>
    unwrap(
      await client.instance.roles[":role"].$patch({
        param: { role },
        json: { permission },
      }),
    ),
  remove: async (role: string) =>
    unwrap(await client.instance.roles[":role"].$delete({ param: { role } })),
};
