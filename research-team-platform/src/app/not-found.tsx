import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
        <FileQuestion className="size-7 text-muted-foreground" aria-hidden />
      </div>
      <h1 className="text-2xl font-semibold">{t.pages.notFoundTitle}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t.pages.notFoundBody}</p>
      <Button asChild>
        <Link href="/workspace">{t.pages.goHome}</Link>
      </Button>
    </main>
  );
}
