"use client";

import { NewPasswordForm } from "@/components/auth/new-password-form";
import { useI18n } from "@/lib/i18n/provider";
import { changePasswordAction } from "@/server/actions/settings";

export function PasswordSettings() {
  const { t } = useI18n();
  return (
    <NewPasswordForm
      action={changePasswordAction}
      submitLabel={t.settings.password.submit}
      successMessage={t.settings.password.changed}
    />
  );
}
