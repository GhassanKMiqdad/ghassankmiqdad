import "server-only";

/** Server-only configuration. Never import this module from Client Components. */

export function getPlatformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes("@"));
}

let timeZoneCache: string | null = null;

/** Validated IANA time zone used for "overdue" and date display. */
export function getAppTimeZone(): string {
  if (timeZoneCache) return timeZoneCache;
  const candidate = process.env.APP_TIMEZONE?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format(new Date());
    timeZoneCache = candidate;
  } catch {
    console.warn(`[config] Invalid APP_TIMEZONE "${candidate}", falling back to UTC.`);
    timeZoneCache = "UTC";
  }
  return timeZoneCache;
}

/** Canonical origin used for Firebase Auth action links; never trust request Host headers. */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const base =
    configured || (vercel ? `https://${vercel}` : process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!base) throw new Error("NEXT_PUBLIC_SITE_URL must be set to the canonical HTTPS URL in production.");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an absolute http(s) URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an absolute http(s) URL without credentials, query, or fragment.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SITE_URL must use HTTPS in production.");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}
