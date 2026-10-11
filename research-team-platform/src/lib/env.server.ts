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

/** Base URL used in e-mail links. Production never trusts request headers. */
export function getSiteUrl(requestOrigin?: string | null): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const production = process.env.NODE_ENV === "production";
  if (configured) {
    const url = new URL(configured);
    if (url.username || url.password || (production && url.protocol !== "https:")) {
      throw new Error("NEXT_PUBLIC_SITE_URL must be a credential-free HTTPS URL in production.");
    }
    return configured.replace(/\/+$/, "");
  }
  if (production) {
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
    if (vercel) {
      const url = new URL(`https://${vercel}`);
      if (url.username || url.password || url.hostname !== vercel.split(":")[0]) {
        throw new Error("VERCEL_PROJECT_PRODUCTION_URL is invalid.");
      }
      return url.origin;
    }
    throw new Error("NEXT_PUBLIC_SITE_URL is required in production.");
  }
  if (requestOrigin) {
    try {
      const url = new URL(requestOrigin);
      if (["localhost", "127.0.0.1", "::1"].includes(url.hostname) && url.protocol === "http:") {
        return url.origin;
      }
    } catch {
      // Ignore malformed or untrusted request origins in development too.
    }
  }
  return "http://localhost:3000";
}
