import { describe, expect, it } from "vitest";

import { calendarRange } from "@/server/queries/calendar";

describe("calendarRange", () => {
  it("returns the selected UTC day", () => {
    expect(calendarRange("day", "2026-10-05")).toEqual({ from: "2026-10-05", to: "2026-10-05" });
  });

  it("returns a Monday-through-Sunday week", () => {
    expect(calendarRange("week", "2026-10-07")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });

  it("returns the full calendar month including leap-year boundaries", () => {
    expect(calendarRange("month", "2024-02-14")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });
});
