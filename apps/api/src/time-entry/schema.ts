import { z } from "../openapi";

const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

// Date.parse alone accepts impossible calendar dates like 2024-02-31, so the
// round-trip through UTC getters rejects anything the calendar rolled over.
function isIsoTimestamp(value: string) {
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export const timestamp = z
  .string()
  .refine(isIsoTimestamp, "Expected an ISO 8601 timestamp")
  .openapi({ format: "date-time", example: "2026-01-31T09:00:00Z" });

export const taskIdParam = z.object({ taskId: z.string() });

export const timeEntryParam = z.object({ id: z.string() });

export const createTimeEntryBody = z.object({
  taskId: z.string(),
  startTime: timestamp,
  endTime: timestamp.optional().openapi({
    description: "Omit to start an open-ended entry that is still running.",
  }),
  description: z.string().optional(),
});

// A link or a plain reference ("PR #42", "JIRA-12"). Anything with a URL
// scheme must be http(s), so it can never become a javascript: link.
export const timeEntryReference = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) =>
      !/^[a-z][a-z0-9+.-]*:/i.test(value) || /^https?:\/\//i.test(value),
    { message: "Links must start with http:// or https://" },
  )
  .openapi({ example: "https://github.com/acme/app/pull/42" });

export const stopTimeEntryBody = z.object({
  description: z.string().trim().max(1000).optional().openapi({
    description: "What was done; replaces the entry's note when given.",
  }),
  reference: timeEntryReference.optional(),
});

export const timeEntryNoteBody = z.object({
  description: z.string().trim().max(1000).optional(),
  reference: timeEntryReference.nullable().optional().openapi({
    description: "Null or empty clears it.",
  }),
});

export const updateTimeEntryBody = z.object({
  startTime: timestamp,
  endTime: timestamp.optional(),
  description: z.string().optional(),
});

// Bounds a single timesheet request; a quarter is plenty for the UI and export.
const MAX_RANGE_DAYS = 92;

export const listTimeEntriesQuery = z
  .object({
    workspaceId: z.string(),
    from: timestamp.openapi({ description: "Inclusive start of the range." }),
    to: timestamp.openapi({ description: "Exclusive end of the range." }),
    userId: z.string().optional().openapi({
      description:
        "Only this person's entries. Other people's entries need timeEntry:read_all; without it the list is limited to your own.",
    }),
    projectId: z.string().optional(),
  })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), {
    message: "`to` must be after `from`",
    path: ["to"],
  })
  .refine(
    (q) =>
      Date.parse(q.to) - Date.parse(q.from) <=
      MAX_RANGE_DAYS * 24 * 60 * 60 * 1000,
    {
      message: `The range can be at most ${MAX_RANGE_DAYS} days`,
      path: ["to"],
    },
  );

export const runningTimeEntryQuery = z.object({ workspaceId: z.string() });
