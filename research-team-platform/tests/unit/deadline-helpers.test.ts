import { describe, expect, it } from "vitest";

import {
  DEADLINE_ACTIVE_STATUSES,
  addCalendarDays,
  dateKeyInTimeZone,
  deadlineNotificationId,
} from "../../functions/src/deadline-helpers.js";

describe("scheduled deadline notification helpers", () => {
  it("uses the configured calendar timezone rather than UTC day boundaries", () => {
    expect(dateKeyInTimeZone(new Date("2026-10-05T00:30:00.000Z"), "America/New_York")).toBe("2026-10-04");
    expect(dateKeyInTimeZone(new Date("2026-10-05T12:30:00.000Z"), "UTC")).toBe("2026-10-05");
  });

  it("adds calendar days safely across month and year boundaries", () => {
    expect(addCalendarDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("creates stable IDs scoped to task, recipient, notice type and due date", () => {
    const first = deadlineNotificationId("task_overdue", "task/1", "researcher/1", "2026-10-04");
    expect(first).toBe(deadlineNotificationId("task_overdue", "task/1", "researcher/1", "2026-10-04"));
    expect(first).not.toContain("/");
    expect(first).not.toBe(deadlineNotificationId("task_overdue", "task/1", "researcher/2", "2026-10-04"));
    expect(first).not.toBe(deadlineNotificationId("deadline_approaching", "task/1", "researcher/1", "2026-10-04"));
  });

  it("excludes terminal tasks from deadline notifications", () => {
    expect(DEADLINE_ACTIVE_STATUSES).toContain("revision_required");
    expect(DEADLINE_ACTIVE_STATUSES).not.toContain("approved");
    expect(DEADLINE_ACTIVE_STATUSES).not.toContain("completed");
    expect(DEADLINE_ACTIVE_STATUSES).not.toContain("cancelled");
  });
});
