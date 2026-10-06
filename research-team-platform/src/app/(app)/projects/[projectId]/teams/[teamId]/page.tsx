import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardList, UsersRound } from "lucide-react";
import { z } from "zod";

import { ArchiveTeamButton } from "@/components/research/archive-team-button";
import { TeamFormDialog } from "@/components/research/team-form-dialog";
import { TeamMembershipManager } from "@/components/research/team-membership-manager";
import { AccessDenied } from "@/components/shared/access-denied";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { listAssignableMembers } from "@/server/queries/tasks";
import { getResearchTeamMembers, listResearchTeams } from "@/server/queries/research";

export default async function ResearchTeamDetailPage(props: PageProps<"/projects/[projectId]/teams/[teamId]">) {
  const { projectId, teamId } = await props.params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(teamId).success) notFound();
  const [i18n, access] = await Promise.all([getI18n(), getProjectAccess(projectId)]);
  if (!access || !can(access, "project.view")) return <AccessDenied message={i18n.t.errors.PROJECT_ACCESS_DENIED} />;
  const { t } = i18n;
  const [teams, members, candidates] = await Promise.all([
    listResearchTeams(projectId),
    getResearchTeamMembers(teamId),
    access.isOwner || can(access, "members.manage") || can(access, "tasks.assign")
      ? listAssignableMembers(projectId)
      : Promise.resolve([]),
  ]);
  const team = teams.find((item) => item.id === teamId);
  if (!team) return <AccessDenied message={t.errors.NOT_FOUND} />;
  const canManage = access.isOwner || can(access, "members.manage");

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}/teams`}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t.researchTeams.title}
      </Link>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h2 className="text-xl font-semibold break-words">{team.name}</h2>
          <p className="max-w-2xl text-sm whitespace-pre-wrap text-muted-foreground">
            {team.description || t.common.noDescription}
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <TeamFormDialog projectId={projectId} team={team} />
            <ArchiveTeamButton teamId={team.id} />
          </div>
        ) : null}
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersRound className="size-4" aria-hidden />
              {t.researchTeams.members}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{team.memberCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="size-4" aria-hidden />
              {t.researchTeams.progress}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{team.openTaskCount}</p>
            <p className="text-sm text-muted-foreground">
              {t.researchTeams.openTasks.replace("{count}", String(team.openTaskCount))}
            </p>
          </CardContent>
        </Card>
      </div>
      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.researchTeams.details}</CardTitle>
          </CardHeader>
          <CardContent>
            <TeamMembershipManager team={team} members={members} candidates={candidates} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t.researchTeams.members}</CardTitle>
          </CardHeader>
          <CardContent>
            {members.length ? (
              <ul className="divide-y rounded-lg border">
                {members.map((member) => (
                  <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span className="text-sm">{member.fullName || member.email}</span>
                    {member.role === "lead" ? (
                      <span className="text-xs text-muted-foreground">{t.researchTeams.lead}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t.researchTeams.noMembers}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
