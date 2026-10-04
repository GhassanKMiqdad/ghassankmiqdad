import { NextResponse, type NextRequest } from "next/server";

import { safeRedirectPath } from "@/lib/validation/auth";

/** Compatibility path for configured Firebase email action links and old deep links. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const oobCode = url.searchParams.get("oobCode");
  if (mode && oobCode) {
    const target = new URL("/auth/confirm", url.origin);
    target.searchParams.set("mode", mode);
    target.searchParams.set("oobCode", oobCode);
    target.searchParams.set("next", safeRedirectPath(url.searchParams.get("next")));
    return NextResponse.redirect(target);
  }
  return NextResponse.redirect(new URL("/login?error=link_invalid", url.origin));
}
