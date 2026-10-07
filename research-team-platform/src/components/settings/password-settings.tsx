"use client";

import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { changePasswordAction } from "@/server/actions/settings";

export function PasswordSettings() {
  return <ChangePasswordForm action={changePasswordAction} />;
}
