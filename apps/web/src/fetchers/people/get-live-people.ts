import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";

export type LivePerson = InferResponseType<
  (typeof client)["people"]["live"]["$get"],
  200
>[number];

async function getLivePeople(workspaceId: string) {
  const response = await client.people.live.$get({ query: { workspaceId } });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export default getLivePeople;
