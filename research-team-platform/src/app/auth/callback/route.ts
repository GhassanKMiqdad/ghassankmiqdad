import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/validation/auth";

/**
 * PKCE callback: exchanges the one-time code from e-mail links (default
 * Supabase templates) or OAuth providers for a session cookie.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeRedirectPath(url.searchParams.get("next"));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    console.warn("[auth/callback] code exchange failed", error.code);
  }

  return NextResponse.redirect(new URL("/login?error=link_invalid", url.origin));
}
