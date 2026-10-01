import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/validation/auth";

const SUPPORTED_TYPES: EmailOtpType[] = ["signup", "email", "invite", "recovery", "email_change", "magiclink"];

/**
 * Verifies e-mail links built from `token_hash` (see supabase/templates).
 * Works across devices, unlike the PKCE code flow.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type && SUPPORTED_TYPES.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const target =
        type === "recovery"
          ? "/reset-password"
          : type === "invite"
            ? "/reset-password?welcome=1"
            : safeRedirectPath(url.searchParams.get("next"));
      return NextResponse.redirect(new URL(target, url.origin));
    }
    console.warn("[auth/confirm] verification failed", error.code);
  }

  const failure = type === "recovery" ? "/forgot-password?error=link_invalid" : "/login?error=link_invalid";
  return NextResponse.redirect(new URL(failure, url.origin));
}
