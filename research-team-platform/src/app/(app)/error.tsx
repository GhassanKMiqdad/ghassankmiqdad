"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";

/** Generic error boundary: never shows technical details to the user. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
        <AlertTriangle className="size-7 text-destructive" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold">{t.pages.errorTitle}</h1>
      <p className="text-sm text-muted-foreground">{t.pages.errorBody}</p>
      {error.digest ? <p className="text-xs text-muted-foreground">ref: {error.digest}</p> : null}
      <Button onClick={reset}>{t.pages.tryAgain}</Button>
    </div>
  );
}
