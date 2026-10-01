"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { setLocaleAction } from "@/server/actions/preferences";

const LABELS: Record<Locale, string> = { ar: "العربية", en: "English" };

export function LocaleSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const change = (next: Locale) =>
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t.nav.language} disabled={pending}>
          <Languages aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((item) => (
          <DropdownMenuItem key={item} onSelect={() => change(item)} lang={item}>
            <span className="flex-1">{LABELS[item]}</span>
            {item === locale ? <Check aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LocaleButtons() {
  const { locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {LOCALES.map((item) => (
        <Button
          key={item}
          type="button"
          size="sm"
          variant={item === locale ? "secondary" : "ghost"}
          disabled={pending}
          lang={item}
          onClick={() =>
            startTransition(async () => {
              await setLocaleAction(item);
              router.refresh();
            })
          }
        >
          {LABELS[item]}
        </Button>
      ))}
    </div>
  );
}
