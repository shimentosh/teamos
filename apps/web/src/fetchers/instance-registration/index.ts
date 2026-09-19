import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";

export type InstanceRegistrationSettings = InferResponseType<
  (typeof client)["instance"]["registration"]["$get"],
  200
>;

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

export const instanceRegistrationApi = {
  get: async () => unwrap(await client.instance.registration.$get()),
  save: async (json: { disabled: boolean }) =>
    unwrap(await client.instance.registration.$put({ json })),
  clear: async () => unwrap(await client.instance.registration.$delete()),
};
