"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { FormAlert } from "@/components/auth/form-alert";
import { PasswordInput } from "@/components/auth/password-input";
import { applyFieldErrors, useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { ActionResult } from "@/lib/action-result";
import { useI18n } from "@/lib/i18n/provider";
import { newPasswordSchema, type NewPasswordInput } from "@/lib/validation/auth";

/**
 * Shared by the reset-password page (redirects on success) and the settings
 * page (stays and confirms with a toast).
 */
export function NewPasswordForm({
  action,
  submitLabel,
  successMessage,
}: {
  action: (values: NewPasswordInput) => Promise<ActionResult<null> | ActionResult<never>>;
  submitLabel: string;
  successMessage?: string;
}) {
  const { t, message } = useI18n();
  const { pending, run } = useServerAction();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<NewPasswordInput>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await run(() => action(values) as Promise<ActionResult<null>>, { silent: true });
    if (!result) return;
    if (result.ok) {
      form.reset();
      if (successMessage) toast.success(successMessage);
    } else {
      setFormError(result.error.message);
      applyFieldErrors(result, form.setError);
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormAlert message={formError} />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.auth.reset.password}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>{t.auth.passwordHint}</FormDescription>
              <FormMessage localize={message} />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.auth.reset.confirmPassword}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage localize={message} />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {submitLabel}
        </Button>
      </form>
    </Form>
  );
}
