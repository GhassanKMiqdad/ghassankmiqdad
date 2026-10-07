import { describe, expect, it } from "vitest";

import {
  addDays,
  calculateDueAt,
  durationToMinutes,
  isoToZonedLocal,
  startOfWeek,
  taskCodePrefix,
  zonedLocalToIso,
} from "@/lib/schedule";

describe("schedule math (mirror of private.apply_task_schedule)", () => {
  it("normalizes durations to minutes", () => {
    expect(durationToMinutes(6, "hours")).toBe(360);
    expect(durationToMinutes(3, "days")).toBe(4320);
    expect(durationToMinutes(2, "weeks")).toBe(20160);
    expect(durationToMinutes(1.5, "days")).toBe(2160);
  });

  it("calculates the deadline as start + duration", () => {
    expect(calculateDueAt("2026-11-02T07:00:00.000Z", 3, "days")).toBe("2026-11-05T07:00:00.000Z");
    expect(calculateDueAt("2026-11-02T07:00:00.000Z", 6, "hours")).toBe("2026-11-02T13:00:00.000Z");
    expect(calculateDueAt("2026-11-02T07:00:00.000Z", 2, "weeks")).toBe("2026-11-16T07:00:00.000Z");
  });
});

describe("time zone conversion of form values", () => {
  it("interprets wall-clock input in the application time zone", () => {
    expect(zonedLocalToIso("2026-11-02T09:00", "Asia/Gaza")).toBe("2026-11-02T07:00:00.000Z");
    expect(zonedLocalToIso("2026-07-01T09:00", "Asia/Gaza")).toBe("2026-07-01T06:00:00.000Z");
    expect(zonedLocalToIso("2026-11-02T09:00", "UTC")).toBe("2026-11-02T09:00:00.000Z");
    expect(zonedLocalToIso("not a date", "UTC")).toBeNull();
  });

  it("round-trips instants back to wall-clock values", () => {
    expect(isoToZonedLocal("2026-11-02T07:00:00.000Z", "Asia/Gaza")).toBe("2026-11-02T09:00");
    expect(isoToZonedLocal(null, "Asia/Gaza")).toBe("");
  });
});

describe("calendar helpers", () => {
  it("adds days and finds the Monday of a week", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(startOfWeek("2026-10-07")).toBe("2026-10-05");
    expect(startOfWeek("2026-10-05")).toBe("2026-10-05");
    expect(startOfWeek("2026-10-11")).toBe("2026-10-05");
  });

  it("builds task ID prefixes like the database", () => {
    expect(taskCodePrefix(1, "GH", 1)).toBe("M01-GH-01-");
    expect(taskCodePrefix(12, null, null)).toBe("M12-NA-00-");
  });
});
