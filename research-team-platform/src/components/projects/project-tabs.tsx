"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export type ProjectTabKey =
  "overview" | "tasks" | "teams" | "milestones" | "documents" | "team" | "activity" | "settings";

export function ProjectTabs({ projectId, tabs }: { projectId: string; tabs: ProjectTabKey[] }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto border-b" aria-label={t.nav.projects}>
      {tabs.map((tab) => {
        const href = tab === "overview" ? base : `${base}/${tab}`;
        const active = tab === "overview" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 border-transparent px-3 py-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              active && "border-primary text-foreground",
            )}
          >
            {t.projects.tabs[tab]}
          </Link>
        );
      })}
    </nav>
  );
}
