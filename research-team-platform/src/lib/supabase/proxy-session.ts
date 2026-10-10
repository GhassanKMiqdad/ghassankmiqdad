import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnv } from "@/lib/env";
import { authCookieOptions } from "@/lib/supabase/cookie-options";
import type { Database } from "@/types/database.types";

/** Pages reachable without a session. */
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/auth/"];
/** Pages a signed-in user should not see (redirected to the dashboard). */
const GUEST_ONLY_PATHS = ["/login", "/signup", "/forgot-password"];

function matches(pathname: string, paths: string[]) {
  return paths.some((path) => (path.endsWith("/") ? pathname.startsWith(path) : pathname === path));
}

/**
 * Refreshes the Supabase session cookie on every request and protects routes.
 * This is a first line of defence only: every page, Server Action and Route
 * Handler re-checks the session, and the database enforces RLS.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicEnv();

  const supabase = createServerClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Must run before any other logic: validates the JWT and refreshes it if needed.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  const redirectTo = (path: string, params?: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
    const redirect = NextResponse.redirect(url);
    // Keep refreshed auth cookies and the no-cache headers on the redirect.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    const cacheControl = response.headers.get("cache-control");
    if (cacheControl) redirect.headers.set("cache-control", cacheControl);
    return redirect;
  };

  if (!isAuthenticated && !matches(pathname, PUBLIC_PATHS)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }
    const next = pathname === "/" ? "/workspace" : `${pathname}${search}`;
    return redirectTo("/login", { next });
  }

  if (isAuthenticated && matches(pathname, GUEST_ONLY_PATHS)) {
    return redirectTo("/workspace");
  }

  return response;
}
