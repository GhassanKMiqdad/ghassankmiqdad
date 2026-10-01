import type { Metadata } from "next";

import { NewPasswordForm } from "@/components/auth/new-password-form";
import { getI18n } from "@/lib/i18n/server";
import { updatePasswordAction } from "@/server/actions/auth";
import { requireSessionUser } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.reset.title };
}

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  // The recovery / invitation link established a session in /auth/confirm.
  await requireSessionUser();
  const { t } = await getI18n();
  const searchParams = await props.searchParams;
  const welcome = searchParams.welcome === "1";

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          {welcome ? t.auth.reset.welcomeTitle : t.auth.reset.title}
        </h1>
        <p className="text-sm text-muted-foreground">{t.auth.reset.subtitle}</p>
      </div>
      <NewPasswordForm action={updatePasswordAction} submitLabel={t.auth.reset.submit} />
    </div>
  );
}
