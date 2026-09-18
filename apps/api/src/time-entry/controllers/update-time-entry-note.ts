import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";

/** Sets what was done and what it was for, leaving the times alone. */
async function updateTimeEntryNote(
  timeEntryId: string,
  note: { description?: string; reference?: string | null },
) {
  const [updated] = await db
    .update(timeEntryTable)
    .set({
      ...(note.description !== undefined && { description: note.description }),
      ...(note.reference !== undefined && { reference: note.reference }),
    })
    .where(eq(timeEntryTable.id, timeEntryId))
    .returning();
  if (!updated) {
    throw new HTTPException(404, { message: "Time entry not found" });
  }
  return updated;
}

export default updateTimeEntryNote;
