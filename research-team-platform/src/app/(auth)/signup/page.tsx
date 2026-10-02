import type { Metadata } from "next";
import Link from "next/link";

import { SignupForm } from "@/components/auth/signup-form";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.signup.title };
}

export default async function SignupPage() {
  const { t } = await getI18n();
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t.auth.signup.title}</h1>
        <p className="text-sm text-muted-foreground">{t.auth.signup.subtitle}</p>
      </div>
      <SignupForm />
      <p className="text-center text-sm text-muted-foreground">
        {t.auth.signup.haveAccount}{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t.auth.signup.signInLink}
        </Link>
      </p>
    </div>
  );
}
