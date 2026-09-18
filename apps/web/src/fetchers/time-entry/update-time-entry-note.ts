import { client } from "@kaneo/libs";

/** What was done and what for, without touching the entry's times. */
async function updateTimeEntryNote(
  id: string,
  note: { description?: string; reference?: string | null },
) {
  const response = await client["time-entry"][":id"].note.$patch({
    param: { id },
    json: note,
  });
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

export default updateTimeEntryNote;
