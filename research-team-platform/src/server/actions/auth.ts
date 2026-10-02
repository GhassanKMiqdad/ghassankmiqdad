"use server";

import { cookies, headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { getSiteUrl } from "@/lib/env.server";
import { getI18n } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  loginSchema,
  newPasswordSchema,
  safeRedirectPath,
  signupSchema,
} from "@/lib/validation/auth";
import { parseInput } from "@/server/action";

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

function authErrorKey(error: { code?: string; status?: number }): AuthMessageKey | null {
  switch (error.code) {
    case "invalid_credentials":
      return "invalidCredentials";
    case "email_not_confirmed":
      return "emailNotConfirmed";
    case "signup_disabled":
    case "email_provider_disabled":
      return "signupDisabled";
    case "user_already_exists":
    case "email_exists":
      return "userAlreadyExists";
    case "weak_password":
      return "weakPassword";
    case "same_password":
      return "samePassword";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "rateLimited";
    default:
      return error.status === 429 ? "rateLimited" : null;
  }
}

/** Public actions: validation errors are returned, unexpected errors logged. */
async function runPublic<T>(body: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await body();
  } catch (error) {
    unstable_rethrow(error);
    const { t, fmt } = await getI18n();
    if (error instanceof AppError) {
      return {
        ok: false,
        error: { code: error.code, message: fmt(t.errors[error.code], error.values), fieldErrors: error.fieldErrors },
      };
    }
    console.error("[auth] unexpected error", error);
    return { ok: false, error: { code: "UNEXPECTED", message: t.errors.UNEXPECTED } };
  }
}

async function requestOrigin(): Promise<string | null> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto = headerStore.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : null;
}

export async function signInAction(input: unknown, next?: string): Promise<ActionResult<never>> {
  return runPublic(async () => {
    const values = parseInput(loginSchema, input);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      const key = authErrorKey(error);
      if (!key) console.error("[auth] sign-in failed", error.code, error.message);
      return authFailure(key ?? "invalidCredentials");
    }
    redirect(safeRedirectPath(next));
  });
}

export async function signUpAction(input: unknown): Promise<ActionResult<{ needsConfirmation: boolean }>> {
  return runPublic(async () => {
    const values = parseInput(signupSchema, input);
    const supabase = await createSupabaseServerClient();
    const siteUrl = getSiteUrl(await requestOrigin());

    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: { full_name: values.fullName },
        emailRedirectTo: `${siteUrl}/auth/callback?next=/dashboard`,
      },
    });

    if (error) {
      const key = authErrorKey(error);
      if (!key) console.error("[auth] sign-up failed", error.code, error.message);
      return key
        ? authFailure(key)
        : { ok: false, error: { code: "UNEXPECTED", message: (await getI18n()).t.errors.UNEXPECTED } };
    }

    if (data.session) {
      redirect("/dashboard");
    }
    return { ok: true, data: { needsConfirmation: true } };
  });
}

export async function requestPasswordResetAction(input: unknown): Promise<ActionResult<null>> {
  return runPublic(async () => {
    const values = parseInput(forgotPasswordSchema, input);
    const supabase = await createSupabaseServerClient();
    const siteUrl = getSiteUrl(await requestOrigin());
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
    });
    if (error) {
      const key = authErrorKey(error);
      if (key === "rateLimited") return authFailure(key);
      // Never reveal whether the e-mail exists.
      console.error("[auth] password reset request failed", error.code, error.message);
    }
    return { ok: true, data: null };
  });
}

export async function updatePasswordAction(input: unknown): Promise<ActionResult<never>> {
  return runPublic(async () => {
    const values = parseInput(newPasswordSchema, input);
    const supabase = await createSupabaseServerClient();
    const { data: claims } = await supabase.auth.getClaims();
    if (!claims?.claims?.sub) return authFailure("linkInvalid");

    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      const key = authErrorKey(error);
      if (!key) console.error("[auth] password update failed", error.code, error.message);
      return authFailure(key ?? "weakPassword");
    }
    redirect("/dashboard");
  });
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  // Defensive: clear any leftover Supabase auth cookies.
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith("sb-")) cookieStore.delete(cookie.name);
  }
  redirect("/login");
}
