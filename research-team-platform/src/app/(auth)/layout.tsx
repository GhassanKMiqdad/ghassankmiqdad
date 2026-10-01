import { ClipboardList, History, ShieldCheck } from "lucide-react";

import { Brand } from "@/components/layout/brand";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getI18n } from "@/lib/i18n/server";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t, locale } = await getI18n();
  const highlights =
    locale === "ar"
      ? [
          { icon: ShieldCheck, text: "صلاحيات دقيقة لكل عضو في كل مشروع، مطبّقة على مستوى قاعدة البيانات." },
          { icon: ClipboardList, text: "مهام ومستندات ونقاشات منظمة لفريقك البحثي." },
          { icon: History, text: "سجل تدقيق كامل وغير قابل للتعديل لكل تغيير." },
        ]
      : [
          { icon: ShieldCheck, text: "Fine-grained, per-project permissions enforced by the database." },
          { icon: ClipboardList, text: "Tasks, documents and discussions organised for your research team." },
          { icon: History, text: "A complete, immutable audit trail of every change." },
        ];

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.14),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.08),transparent_40%)]" />
        <Brand name={t.app.name} href="/login" className="relative [&>span:first-child]:bg-white/15" />
        <div className="relative space-y-6">
          <p className="text-3xl leading-tight font-semibold text-balance">{t.app.tagline}</p>
          <ul className="space-y-4">
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-primary-foreground/85">
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-primary-foreground/60">
          © {new Date().getFullYear()} {t.common.copyright}
        </p>
      </aside>
      <main className="flex flex-col">
        <div className="flex items-center justify-between p-4">
          <Brand name={t.app.name} href="/login" className="lg:invisible" />
          <div className="flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
