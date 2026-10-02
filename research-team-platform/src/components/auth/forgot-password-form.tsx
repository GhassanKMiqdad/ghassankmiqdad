"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MailCheck } from "lucide-react";

import { FormAlert } from "@/components/auth/form-alert";
import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validation/auth";
import { requestPasswordResetAction } from "@/server/actions/auth";

export function ForgotPasswordForm({ initialError }: { initialError?: string | null }) {
  const { t, fmt, message } = useI18n();
  const { pending, run } = useServerAction();
  const [formError, setFormError] = useState<string | null>(initialError ?? null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await run(() => requestPasswordResetAction(values), { silent: true });
    if (!result) return;
    if (result.ok) setSentTo(values.email);
    else setFormError(result.error.message);
  });

  if (sentTo) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-6 text-center">
        <MailCheck className="mx-auto size-10 text-primary" aria-hidden />
        <h2 className="text-lg font-semibold">{t.auth.forgot.sentTitle}</h2>
        <p className="text-sm text-muted-foreground">{fmt(t.auth.forgot.sentBody, { email: sentTo })}</p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormAlert message={formError} />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.auth.forgot.email}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" dir="ltr" {...field} />
              </FormControl>
              <FormMessage localize={message} />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {pending ? t.auth.forgot.submitting : t.auth.forgot.submit}
        </Button>
      </form>
    </Form>
  );
}
