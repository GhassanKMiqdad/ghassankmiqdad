import { NextResponse, type NextRequest } from "next/server";

import { FieldValue, firebaseAdminAuth, firebaseAdminFirestore } from "@/lib/firebase/admin";
import { identityToolkitRequest } from "@/lib/firebase/auth-rest";
import { FIREBASE_SESSION_COOKIE, FIREBASE_SESSION_TTL_MS } from "@/lib/firebase/server";
import { safeRedirectPath } from "@/lib/validation/auth";

type OobResult = {
  idToken?: string;
  localId?: string;
  email?: string;
  emailVerified?: boolean;
};

/** Firebase email action handler. Configure the Auth email templates' action URL to this route. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const oobCode = url.searchParams.get("oobCode");
  if (!oobCode || oobCode.length > 4096) {
    return NextResponse.redirect(new URL("/login?error=link_invalid", url.origin));
  }

  if (mode === "resetPassword") {
    const target = new URL("/reset-password", url.origin);
    target.searchParams.set("oobCode", oobCode);
    return NextResponse.redirect(target);
  }

  if (mode === "verifyEmail") {
    const result = await identityToolkitRequest<OobResult>("accounts:update", { oobCode });
    if (result.error || !result.data.idToken || !result.data.localId) {
      console.warn("[auth/confirm] Firebase verification code rejected", result.error?.code);
      return NextResponse.redirect(new URL("/login?error=link_invalid", url.origin));
    }
    const sessionCookie = await firebaseAdminAuth().createSessionCookie(result.data.idToken, {
      expiresIn: FIREBASE_SESSION_TTL_MS,
    });
    await firebaseAdminFirestore()
      .collection("profiles")
      .doc(result.data.localId)
      .set(
        {
          id: result.data.localId,
          email: result.data.email ?? null,
          email_lower: result.data.email?.toLowerCase() ?? null,
          email_verified: true,
          last_sign_in_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    const response = NextResponse.redirect(new URL(safeRedirectPath(url.searchParams.get("next")), url.origin));
    response.cookies.set(FIREBASE_SESSION_COOKIE, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(FIREBASE_SESSION_TTL_MS / 1000),
    });
    return response;
  }

  const fallback = mode === "resetPassword" ? "/forgot-password?error=link_invalid" : "/login?error=link_invalid";
  return NextResponse.redirect(new URL(fallback, url.origin));
}
