import { client } from "@kaneo/libs";

// The route reads an optional `{ description, reference }` body by hand, so
// the typed client doesn't know about it; pass it through the request init.
async function stopTimeEntry(
  id: string,
  description?: string,
  reference?: string,
) {
  const note = description?.trim();
  const ref = reference?.trim();
  const response = await client["time-entry"][":id"].stop.$post(
    { param: { id } },
    note || ref
      ? {
          init: {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(note && { description: note }),
              ...(ref && { reference: ref }),
            }),
          },
        }
      : undefined,
  );

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

export default stopTimeEntry;
