"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { FormAlert } from "@/components/auth/form-alert";
import { PasswordInput } from "@/components/auth/password-input";
import { applyFieldErrors, useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { ActionResult } from "@/lib/action-result";
import { useI18n } from "@/lib/i18n/provider";
import { changePasswordSchema, type ChangePasswordInput } from "@/lib/validation/auth";

export function ChangePasswordForm({
  action,
}: {
  action: (values: ChangePasswordInput) => Promise<ActionResult<null>>;
}) {
  const router = useRouter();
  const { t, message } = useI18n();
  const { pending, run } = useServerAction();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", password: "", confirmPassword: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await run(() => action(values), { silent: true });
    if (!result) return;
    if (!result.ok) {
      setFormError(result.error.message);
      applyFieldErrors(result, form.setError);
      return;
    }
    form.reset();
    toast.success(t.settings.password.changed);
    // The server revokes all refresh tokens and deletes this session cookie.
    window.setTimeout(() => router.replace("/login"), 900);
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormAlert message={formError} />
        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.settings.password.currentPassword}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage localize={message} />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.settings.password.newPassword}</FormLabel>
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
              <FormLabel>{t.settings.password.confirmPassword}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage localize={message} />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {pending ? t.common.saving : t.settings.password.submit}
        </Button>
      </form>
    </Form>
  );
}
