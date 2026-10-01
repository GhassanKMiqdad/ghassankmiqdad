"use client";

import { useCallback, useTransition } from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Runs a Server Action inside a transition and reports the outcome with a
 * toast. Resolves with the action result (or null when the action redirected
 * or the request failed) so callers can close dialogs, set field errors, etc.
 */
export function useServerAction() {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    <T>(
      action: () => Promise<ActionResult<T> | undefined>,
      options?: { success?: string; silent?: boolean },
    ): Promise<ActionResult<T> | null> =>
      new Promise((resolve) => {
        startTransition(async () => {
          try {
            const result = await action();
            if (!result) {
              resolve(null); // the action redirected
              return;
            }
            if (result.ok) {
              if (options?.success) toast.success(options.success);
            } else if (!options?.silent) {
              toast.error(result.error.message);
            }
            resolve(result);
          } catch {
            toast.error(t.errors.UNEXPECTED);
            resolve(null);
          }
        });
      }),
    [t],
  );

  return { pending, run };
}

/** Copies server-side field errors (validation.* keys) into a React Hook Form instance. */
export function applyFieldErrors<TFieldName extends string>(
  result: ActionResult<unknown> | null,
  setError: (name: TFieldName, error: { type: string; message: string }) => void,
) {
  if (!result || result.ok || !result.error.fieldErrors) return;
  for (const [field, message] of Object.entries(result.error.fieldErrors)) {
    setError(field as TFieldName, { type: "server", message });
  }
}
