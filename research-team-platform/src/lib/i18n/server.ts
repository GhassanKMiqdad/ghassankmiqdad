import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getAppTimeZone } from "@/lib/env.server";
import { createI18n, type I18n } from "@/lib/i18n";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";

export const getLocale = cache(async (): Promise<Locale> => {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
});

/** Dictionary and formatters for Server Components, Route Handlers and Server Actions. */
export const getI18n = cache(async (): Promise<I18n> => {
  const locale = await getLocale();
  return createI18n(locale, getAppTimeZone());
});
