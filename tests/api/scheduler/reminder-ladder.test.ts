import { describe, expect, it } from "vitest";
import {
  dueDayOf,
  dueStages,
  reminderStages,
  startsWorkWeek,
  workdaysBetween,
} from "../../../apps/api/src/scheduler/reminder-ladder";

// Dhaka is UTC+6 with no DST, so local times read directly. Work 09:00–18:00,
// Sunday–Thursday (ISO 7, 1, 2, 3, 4): Friday and Saturday are off.
const schedule = {
  workDays: [7, 1, 2, 3, 4],
  workStart: "09:00",
  workEnd: "18:00",
  breakMinutes: 60,
};
const timeZone = "Asia/Dhaka";

// Due Thursday 2026-09-24.
const ladder = (today = "2026-09-24", leadTimeMinutes = 1440) =>
  reminderStages({
    dueDay: "2026-09-24",
    today,
    schedule,
    timeZone,
    leadTimeMinutes,
  });

const at = (key: string, stages = ladder()) =>
  stages.find((stage) => stage.key.startsWith(key))?.at.toISOString();

describe("due date reminder ladder", () => {
  it("lands every step inside working hours, in the company's time zone", () => {
    // 09:00 Dhaka = 03:00 UTC.
    expect(at("before")).toBe("2026-09-23T03:00:00.000Z");
    expect(at("today")).toBe("2026-09-24T03:00:00.000Z");
    // Two hours before 18:00 → 16:00 Dhaka.
    expect(at("last")).toBe("2026-09-24T10:00:00.000Z");
  });

  it("calls it overdue on the next workday, skipping the weekend", () => {
    const stages = ladder();
    // Thursday due → Friday and Saturday off → Sunday morning.
    expect(at("overdue", stages)).toBe("2026-09-27T03:00:00.000Z");
    expect(stages.find((s) => s.key.startsWith("overdue"))?.daysOverdue).toBe(
      3,
    );
    // Third workday late: Sun, Mon, Tue → Tuesday, and managers are told.
    const escalate = stages.find((s) => s.key.startsWith("escalate"));
    expect(escalate?.at.toISOString()).toBe("2026-09-29T03:00:00.000Z");
    expect(escalate?.escalate).toBe(true);
  });

  it("adds one weekly nudge per week once the escalation has passed", () => {
    expect(at("weekly", ladder("2026-10-01"))).toBe("2026-10-01T03:00:00.000Z");
    expect(ladder("2026-10-09").map((s) => s.key)).toContain(
      "weekly:2026-09-24:2",
    );
    expect(ladder("2026-09-26").some((s) => s.key.startsWith("weekly"))).toBe(
      false,
    );
  });

  it("counts the lead time in workdays, at the start of that workday", () => {
    // Two days before Thursday: Tuesday morning.
    expect(at("before", ladder(undefined, 2 * 1440))).toBe(
      "2026-09-22T03:00:00.000Z",
    );
    // Under a day: "today" and "last call" already cover it.
    expect(
      ladder(undefined, 3 * 60).some((s) => s.key.startsWith("before")),
    ).toBe(false);
    expect(ladder(undefined, 0).some((s) => s.key.startsWith("before"))).toBe(
      false,
    );
  });

  it("keys every step by due day, so a new due date starts over", () => {
    expect(ladder().every((stage) => stage.key.includes("2026-09-24"))).toBe(
      true,
    );
  });

  it("sends a step only once its time has come, and never stale ones", () => {
    const stages = ladder();
    const keys = (iso: string) =>
      dueStages(stages, new Date(iso)).map((s) => s.key.split(":")[0]);
    expect(keys("2026-09-23T02:59:00.000Z")).toEqual([]);
    expect(keys("2026-09-23T03:05:00.000Z")).toEqual(["before"]);
    // Past the 12-hour catch-up, a missed step is dropped, not sent late.
    expect(keys("2026-09-24T02:59:00.000Z")).toEqual([]);
    expect(keys("2026-09-24T03:05:00.000Z")).toEqual(["today"]);
    expect(keys("2026-09-24T10:05:00.000Z")).toEqual(["today", "last"]);
    // A week later (the ladder as it looks that day), only the weekly nudge.
    expect(
      dueStages(ladder("2026-10-01"), new Date("2026-10-01T03:05:00.000Z")).map(
        (s) => s.key,
      ),
    ).toEqual(["weekly:2026-09-24:1"]);
  });
});

describe("work week helpers", () => {
  const monFri = { ...schedule, workDays: [1, 2, 3, 4, 5] };

  it("counts only workdays between two days", () => {
    // Thursday → next Tuesday: Sun, Mon, Tue are workdays in Dhaka.
    expect(workdaysBetween("2026-09-24", "2026-09-29", schedule.workDays)).toBe(
      3,
    );
    expect(workdaysBetween("2026-09-24", "2026-09-24", schedule.workDays)).toBe(
      0,
    );
  });

  it("starts the work week on the first workday after a day off", () => {
    // Sunday in a Sunday–Thursday week, Monday in a Monday–Friday one.
    expect(startsWorkWeek(schedule, "2026-09-27")).toBe(true);
    expect(startsWorkWeek(schedule, "2026-09-28")).toBe(false);
    expect(startsWorkWeek(monFri, "2026-09-28")).toBe(true);
    expect(startsWorkWeek(monFri, "2026-09-27")).toBe(false);
    // Working every day: Mondays.
    const always = { ...schedule, workDays: [1, 2, 3, 4, 5, 6, 7] };
    expect(startsWorkWeek(always, "2026-09-28")).toBe(true);
    expect(startsWorkWeek(always, "2026-09-29")).toBe(false);
    // Monday/Wednesday/Friday: once a week, on Monday only.
    const mwf = { ...schedule, workDays: [1, 3, 5] };
    expect(startsWorkWeek(mwf, "2026-09-28")).toBe(true);
    expect(startsWorkWeek(mwf, "2026-09-30")).toBe(false);
    expect(startsWorkWeek(mwf, "2026-10-02")).toBe(false);
  });

  it("reads a due date as the day the person picked", () => {
    // Picked Sep 20 in Dubai (local midnight), company in London.
    expect(dueDayOf(new Date("2026-09-19T20:00:00Z"), "Europe/London")).toBe(
      "2026-09-20",
    );
    // Picked Sep 20 in London, company in Dhaka.
    expect(dueDayOf(new Date("2026-09-19T23:00:00Z"), "Asia/Dhaka")).toBe(
      "2026-09-20",
    );
  });

  it("skips due-today steps on a day off and goes straight to overdue", () => {
    // Due Friday, a day off in Dhaka.
    const keys = reminderStages({
      dueDay: "2026-09-25",
      today: "2026-09-25",
      schedule,
      timeZone,
      leadTimeMinutes: 1440,
    }).map((s) => s.key.split(":")[0]);
    expect(keys).toEqual(["before", "overdue", "escalate"]);
  });
});
