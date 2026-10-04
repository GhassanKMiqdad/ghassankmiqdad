import type { Metadata } from "next";

import { NewPasswordForm } from "@/components/auth/new-password-form";
import { getI18n } from "@/lib/i18n/server";
import { finishPasswordResetAction, updatePasswordAction } from "@/server/actions/auth";
import { requireSessionUser } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.reset.title };
}

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const { t } = await getI18n();
  const searchParams = await props.searchParams;
  const rawCode = searchParams.oobCode;
  const oobCode = typeof rawCode === "string" ? rawCode : null;
  const welcome = searchParams.welcome === "1";

  if (!oobCode) await requireSessionUser();
  const action = oobCode ? finishPasswordResetAction.bind(null, oobCode) : updatePasswordAction;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          {welcome ? t.auth.reset.welcomeTitle : t.auth.reset.title}
        </h1>
        <p className="text-sm text-muted-foreground">{t.auth.reset.subtitle}</p>
      </div>
      <NewPasswordForm action={action} submitLabel={t.auth.reset.submit} />
    </div>
  );
}
