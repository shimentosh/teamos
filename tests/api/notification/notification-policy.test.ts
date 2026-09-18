import { describe, expect, it } from "vitest";
import { effectiveEventEnabled } from "../../../apps/api/src/notification-preferences/events";

const off = { inApp: false, email: false, locked: false };
const onLocked = { inApp: true, email: true, locked: true };

describe("workspace notification rules", () => {
  it("falls back to each person's switch when the workspace has no rule", () => {
    expect(effectiveEventEnabled("task_stuck", "email", null, null)).toBe(true);
    expect(
      effectiveEventEnabled(
        "task_stuck",
        "email",
        { eventSettings: { task_stuck: { email: false } } },
        null,
      ),
    ).toBe(false);
  });

  it("uses the workspace default until the person chooses", () => {
    expect(effectiveEventEnabled("daily_digest", "email", null, off)).toBe(
      false,
    );
    expect(
      effectiveEventEnabled(
        "daily_digest",
        "email",
        { eventSettings: { daily_digest: { email: true } } },
        off,
      ),
    ).toBe(true);
  });

  it("lets a locked rule decide for everyone", () => {
    const optedOut = { eventSettings: { payslip: { email: false } } };
    expect(effectiveEventEnabled("payslip", "email", optedOut, onLocked)).toBe(
      true,
    );
    expect(
      effectiveEventEnabled(
        "payslip",
        "inApp",
        { eventSettings: { payslip: { inApp: true } } },
        { ...off, locked: true },
      ),
    ).toBe(false);
  });

  it("keeps the old task switches ahead of a workspace default", () => {
    expect(
      effectiveEventEnabled(
        "task_due",
        "inApp",
        { dueDateReminderEnabled: false },
        { inApp: true, email: true, locked: false },
      ),
    ).toBe(false);
  });

  it("lets a workspace default turn off a task event the old switch left on", () => {
    expect(
      effectiveEventEnabled(
        "task_due",
        "inApp",
        { dueDateReminderEnabled: true },
        { inApp: false, email: true, locked: false },
      ),
    ).toBe(false);
  });
});
