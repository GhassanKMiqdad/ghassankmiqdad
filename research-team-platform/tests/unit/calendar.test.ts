import { describe, expect, it } from "vitest";

import { buildCalendarMonth } from "../../src/lib/calendar/month";

describe("calendar month grid", () => {
  it("builds a bounded date range and a complete week grid", () => {
    const result = buildCalendarMonth("2026-10", "2026-10-04");
    expect(result).toMatchObject({
      key: "2026-10",
      start: "2026-10-01",
      end: "2026-10-31",
      previous: "2026-09",
      next: "2026-11",
    });
    expect(result.cells.length % 7).toBe(0);
    expect(result.cells.filter((cell) => cell.inMonth)).toHaveLength(31);
    expect(result.cells[0]?.date).toBe("2026-09-27");
  });

  it("handles leap February and year-boundary navigation", () => {
    const february = buildCalendarMonth("2024-02", "2024-02-01");
    expect(february.end).toBe("2024-02-29");
    expect(february.cells.filter((cell) => cell.inMonth)).toHaveLength(29);
    const january = buildCalendarMonth("2026-01", "2026-01-01");
    expect(january.previous).toBe("2025-12");
    expect(january.next).toBe("2026-02");
  });

  it("uses today's month for malformed, repeated, or out-of-range URL values", () => {
    expect(buildCalendarMonth("not-a-month", "2026-10-04").key).toBe("2026-10");
    expect(buildCalendarMonth(["2026-11", "2026-12"], "2026-10-04").key).toBe("2026-10");
    expect(buildCalendarMonth("2101-01", "2026-10-04").key).toBe("2026-10");
  });
});
