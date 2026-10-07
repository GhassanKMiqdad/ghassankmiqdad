import { describe, expect, it } from "vitest";

import { classifyTaskReminders, reminderNotificationId, utcDateParts } from "../../functions/src/reminder-logic";

describe("deadline reminder logic", () => {
  const today = "2026-10-06";
  const tomorrow = "2026-10-07";

  it("classifies assigned active tasks due tomorrow", () => {
    expect(
      classifyTaskReminders(
        { id: "t1", assigned_to: "u1", status: "in_progress", due_date: tomorrow },
        today,
        tomorrow,
      ),
    ).toEqual(["task_due_soon"]);
  });

  it("classifies assigned active tasks whose date has passed", () => {
    expect(
      classifyTaskReminders(
        { id: "t1", assigned_to: "u1", status: "revision_required", due_date: "2026-10-05" },
        today,
        tomorrow,
      ),
    ).toEqual(["task_overdue"]);
  });

  it("does not notify final states, unassigned work, or malformed dates", () => {
    expect(
      classifyTaskReminders({ id: "t1", assigned_to: "u1", status: "completed", due_date: tomorrow }, today, tomorrow),
    ).toEqual([]);
    expect(classifyTaskReminders({ id: "t1", status: "todo", due_date: tomorrow }, today, tomorrow)).toEqual([]);
    expect(
      classifyTaskReminders({ id: "t1", assigned_to: "u1", status: "todo", due_date: "tomorrow" }, today, tomorrow),
    ).toEqual([]);
  });

  it("uses UTC calendar dates and deterministic per-day notification IDs", () => {
    expect(utcDateParts(new Date("2026-10-06T23:59:00-07:00"))).toEqual({
      today: "2026-10-07",
      tomorrow: "2026-10-08",
    });
    expect(reminderNotificationId("task_due_soon", "task-1", "user-1", today)).toBe(
      "reminder_task_due_soon_task-1_user-1_2026-10-06",
    );
  });
});
