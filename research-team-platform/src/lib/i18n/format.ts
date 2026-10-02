import { intlLocaleOf, type Locale } from "@/lib/i18n/config";

/** Replaces `{name}` placeholders: fmt("Hello {name}", { name: "Ghassan" }). */
export function fmt(template: string, values: Record<string, string | number | null | undefined> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? match : String(value);
  });
}

export type DateStyle = "date" | "datetime" | "short";

/**
 * Deterministic date formatting: always uses the configured application time
 * zone so server-rendered and client-rendered output are identical.
 */
export function formatDate(
  value: string | Date | null | undefined,
  locale: Locale,
  timeZone: string,
  style: DateStyle = "date",
): string {
  if (!value) return "";
  const date = typeof value === "string" ? parseDate(value) : value;
  if (Number.isNaN(date.getTime())) return "";

  const options: Intl.DateTimeFormatOptions =
    style === "datetime"
      ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
      : style === "short"
        ? { month: "short", day: "numeric" }
        : { year: "numeric", month: "short", day: "numeric" };

  // Plain dates ("2026-10-01") are calendar dates, never shifted by time zone.
  const isPlainDate = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat(intlLocaleOf(locale), { ...options, timeZone: isPlainDate ? "UTC" : timeZone }).format(
    date,
  );
}

export function formatRelative(value: string | Date, locale: Locale, now: Date = new Date()): string {
  const date = typeof value === "string" ? parseDate(value) : value;
  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(intlLocaleOf(locale), { numeric: "auto" });

  if (abs < 60) return rtf.format(diffSeconds, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSeconds / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diffSeconds / (86400 * 30)), "month");
  return rtf.format(Math.round(diffSeconds / (86400 * 365)), "year");
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocaleOf(locale)).format(value);
}

function parseDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
}

/** Today's calendar date (YYYY-MM-DD) in the given time zone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
