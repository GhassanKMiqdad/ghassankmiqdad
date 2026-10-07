/**
 * Scheduling math shared by the server (input conversion) and the UI (live
 * preview of the calculated deadline). The database recalculates the deadline
 * itself (private.apply_task_schedule); these helpers never decide anything,
 * they only mirror the rule so the form can show it before saving.
 */
import type { DurationUnit } from "@/lib/permissions/catalog";

export const MINUTES_PER_UNIT: Record<DurationUnit, number> = {
  hours: 60,
  days: 1440,
  weeks: 10080,
};

/** Duration normalized to minutes, like tasks.planned_duration_minutes. */
export function durationToMinutes(duration: number, unit: DurationUnit): number {
  return Math.round(duration * MINUTES_PER_UNIT[unit]);
}

/** Deadline = planned start + duration. */
export function calculateDueAt(startIso: string, duration: number, unit: DurationUnit): string {
  const start = new Date(startIso);
  return new Date(start.getTime() + durationToMinutes(duration, unit) * 60_000).toISOString();
}

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Offset (ms) of a time zone from UTC at a given instant. */
function timeZoneOffset(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock "YYYY-MM-DDTHH:mm" (an <input type="datetime-local">
 * value) in `timeZone` to an ISO instant. Returns null for invalid input.
 */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  const match = LOCAL_DATETIME.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(guess)) return null;
  // Two passes handle instants next to a DST change.
  let instant = guess - timeZoneOffset(new Date(guess), timeZone);
  instant = guess - timeZoneOffset(new Date(instant), timeZone);
  const result = new Date(instant);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

/** ISO instant → "YYYY-MM-DDTHH:mm" wall clock in `timeZone` (for form inputs). */
export function isoToZonedLocal(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Calendar date (YYYY-MM-DD) of an instant in `timeZone`. */
export function isoToZonedDate(iso: string, timeZone: string): string {
  return isoToZonedLocal(iso, timeZone).slice(0, 10);
}

/** Start (inclusive) and end (exclusive) instants of a calendar day range in `timeZone`. */
export function zonedDayRange(fromDate: string, toDateExclusive: string, timeZone: string) {
  return {
    from: zonedLocalToIso(`${fromDate}T00:00`, timeZone),
    to: zonedLocalToIso(`${toDateExclusive}T00:00`, timeZone),
  };
}

/** Adds days to a YYYY-MM-DD date (calendar arithmetic, time-zone free). */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `date` (YYYY-MM-DD). */
export function startOfWeek(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const day = (value.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -day);
}

/** Human task ID prefix, e.g. M01-GH-01-, mirroring private.next_task_code(). */
export function taskCodePrefix(month: number, memberCode: string | null, week: number | null): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `M${pad(month)}-${memberCode ?? "NA"}-${pad(week ?? 0)}-`;
}

export const TASK_CODE_PATTERN = /^[A-Z0-9]{1,12}(-[A-Z0-9]{1,12}){0,5}$/;
