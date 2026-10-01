"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createI18n, type I18n } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  locale,
  timeZone,
  children,
}: {
  locale: Locale;
  timeZone: string;
  children: ReactNode;
}) {
  const value = useMemo(() => createI18n(locale, timeZone), [locale, timeZone]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside <I18nProvider>");
  }
  return value;
}
