import "server-only";

/** Server-only configuration. Never import this module from Client Components. */

export function getServiceRoleKey(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return key ? key : null;
}

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

/** Base URL used in e-mail links (falls back to the request origin). */
export function getSiteUrl(requestOrigin?: string | null): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const base = configured || requestOrigin || (vercel ? `https://${vercel}` : "http://localhost:3000");
  return base.replace(/\/+$/, "");
}
