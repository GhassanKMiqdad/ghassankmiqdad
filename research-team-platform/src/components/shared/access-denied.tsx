import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";

/**
 * Rendered instead of protected content. Used both for "not a member" and for
 * "member without permission" so that resource existence is never disclosed.
 */
export async function AccessDenied({ message, title }: { message?: string; title?: string }) {
  const { t } = await getI18n();
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
        <ShieldAlert className="size-7 text-destructive" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold">{title ?? t.pages.accessDeniedTitle}</h1>
      <p className="text-sm text-muted-foreground">{message ?? t.errors.PERMISSION_DENIED}</p>
      <Button asChild variant="outline">
        <Link href="/dashboard">{t.pages.goHome}</Link>
      </Button>
    </div>
  );
}
