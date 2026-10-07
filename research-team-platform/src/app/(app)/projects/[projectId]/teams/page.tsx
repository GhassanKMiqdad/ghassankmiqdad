import Link from "next/link";
import { notFound } from "next/navigation";
import { FolderKanban, UsersRound } from "lucide-react";
import { z } from "zod";

import { EmptyState } from "@/components/shared/empty-state";
import { TeamFormDialog } from "@/components/research/team-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { listResearchTeams } from "@/server/queries/research";

export default async function ResearchTeamsPage(props: PageProps<"/projects/[projectId]/teams">) {
  const { projectId } = await props.params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const [i18n, access] = await Promise.all([getI18n(), getProjectAccess(projectId)]);
  if (!access || !can(access, "project.view")) return null;
  const { t } = i18n;
  const [teams] = await Promise.all([listResearchTeams(projectId)]);
  const canManage = access.isOwner || can(access, "members.manage");

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t.researchTeams.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t.researchTeams.subtitle}</p>
        </div>
        {canManage ? <TeamFormDialog projectId={projectId} /> : null}
      </header>
      {teams.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title={t.researchTeams.empty}
          description={t.researchTeams.emptyHint}
          action={canManage ? <TeamFormDialog projectId={projectId} /> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <Card key={team.id} className="min-w-0">
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">{team.name}</CardTitle>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {team.description || t.common.noDescription}
                  </p>
                </div>
                <Badge variant={team.status === "active" ? "success" : "outline"}>
                  {team.status === "active" ? t.researchTeams.active : t.researchTeams.archived}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-1">
                    {t.researchTeams.memberCount.replace("{count}", String(team.memberCount))}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-1">
                    {t.researchTeams.openTasks.replace("{count}", String(team.openTaskCount))}
                  </span>
                </div>
                <Link
                  href={`/projects/${projectId}/teams/${team.id}`}
                  className="inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"
                >
                  <FolderKanban className="size-4" aria-hidden />
                  {t.researchTeams.viewTeam}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
