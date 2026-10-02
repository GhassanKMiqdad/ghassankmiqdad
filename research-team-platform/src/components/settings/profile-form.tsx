"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { applyFieldErrors, useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n/provider";
import { profileSchema, type ProfileInput } from "@/lib/validation/settings";
import { updateProfileAction } from "@/server/actions/settings";

export function ProfileForm({ fullName, email }: { fullName: string; email: string | null }) {
  const { t, message } = useI18n();
  const { pending, run } = useServerAction();
  const form = useForm<ProfileInput>({ resolver: zodResolver(profileSchema), defaultValues: { fullName } });

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await run(() => updateProfileAction(values), { success: t.settings.profile.saved });
    applyFieldErrors(result, form.setError);
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.settings.profile.fullName}</FormLabel>
              <FormControl>
                <Input autoComplete="name" {...field} />
              </FormControl>
              <FormMessage localize={message} />
            </FormItem>
          )}
        />
        <div className="grid gap-2">
          <Label htmlFor="profile-email">{t.settings.profile.email}</Label>
          <Input id="profile-email" value={email ?? ""} disabled dir="ltr" aria-describedby="profile-email-hint" />
          <p id="profile-email-hint" className="text-sm text-muted-foreground">
            {t.settings.profile.emailHint}
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t.common.saveChanges}
        </Button>
      </form>
    </Form>
  );
}
