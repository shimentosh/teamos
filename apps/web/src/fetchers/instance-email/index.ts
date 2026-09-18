import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";

export type InstanceEmailSettings = InferResponseType<
  (typeof client)["instance"]["email"]["$get"],
  200
>;
export type EmailTemplate = InferResponseType<
  (typeof client)["email-templates"]["$get"],
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

export const instanceEmailApi = {
  get: async () => unwrap(await client.instance.email.$get()),
  save: async (json: { resendApiKey?: string; from: string }) =>
    unwrap(await client.instance.email.$put({ json })),
  clear: async () => unwrap(await client.instance.email.$delete()),
  test: async () => unwrap(await client.instance.email.test.$post()),
};

export const emailTemplatesApi = {
  list: async () => unwrap(await client["email-templates"].$get()),
  sendTest: async (type: string) =>
    unwrap(
      await client["email-templates"][":type"].send.$post({ param: { type } }),
    ),
  preview: async (type: string) =>
    unwrap(await client["email-templates"][":type"].$get({ param: { type } })),
};
