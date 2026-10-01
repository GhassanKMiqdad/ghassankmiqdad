import { directionOf, type Locale } from "@/lib/i18n/config";
import { dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";
import { fmt, formatDate, formatNumber, formatRelative, type DateStyle } from "@/lib/i18n/format";

export type I18n = {
  locale: Locale;
  dir: "rtl" | "ltr";
  timeZone: string;
  t: Dictionary;
  fmt: typeof fmt;
  date: (value: string | Date | null | undefined, style?: DateStyle) => string;
  relative: (value: string | Date, now?: Date) => string;
  number: (value: number) => string;
  /** Translates validation/error keys such as "validation.required". */
  message: (keyOrText: string) => string;
};

export function createI18n(locale: Locale, timeZone: string): I18n {
  const t = dictionaries[locale];
  return {
    locale,
    dir: directionOf(locale),
    timeZone,
    t,
    fmt,
    date: (value, style = "date") => formatDate(value, locale, timeZone, style),
    relative: (value, now) => formatRelative(value, locale, now),
    number: (value) => formatNumber(value, locale),
    message: (keyOrText) => translateMessage(t, keyOrText),
  };
}

export function translateMessage(t: Dictionary, keyOrText: string): string {
  const [scope, key] = keyOrText.split(".", 2);
  if (scope === "validation" && key && key in t.validation) {
    return t.validation[key as keyof Dictionary["validation"]];
  }
  if (scope === "errors" && key && key in t.errors) {
    return t.errors[key as keyof Dictionary["errors"]];
  }
  return keyOrText;
}
