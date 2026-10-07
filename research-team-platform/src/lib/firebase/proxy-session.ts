import { NextResponse, type NextRequest } from "next/server";

import { FIREBASE_SESSION_COOKIE } from "@/lib/firebase/server";

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/auth/"];
const GUEST_ONLY_PATHS = ["/login", "/signup", "/forgot-password"];

function matches(pathname: string, paths: string[]) {
  return paths.some((path) => (path.endsWith("/") ? pathname.startsWith(path) : pathname === path));
}

/** Routing convenience only: protected Server Components/actions verify the signed cookie with Firebase Admin. */
export async function updateSession(request: NextRequest) {
  const hasCookie = Boolean(request.cookies.get(FIREBASE_SESSION_COOKIE)?.value);
  const { pathname, search } = request.nextUrl;
  const redirectTo = (path: string, params?: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
    return NextResponse.redirect(url);
  };

  if (!hasCookie && !matches(pathname, PUBLIC_PATHS)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    const next = pathname === "/" ? "/dashboard" : `${pathname}${search}`;
    return redirectTo("/login", { next });
  }
  if (hasCookie && matches(pathname, GUEST_ONLY_PATHS)) return redirectTo("/dashboard");
  return NextResponse.next();
}
