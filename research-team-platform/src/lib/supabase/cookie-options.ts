import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Options for the Supabase auth cookies.
 *
 * HTTP-only: browser scripts never need the session — data is read and
 * written on the server, and uploads use signed URLs — so even an XSS bug
 * could not read the access or refresh token. `secure` is enabled whenever the
 * site is served over HTTPS (production on Vercel).
 */
export function authCookieOptions(): CookieOptionsWithName {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
  const secure = siteUrl.startsWith("https://") || process.env.VERCEL === "1";
  return { path: "/", sameSite: "lax", httpOnly: true, secure };
}
