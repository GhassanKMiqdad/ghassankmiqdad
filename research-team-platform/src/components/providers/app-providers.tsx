"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Direction } from "radix-ui";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Locale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";

export function AppProviders({
  locale,
  dir,
  timeZone,
  children,
}: {
  locale: Locale;
  dir: "rtl" | "ltr";
  timeZone: string;
  children: ReactNode;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <Direction.Provider dir={dir}>
        <I18nProvider locale={locale} timeZone={timeZone}>
          <TooltipProvider>
            {children}
            <Toaster position="top-center" dir={dir} />
          </TooltipProvider>
        </I18nProvider>
      </Direction.Provider>
    </ThemeProvider>
  );
}
