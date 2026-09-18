import type { Schedule } from "../company/schedule";
import {
  addDays,
  isoWeekday,
  zonedDay,
  zonedInstant,
} from "../company/zoned-time";

/**
 * The reminder ladder for a task that has a due date and an assignee. A due
 * date is a calendar day in the company's time zone, and every step lands
 * inside the assignee's working hours:
 *
 *   before     start of the workday that many days before (their lead
 *              time, default a day), "Due tomorrow"
 *   today      start of the due day, "Due today" (skipped on days off)
 *   last call  two hours before the due day ends (skipped on days off)
 *   overdue    start of the next workday, "Overdue"
 *   escalate   start of the third workday late: the assignee again, and
 *              their managers, so nothing stays stuck quietly
 *   weekly     every seven days after that, until it's done or moved
 *
 * Each step is sent once per due day (moving the due date starts the ladder
 * again), and only if it's no older than CATCH_UP, so a restart never
 * floods people with old reminders.
 */

const HOUR_MS = 60 * 60 * 1000;
const CATCH_UP_MS = 12 * HOUR_MS;
const LAST_CALL_MS = 2 * HOUR_MS;
const ESCALATE_AFTER_WORKDAYS = 3;

type NotificationType =
  | "due_date_reminder"
  | "task_due_today"
  | "task_due_soon"
  | "task_overdue";

export type Stage = {
  key: string;
  type: NotificationType;
  at: Date;
  daysOverdue: number;
  escalate: boolean;
};

/** The workday `count` workdays after `day` (skips days off). */
function workdayAfter(day: string, count: number, workDays: number[]) {
  if (workDays.length === 0) return addDays(day, count);
  let current = day;
  let left = count;
  for (let i = 0; i < 60 && left > 0; i++) {
    current = addDays(current, 1);
    if (workDays.includes(isoWeekday(current))) left--;
  }
  return current;
}

/** `day` if it's a workday, else the next one. */
function onOrAfterWorkday(day: string, workDays: number[]) {
  if (workDays.length === 0 || workDays.includes(isoWeekday(day))) return day;
  return workdayAfter(day, 1, workDays);
}

/** The workday `count` workdays before `day`. */
function workdayBefore(day: string, count: number, workDays: number[]) {
  if (workDays.length === 0) return addDays(day, -count);
  let current = day;
  let left = count;
  for (let i = 0; i < 60 && left > 0; i++) {
    current = addDays(current, -1);
    if (workDays.includes(isoWeekday(current))) left--;
  }
  return current;
}

/**
 * The calendar day a due date means. Browsers save the picked day as local
 * midnight (and some clients as noon), which can sit on the previous day in
 * the company's zone. Rounding to the nearest midnight there gives the day
 * the person picked whenever the two zones are less than 12 hours apart.
 */
export function dueDayOf(dueDate: Date, timeZone: string) {
  return zonedDay(new Date(dueDate.getTime() + 12 * HOUR_MS), timeZone);
}

const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      (24 * HOUR_MS),
  );

/** Every step for a task due on `dueDay`, with when it should go out. */
export function reminderStages(input: {
  dueDay: string;
  today: string;
  schedule: Schedule;
  timeZone: string;
  leadTimeMinutes: number;
}): Stage[] {
  const { dueDay, today, schedule, timeZone } = input;
  const at = (day: string, time: string) => zonedInstant(day, time, timeZone);
  const dayStart = at(dueDay, schedule.workStart);
  const dayEnd = at(dueDay, schedule.workEnd);
  const lastCall = new Date(
    Math.max(dayEnd.getTime() - LAST_CALL_MS, dayStart.getTime() + HOUR_MS),
  );
  const overdueDay = workdayAfter(dueDay, 1, schedule.workDays);
  const escalateDay = workdayAfter(
    dueDay,
    ESCALATE_AFTER_WORKDAYS,
    schedule.workDays,
  );

  const stages: Stage[] = [];
  // Lead times are whole workdays ahead; anything shorter than a day is
  // already covered by "today" and "last call".
  const leadDays = Math.round(input.leadTimeMinutes / (24 * 60));
  if (leadDays >= 1) {
    stages.push({
      key: `before:${dueDay}`,
      type: "due_date_reminder",
      at: at(
        workdayBefore(dueDay, leadDays, schedule.workDays),
        schedule.workStart,
      ),
      daysOverdue: 0,
      escalate: false,
    });
  }
  // Due on a day off: nobody's at work, so it goes straight to "overdue"
  // on the next workday.
  if (isWorkday(schedule, dueDay)) {
    stages.push(
      {
        key: `today:${dueDay}`,
        type: "task_due_today",
        at: dayStart,
        daysOverdue: 0,
        escalate: false,
      },
      {
        key: `last:${dueDay}`,
        type: "task_due_soon",
        at: lastCall,
        daysOverdue: 0,
        escalate: false,
      },
    );
  }
  stages.push(
    {
      key: `overdue:${dueDay}`,
      type: "task_overdue",
      at: at(overdueDay, schedule.workStart),
      daysOverdue: daysBetween(dueDay, overdueDay),
      escalate: false,
    },
    {
      key: `escalate:${dueDay}`,
      type: "task_overdue",
      at: at(escalateDay, schedule.workStart),
      daysOverdue: daysBetween(dueDay, escalateDay),
      escalate: true,
    },
  );
  // The most recent weekly step, if a week or more has gone by.
  const weeks = Math.floor(daysBetween(dueDay, today) / 7);
  if (weeks >= 1) {
    const weekDay = onOrAfterWorkday(
      addDays(dueDay, weeks * 7),
      schedule.workDays,
    );
    if (weekDay > escalateDay) {
      stages.push({
        key: `weekly:${dueDay}:${weeks}`,
        type: "task_overdue",
        at: at(weekDay, schedule.workStart),
        daysOverdue: daysBetween(dueDay, weekDay),
        escalate: false,
      });
    }
  }
  return stages;
}

/** Steps whose time has come and that aren't too old to still be useful. */
export function dueStages(stages: Stage[], now: Date) {
  return stages.filter((stage) => {
    const age = now.getTime() - stage.at.getTime();
    return age >= 0 && age <= CATCH_UP_MS;
  });
}

/**
 * The weekday a work week starts on: the first workday after the longest
 * run of days off (Sunday for Sunday–Thursday, Monday for Monday–Friday or
 * Monday/Wednesday/Friday). Monday when there are no days off.
 */
export function workWeekStart(workDays: number[]) {
  const works = (weekday: number) =>
    workDays.length === 0 || workDays.includes(weekday);
  let best = 1;
  let longest = 0;
  for (let weekday = 1; weekday <= 7; weekday++) {
    if (!works(weekday)) continue;
    let off = 0;
    for (let back = 1; back < 7; back++) {
      const previous = ((weekday - back - 1 + 7) % 7) + 1;
      if (works(previous)) break;
      off++;
    }
    if (off > longest) {
      longest = off;
      best = weekday;
    }
  }
  return best;
}

/** The first workday of the person's work week: once a week, never more. */
export function startsWorkWeek(schedule: Schedule, day: string) {
  return (
    isWorkday(schedule, day) &&
    isoWeekday(day) === workWeekStart(schedule.workDays)
  );
}

/** True during working hours on a workday, in the company's time zone. */
export function withinWorkHours(
  now: Date,
  schedule: Schedule,
  timeZone: string,
) {
  const day = zonedDay(now, timeZone);
  if (!isWorkday(schedule, day)) return false;
  const start = zonedInstant(day, schedule.workStart, timeZone).getTime();
  const end = zonedInstant(day, schedule.workEnd, timeZone).getTime();
  return now.getTime() >= start && now.getTime() <= end;
}

export const isWorkday = (schedule: Schedule, day: string) =>
  schedule.workDays.length === 0 || schedule.workDays.includes(isoWeekday(day));

/** Workdays after `from` up to and including `to`. */
export function workdaysBetween(from: string, to: string, workDays: number[]) {
  let count = 0;
  let day = from;
  for (let i = 0; i < 400 && day < to; i++) {
    day = addDays(day, 1);
    if (workDays.length === 0 || workDays.includes(isoWeekday(day))) count++;
  }
  return count;
}
