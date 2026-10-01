import type { Locale } from "@/lib/i18n/config";

import { ar } from "./ar";
import { en, type Dictionary } from "./en";

export const dictionaries: Record<Locale, Dictionary> = { ar, en };

export type { Dictionary };
