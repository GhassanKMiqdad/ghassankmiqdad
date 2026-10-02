import "server-only";

import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { AppError, toAppError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { requireSessionUser, type SessionUser } from "@/server/auth";

/**
 * Runs a Server Action body with uniform authentication, validation and error
 * handling. Expected failures become localized messages; unexpected ones are
 * logged server-side and reported generically (no stack traces reach users).
 */
export async function runAction<T>(body: (user: SessionUser) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const user = await requireSessionUser();
    const data = await body(user);
    return { ok: true, data };
  } catch (error) {
    unstable_rethrow(error);
    const appError = toAppError(error);
    if (appError.code === "UNEXPECTED") {
      console.error("[action] unexpected error", error);
    }
    const i18n = await getI18n();
    return {
      ok: false,
      error: {
        code: appError.code,
        message: i18n.fmt(i18n.t.errors[appError.code], appError.values),
        fieldErrors: appError.fieldErrors,
      },
    };
  }
}

/** Parses untrusted input; on failure throws VALIDATION_ERROR with field messages. */
export function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.map(String).join(".") || "_form";
    if (!fieldErrors[field]) {
      fieldErrors[field] = issue.message.startsWith("validation.") ? issue.message : "validation.invalid";
    }
  }
  throw new AppError("VALIDATION_ERROR", { fieldErrors });
}

type SupabaseResult = { data: unknown; error: unknown };
type DataOf<R> = R extends { data: infer D } ? D : never;

/**
 * Unwraps a Supabase response whose data is present on success (lists,
 * `.single()`, RPC results), converting database errors to AppErrors.
 * (The response type is captured as a whole: inferring `data` through a
 * generic parameter breaks on awaited PostgREST builders.)
 */
export function unwrap<R extends SupabaseResult>(response: R): NonNullable<DataOf<R>> {
  if (response.error) throw toAppError(response.error);
  return response.data as NonNullable<DataOf<R>>;
}

/** Same as `unwrap` for `.maybeSingle()`: null means "not found / not visible". */
export function unwrapMaybe<R extends SupabaseResult>(response: R): DataOf<R> | null {
  if (response.error) throw toAppError(response.error);
  return (response.data ?? null) as DataOf<R> | null;
}
