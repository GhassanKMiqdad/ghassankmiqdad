"use server";

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { getPlatformAdminEmails, getSiteUrl } from "@/lib/env.server";
import { identityToolkitRequest, toAuthErrorKey } from "@/lib/firebase/auth-rest";
import { firebaseAdminAuth, firebaseAdminFirestore, FieldValue, syncPlatformAdminClaim } from "@/lib/firebase/admin";
import { FIREBASE_SESSION_COOKIE, FIREBASE_SESSION_TTL_MS } from "@/lib/firebase/server";
import { getI18n } from "@/lib/i18n/server";
import {
  forgotPasswordSchema,
  loginSchema,
  newPasswordSchema,
  safeRedirectPath,
  signupSchema,
} from "@/lib/validation/auth";
import { parseInput } from "@/server/action";

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: Math.floor(FIREBASE_SESSION_TTL_MS / 1000),
};

type IdentityUser = {
  localId: string;
  idToken: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
};

type AuthMessageKey =
  | "invalidCredentials"
  | "emailNotConfirmed"
  | "signupDisabled"
  | "userAlreadyExists"
  | "rateLimited"
  | "weakPassword"
  | "samePassword"
  | "linkInvalid";

async function authFailure(key: AuthMessageKey): Promise<ActionResult<never>> {
  const { t } = await getI18n();
  return { ok: false, error: { code: "INVALID_INPUT", message: t.auth[key] } };
}

function authKey(error: { code?: string; status?: number }): AuthMessageKey | null {
  switch (toAuthErrorKey(error.code ?? "")) {
    case "invalid_credentials":
      return "invalidCredentials";
    case "email_not_confirmed":
      return "emailNotConfirmed";
    case "signup_disabled":
    case "email_provider_disabled":
      return "signupDisabled";
    case "email_exists":
      return "userAlreadyExists";
    case "weak_password":
      return "weakPassword";
    case "same_password":
      return "samePassword";
    case "over_request_rate_limit":
      return "rateLimited";
    default:
      return error.status === 429 ? "rateLimited" : null;
  }
}

async function runPublic<T>(body: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await body();
  } catch (error) {
    unstable_rethrow(error);
    const { t } = await getI18n();
    if (error instanceof AppError) {
      return { ok: false, error: { code: error.code, message: t.errors[error.code], fieldErrors: error.fieldErrors } };
    }
    console.error("[auth] unexpected Firebase Auth error", error);
    return { ok: false, error: { code: "UNEXPECTED", message: t.errors.UNEXPECTED } };
  }
}

async function setSessionCookie(idToken: string) {
  const sessionCookie = await firebaseAdminAuth().createSessionCookie(idToken, { expiresIn: FIREBASE_SESSION_TTL_MS });
  const cookieStore = await cookies();
  cookieStore.set(FIREBASE_SESSION_COOKIE, sessionCookie, SESSION_COOKIE_OPTIONS);
}

async function preparePlatformAdminClaim(email: string): Promise<void> {
  let account;
  try {
    account = await firebaseAdminAuth().getUserByEmail(email);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "auth/user-not-found") return;
    throw error;
  }

  const profileRef = firebaseAdminFirestore().collection("profiles").doc(account.uid);
  const profile = await profileRef.get();
  const allowlisted = getPlatformAdminEmails().includes(email.toLowerCase());
  const isPlatformAdmin = profile.get("is_platform_admin") === true || allowlisted;
  if (allowlisted && profile.get("is_platform_admin") !== true) {
    await profileRef.set(
      { id: account.uid, email, email_lower: email.toLowerCase(), is_platform_admin: true, can_create_projects: true },
      { merge: true },
    );
  }
  await syncPlatformAdminClaim(account.uid, isPlatformAdmin);
}

export async function signInAction(input: unknown, next?: string): Promise<ActionResult<never>> {
  return runPublic(async () => {
    const values = parseInput(loginSchema, input);
    await preparePlatformAdminClaim(values.email);
    const result = await identityToolkitRequest<IdentityUser>("accounts:signInWithPassword", {
      email: values.email,
      password: values.password,
      returnSecureToken: true,
    });
    if (result.error) {
      const key = authKey(result.error);
      if (!key) console.error("[auth] sign-in failed", result.error.code);
      return authFailure(key ?? "invalidCredentials");
    }

    if (result.data.emailVerified !== true) return authFailure("emailNotConfirmed");
    await firebaseAdminFirestore()
      .collection("profiles")
      .doc(result.data.localId)
      .set(
        {
          id: result.data.localId,
          email: result.data.email ?? values.email,
          email_lower: (result.data.email ?? values.email).toLowerCase(),
          email_verified: true,
          full_name: result.data.displayName ?? "",
          last_sign_in_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    await setSessionCookie(result.data.idToken);
    redirect(safeRedirectPath(next));
  });
}

export async function signUpAction(input: unknown): Promise<ActionResult<{ needsConfirmation: boolean }>> {
  return runPublic(async () => {
    const values = parseInput(signupSchema, input);
    const signup = await identityToolkitRequest<IdentityUser>("accounts:signUp", {
      email: values.email,
      password: values.password,
      returnSecureToken: true,
    });
    if (signup.error) {
      const key = authKey(signup.error);
      if (!key) console.error("[auth] sign-up failed", signup.error.code);
      return key
        ? authFailure(key)
        : { ok: false, error: { code: "UNEXPECTED", message: (await getI18n()).t.errors.UNEXPECTED } };
    }

    const userId = signup.data.localId;
    await firebaseAdminAuth().updateUser(userId, { displayName: values.fullName });
    await firebaseAdminFirestore().collection("profiles").doc(userId).set({
      id: userId,
      email: values.email,
      email_lower: values.email.toLowerCase(),
      email_verified: false,
      full_name: values.fullName,
      is_platform_admin: false,
      can_create_projects: false,
      created_at: FieldValue.serverTimestamp(),
      last_sign_in_at: null,
    });

    const siteUrl = getSiteUrl();
    const verification = await identityToolkitRequest("accounts:sendOobCode", {
      requestType: "VERIFY_EMAIL",
      idToken: signup.data.idToken,
      continueUrl: `${siteUrl}/auth/confirm`,
      canHandleCodeInApp: true,
    });
    if (verification.error) {
      // Avoid leaving an unreachable unverified account when mail setup is broken.
      await firebaseAdminFirestore()
        .collection("profiles")
        .doc(userId)
        .delete()
        .catch(() => undefined);
      await firebaseAdminAuth()
        .deleteUser(userId)
        .catch(() => undefined);
      const key = authKey(verification.error);
      if (key) return authFailure(key);
      console.error("[auth] verification-email send failed", verification.error.code);
      return { ok: false, error: { code: "UNEXPECTED", message: (await getI18n()).t.errors.UNEXPECTED } };
    }
    return { ok: true, data: { needsConfirmation: true } };
  });
}

export async function requestPasswordResetAction(input: unknown): Promise<ActionResult<null>> {
  return runPublic(async () => {
    const values = parseInput(forgotPasswordSchema, input);
    const siteUrl = getSiteUrl();
    const result = await identityToolkitRequest("accounts:sendOobCode", {
      requestType: "PASSWORD_RESET",
      email: values.email,
      continueUrl: `${siteUrl}/auth/confirm?next=/reset-password`,
      canHandleCodeInApp: true,
    });
    if (result.error && authKey(result.error) === "rateLimited") return authFailure("rateLimited");
    if (result.error && !["EMAIL_NOT_FOUND", "INVALID_EMAIL"].includes(result.error.code)) {
      console.error("[auth] password reset request failed", result.error.code);
    }
    // Avoid disclosing whether an account exists.
    return { ok: true, data: null };
  });
}

export async function finishPasswordResetAction(oobCode: string, input: unknown): Promise<ActionResult<null>> {
  return runPublic(async () => {
    const values = parseInput(newPasswordSchema, input);
    if (!oobCode || oobCode.length > 4096) return authFailure("linkInvalid");
    const result = await identityToolkitRequest("accounts:resetPassword", {
      oobCode,
      newPassword: values.password,
    });
    if (result.error) {
      const key = authKey(result.error);
      return authFailure(key ?? "linkInvalid");
    }
    return { ok: true, data: null };
  });
}

export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(FIREBASE_SESSION_COOKIE);
  redirect("/login");
}
