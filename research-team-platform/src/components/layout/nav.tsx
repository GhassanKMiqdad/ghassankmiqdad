"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  FileText,
  FolderKanban,
  History,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Network,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export type NavKey =
  | "dashboard"
  | "projects"
  | "tasks"
  | "schedule"
  | "results"
  | "teams"
  | "reports"
  | "documents"
  | "team"
  | "activity"
  | "settings";

const NAV_ITEMS: { key: NavKey; href: string; icon: LucideIcon }[] = [
  { key: "dashboard", href: "/workspace", icon: LayoutDashboard },
  { key: "projects", href: "/projects", icon: FolderKanban },
  { key: "tasks", href: "/tasks", icon: ListChecks },
  { key: "schedule", href: "/schedule", icon: CalendarDays },
  { key: "results", href: "/results", icon: Megaphone },
  { key: "teams", href: "/teams", icon: Network },
  { key: "reports", href: "/reports", icon: BarChart3 },
  { key: "documents", href: "/documents", icon: FileText },
  { key: "team", href: "/team", icon: Users },
  { key: "activity", href: "/activity", icon: History },
  { key: "settings", href: "/settings", icon: Settings },
];

/** Navigation links. Items the user has no permission for are not rendered at all. */
export function NavLinks({ visible, onNavigate }: { visible: NavKey[]; onNavigate?: () => void }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const allowed = new Set(visible);

  return (
    <nav aria-label={t.nav.mainNavigation} className="flex flex-col gap-1">
      {NAV_ITEMS.filter((item) => allowed.has(item.key)).map(({ key, href, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={key}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              active && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {t.nav[key]}
          </Link>
        );
      })}
    </nav>
  );
}
