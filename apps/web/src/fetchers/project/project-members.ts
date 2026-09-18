import { client } from "@kaneo/libs";

async function read<T>(response: {
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

export async function getProjectMembers(projectId: string) {
  return read(
    await client.project[":id"].members.$get({ param: { id: projectId } }),
  );
}

export async function addProjectMember(projectId: string, userId: string) {
  return read(
    await client.project[":id"].members.$post({
      param: { id: projectId },
      json: { userId },
    }),
  );
}

export async function removeProjectMember(projectId: string, userId: string) {
  return read(
    await client.project[":id"].members[":userId"].$delete({
      param: { id: projectId, userId },
    }),
  );
}
