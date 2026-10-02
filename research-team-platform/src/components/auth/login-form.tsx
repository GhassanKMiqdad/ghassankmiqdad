"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { FormAlert } from "@/components/auth/form-alert";
import { PasswordInput } from "@/components/auth/password-input";
import { applyFieldErrors, useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";
import { loginSchema, type LoginInput } from "@/lib/validation/auth";
import { signInAction } from "@/server/actions/auth";

export function LoginForm({ next, initialError }: { next?: string; initialError?: string | null }) {
  const { t, message } = useI18n();
  const { pending, run } = useServerAction();
  const [formError, setFormError] = useState<string | null>(initialError ?? null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await run(() => signInAction(values, next), { silent: true });
    if (result && !result.ok) {
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
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.auth.login.email}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" dir="ltr" placeholder="name@university.edu" {...field} />
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
              <div className="flex items-center justify-between">
                <FormLabel>{t.auth.login.password}</FormLabel>
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                  {t.auth.login.forgotPassword}
                </Link>
              </div>
              <FormControl>
                <PasswordInput autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage localize={message} />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {pending ? t.auth.login.submitting : t.auth.login.submit}
        </Button>
      </form>
    </Form>
  );
}
