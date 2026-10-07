import { Brand } from "@/components/layout/brand";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NavLinks, type NavKey } from "@/components/layout/nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { NotificationBell } from "@/components/layout/notification-bell";
import { getMyProjectsAccess } from "@/server/access";
import { requireCurrentProfile } from "@/server/auth";
import { countUnreadNotifications } from "@/server/queries/notifications";
import { listMyTeamMemberships } from "@/server/queries/teams";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireCurrentProfile();
  const [access, { t }, unread, teams] = await Promise.all([
    getMyProjectsAccess(),
    getI18n(),
    countUnreadNotifications(),
    listMyTeamMemberships(profile.id),
  ]);

  // Navigation only lists pages the user can actually use. The pages and the
  // database re-check permissions independently.
  const anywhere = (permission: Parameters<typeof can>[1]) => access.some((item) => can(item, permission));
  const visible: NavKey[] = ["dashboard", "projects"];
  if (anywhere("project.view")) visible.push("tasks", "schedule");
  if (teams.length > 0 || anywhere("project.view")) visible.push("results");
  if (profile.isDirector || teams.length > 0) visible.push("teams");
  if (anywhere("tasks.view")) visible.push("reports");
  if (anywhere("documents.view")) visible.push("documents");
  if (anywhere("team.view")) visible.push("team");
  if (anywhere("activity.view") || profile.isPlatformAdmin) visible.push("activity");
  visible.push("settings");

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b px-5">
          <Brand name={t.app.name} />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks visible={visible} />
        </div>
        <div className="border-t p-4 text-xs text-muted-foreground">{t.app.tagline}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 lg:px-8">
          <MobileNav visible={visible} />
          <Brand name={t.app.name} className="lg:hidden" />
          <div className="flex-1" />
          <NotificationBell unread={unread} />
          <LocaleSwitcher />
          <ThemeToggle />
          <UserMenu
            userId={profile.id}
            name={profile.displayName}
            email={profile.email}
            isPlatformAdmin={profile.isPlatformAdmin}
          />
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
