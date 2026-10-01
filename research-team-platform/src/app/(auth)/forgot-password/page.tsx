import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.forgot.title };
}

export default async function ForgotPasswordPage(props: PageProps<"/forgot-password">) {
  const { t } = await getI18n();
  const searchParams = await props.searchParams;
  const linkError = searchParams.error === "link_invalid" ? t.auth.linkInvalid : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t.auth.forgot.title}</h1>
        <p className="text-sm text-muted-foreground">{t.auth.forgot.subtitle}</p>
      </div>
      <ForgotPasswordForm initialError={linkError} />
      <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t.auth.forgot.backToLogin}
      </Link>
    </div>
  );
}
