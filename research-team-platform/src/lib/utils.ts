import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Initials for avatars: "Ghassan Miqdad" -> "GM", "غسان" -> "غ". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0] ?? "")[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1] ?? "")[0] ?? "") : "";
  return (first + last).toUpperCase();
}

const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
const BYTE_SYMBOLS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number, locale = "en"): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_SYMBOLS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = { maximumFractionDigits: unit === 0 ? 0 : 1 };
  if (locale.startsWith("ar")) {
    // Arabic unit names ("104 بايت") read naturally inside right-to-left text.
    return new Intl.NumberFormat("ar-u-nu-latn", {
      ...digits,
      style: "unit",
      unit: BYTE_UNITS[unit],
      unitDisplay: "short",
    }).format(value);
  }
  return `${new Intl.NumberFormat(locale, digits).format(value)} ${BYTE_SYMBOLS[unit]}`;
}

/** Narrow unknown values coming from JSON columns. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
