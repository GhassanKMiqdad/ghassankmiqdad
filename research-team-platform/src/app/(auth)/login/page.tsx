import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "@/components/auth/login-form";
import { getI18n } from "@/lib/i18n/server";
import { safeRedirectPath } from "@/lib/validation/auth";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.login.title };
}

export default async function LoginPage(props: PageProps<"/login">) {
  const { t } = await getI18n();
  const searchParams = await props.searchParams;
  const next = safeRedirectPath(typeof searchParams.next === "string" ? searchParams.next : undefined);
  const linkError = searchParams.error === "link_invalid" ? t.auth.linkInvalid : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t.auth.login.title}</h1>
        <p className="text-sm text-muted-foreground">{t.auth.login.subtitle}</p>
      </div>
      <LoginForm next={next} initialError={linkError} />
      <p className="text-center text-sm text-muted-foreground">
        {t.auth.login.noAccount}{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          {t.auth.login.signUpLink}
        </Link>
      </p>
    </div>
  );
}
