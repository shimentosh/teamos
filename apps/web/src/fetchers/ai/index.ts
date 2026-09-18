import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";

export type AgentKey = InferResponseType<
  (typeof client)["ai"]["agent-keys"]["$get"],
  200
>[number];
export type AgentScope = AgentKey["scope"];
export type AiChangeSet = InferResponseType<
  (typeof client)["ai"]["change-sets"][":id"]["$get"],
  200
>;
export type AiTeammate = InferResponseType<
  (typeof client)["ai"]["teammates"]["$get"],
  200
>[number];
export type AiSettings = InferResponseType<
  (typeof client)["ai"]["settings"]["$get"],
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

export const aiApi = {
  connect: async () => unwrap(await client.ai.connect.$get()),
  keys: async () => unwrap(await client.ai["agent-keys"].$get()),
  create: async (json: { name?: string; scope: AgentScope }) =>
    unwrap(await client.ai["agent-keys"].$post({ json })),
  revoke: async (id: string) =>
    unwrap(await client.ai["agent-keys"][":id"].$delete({ param: { id } })),
  revokeAll: async () => unwrap(await client.ai["agent-keys"].$delete()),
  settings: async (workspaceId: string) =>
    unwrap(await client.ai.settings.$get({ query: { workspaceId } })),
  setSettings: async (json: {
    workspaceId: string;
    enabled: boolean;
    engine: "server" | "desktop";
  }) => unwrap(await client.ai.settings.$put({ json })),
  ask: async (json: {
    workspaceId: string;
    prompt: string;
    context?: { projectId?: string; taskId?: string; page?: string };
  }) => unwrap(await client.ai.ask.$post({ json })),
  changeSet: async (workspaceId: string, id: string) =>
    unwrap(
      await client.ai["change-sets"][":id"].$get({
        param: { id },
        query: { workspaceId },
      }),
    ),
  apply: async (workspaceId: string, id: string, actions: number[]) =>
    unwrap(
      await client.ai["change-sets"][":id"].apply.$post({
        param: { id },
        json: { workspaceId, actions },
      }),
    ),
  undo: async (workspaceId: string, id: string) =>
    unwrap(
      await client.ai["change-sets"][":id"].undo.$post({
        param: { id },
        json: { workspaceId },
      }),
    ),
  teammates: async (workspaceId: string) =>
    unwrap(await client.ai.teammates.$get({ query: { workspaceId } })),
  saveTeammate: async (
    workspaceId: string,
    kind: AiTeammate["kind"],
    input: {
      enabled: boolean;
      instructions: string | null;
      time: string;
      days: string;
      mode: "suggest" | "act";
      channelId: string | null;
    },
  ) =>
    unwrap(
      await client.ai.teammates[":kind"].$put({
        param: { kind },
        json: { workspaceId, ...input },
      }),
    ),
  runTeammate: async (workspaceId: string, kind: AiTeammate["kind"]) =>
    unwrap(
      await client.ai.teammates[":kind"].run.$post({
        param: { kind },
        json: { workspaceId },
      }),
    ),
  discard: async (workspaceId: string, id: string) =>
    unwrap(
      await client.ai["change-sets"][":id"].discard.$post({
        param: { id },
        json: { workspaceId },
      }),
    ),
};
