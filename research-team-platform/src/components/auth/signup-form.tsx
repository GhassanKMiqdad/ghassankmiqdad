"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MailCheck } from "lucide-react";

import { FormAlert } from "@/components/auth/form-alert";
import { PasswordInput } from "@/components/auth/password-input";
import { applyFieldErrors, useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";
import { signupSchema, type SignupInput } from "@/lib/validation/auth";
import { signUpAction } from "@/server/actions/auth";

export function SignupForm() {
  const { t, fmt, message } = useI18n();
  const { pending, run } = useServerAction();
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { fullName: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await run(() => signUpAction(values), { silent: true });
    if (!result) return;
    if (result.ok) {
      setSentTo(values.email);
    } else {
      setFormError(result.error.message);
      applyFieldErrors(result, form.setError);
    }
  });

  if (sentTo) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-6 text-center">
        <MailCheck className="mx-auto size-10 text-primary" aria-hidden />
        <h2 className="text-lg font-semibold">{t.auth.signup.checkEmailTitle}</h2>
        <p className="text-sm text-muted-foreground">{fmt(t.auth.signup.checkEmailBody, { email: sentTo })}</p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormAlert message={formError} />
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.auth.signup.fullName}</FormLabel>
              <FormControl>
                <Input autoComplete="name" {...field} />
              </FormControl>
              <FormMessage localize={message} />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.auth.signup.email}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" dir="ltr" {...field} />
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
              <FormLabel>{t.auth.signup.password}</FormLabel>
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
              <FormLabel>{t.auth.signup.confirmPassword}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage localize={message} />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {pending ? t.auth.signup.submitting : t.auth.signup.submit}
        </Button>
      </form>
    </Form>
  );
}
