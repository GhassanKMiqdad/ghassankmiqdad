import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList, UserRound, UsersRound } from "lucide-react";

import { ResearcherInviteDialog } from "@/components/research/researcher-invite-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { MemberStatusBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getI18n } from "@/lib/i18n/server";
import { getCurrentProfile } from "@/server/auth";
import { listMyProjects } from "@/server/queries/projects";
import { listResearcherProfiles } from "@/server/queries/research";

export default async function ResearchersDirectoryPage() {
  const [profile, i18n] = await Promise.all([getCurrentProfile(), getI18n()]);
  if (!profile?.isPlatformAdmin) notFound();
  const { t } = i18n;
  const [researchers, projects] = await Promise.all([listResearcherProfiles(), listMyProjects()]);
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t.researchers.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t.researchers.subtitle}</p>
        </div>
        <ResearcherInviteDialog projects={projects} />
      </header>
      {researchers.length === 0 ? (
        <EmptyState icon={UserRound} title={t.researchers.empty} description={t.researchers.inviteHint} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {researchers.map((researcher) => (
            <Card key={researcher.id} className="min-w-0">
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserRound className="size-5" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{researcher.fullName || researcher.email}</CardTitle>
                    <p className="truncate text-sm text-muted-foreground" dir="ltr">
                      {researcher.email}
                    </p>
                  </div>
                </div>
                {researcher.status === "active" ? (
                  <MemberStatusBadge status="active" />
                ) : (
                  <Badge variant={researcher.status === "suspended" ? "destructive" : "outline"}>
                    {researcher.status === "suspended" ? t.researchers.suspended : t.researchers.inactive}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {researcher.specialization ? (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{researcher.specialization}</p>
                ) : null}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-muted/60 p-2">
                    <p className="text-lg font-semibold">{researcher.activeTaskCount}</p>
                    <p className="text-xs text-muted-foreground">{t.researchers.workload}</p>
                  </div>
                  <div className="rounded-md bg-muted/60 p-2">
                    <p className="text-lg font-semibold">{researcher.assignedProjects.length}</p>
                    <p className="text-xs text-muted-foreground">{t.researchers.projects}</p>
                  </div>
                  <div className="rounded-md bg-muted/60 p-2">
                    <p className="text-lg font-semibold">{researcher.assignedTeams.length}</p>
                    <p className="text-xs text-muted-foreground">{t.researchers.teams}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                    <ClipboardList className="size-3" aria-hidden />
                    {t.researchers.overdueTasks}: {researcher.overdueTaskCount}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                    <UsersRound className="size-3" aria-hidden />
                    {t.researchers.completedTasks}: {researcher.completedTaskCount}
                  </span>
                </div>
                <Link
                  href={`/researchers/${researcher.id}`}
                  className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
                >
                  {t.common.details}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
