"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { LocaleButtons } from "@/components/layout/locale-switcher";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n/provider";

export function AppearanceSettings() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light", label: t.nav.themeLight, icon: Sun },
    { value: "dark", label: t.nav.themeDark, icon: Moon },
    { value: "system", label: t.nav.themeSystem, icon: Monitor },
  ] as const;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>{t.settings.preferences.language}</Label>
        <div>
          <LocaleButtons />
        </div>
      </div>
      <div className="space-y-2">
        <Label>{t.settings.preferences.theme}</Label>
        <div className="inline-flex rounded-md border p-0.5">
          {options.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={theme === value ? "secondary" : "ghost"}
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
            >
              <Icon aria-hidden />
              {label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
