import type { Metadata } from "next";
import { Network, Pencil, Plus } from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { EmptyState } from "@/components/shared/empty-state";
import { OrgRoleBadge } from "@/components/shared/badges";
import { PageHeader } from "@/components/shared/page-header";
import { TeamDialog } from "@/components/teams/team-dialogs";
import { DirectorSwitch, TeamProjects, TeamRoster } from "@/components/teams/team-roster";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getI18n } from "@/lib/i18n/server";
import { getMyProjectsAccess } from "@/server/access";
import { requireCurrentProfile } from "@/server/auth";
import { getTeamRoster, listDirectorCandidates, listMyTeamMemberships, listTeams } from "@/server/queries/teams";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.teams.title };
}

/**
 * Organization structure. Only the Director can change teams, rosters,
 * project links and roles; Team Leads and members see their own teams.
 */
export default async function TeamsPage() {
  const profile = await requireCurrentProfile();
  const director = profile.isDirector;
  const [{ t, fmt, number }, teams, myTeams, access] = await Promise.all([
    getI18n(),
    listTeams(),
    listMyTeamMemberships(profile.id),
    getMyProjectsAccess(),
  ]);

  const visibleTeams = director ? teams : teams.filter((team) => myTeams.some((mine) => mine.teamId === team.id));
  if (!director && visibleTeams.length === 0) return <AccessDenied message={t.teams.directorOnly} />;

  const [rosters, people] = await Promise.all([
    Promise.all(visibleTeams.map((team) => getTeamRoster(team.id, director))),
    director ? listDirectorCandidates() : Promise.resolve([]),
  ]);
  const unlinkedProjects = access
    .filter((item) => !teams.some((team) => team.projects.some((project) => project.id === item.projectId)))
    .map((item) => ({ id: item.projectId, name: item.projectName }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.teams.title}
        description={director ? t.teams.subtitle : t.teams.directorOnly}
        actions={
          director ? (
            <TeamDialog
              trigger={
                <Button>
                  <Plus aria-hidden />
                  {t.teams.new}
                </Button>
              }
            />
          ) : null
        }
      />

      {visibleTeams.length === 0 ? (
        <EmptyState icon={Network} title={t.teams.empty} description={t.teams.emptyHint} />
      ) : null}

      {visibleTeams.map((team, index) => (
        <Card key={team.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1">
              <CardTitle>{team.name}</CardTitle>
              <CardDescription>
                {team.description ? `${team.description} · ` : ""}
                {fmt(t.teams.membersCount, { count: number(team.memberCount) })}
              </CardDescription>
            </div>
            {director ? (
              <TeamDialog
                team={team}
                trigger={
                  <Button variant="outline" size="sm">
                    <Pencil aria-hidden />
                    {t.common.edit}
                  </Button>
                }
              />
            ) : null}
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t.teams.roster}</h3>
              <p className="text-xs text-muted-foreground">{t.teams.rosterDescription}</p>
              <TeamRoster teamId={team.id} roster={rosters[index]} editable={director} />
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t.teams.projects}</h3>
              <p className="text-xs text-muted-foreground">{t.teams.projectsDescription}</p>
              <TeamProjects teamId={team.id} linked={team.projects} candidates={unlinkedProjects} editable={director} />
            </section>
          </CardContent>
        </Card>
      ))}

      {director ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <OrgRoleBadge role="director" />
              {t.teams.directors}
            </CardTitle>
            <CardDescription>{t.orgRoles.descriptions.director}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-3">{t.common.name}</TableHead>
                    <TableHead>{t.common.email}</TableHead>
                    <TableHead className="pe-3 text-end">{t.teams.makeDirector}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {people.map((person) => (
                    <TableRow key={person.id}>
                      <TableCell className="ps-3 font-medium">{person.name}</TableCell>
                      <TableCell className="text-muted-foreground" dir="ltr">
                        {person.email}
                      </TableCell>
                      <TableCell className="pe-3 text-end">
                        <DirectorSwitch userId={person.id} isDirector={person.isDirector} self={person.id === profile.id} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
