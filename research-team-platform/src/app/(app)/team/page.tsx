import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Users } from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { MemberStatusBadge, RoleBadge } from "@/components/shared/badges";
import { PageHeader } from "@/components/shared/page-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getMyProjectsAccess } from "@/server/access";
import { getProjectTeam } from "@/server/queries/team";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.team.title };
}

export default async function TeamOverviewPage() {
  const [{ t, fmt }, access] = await Promise.all([getI18n(), getMyProjectsAccess()]);
  const projects = access.filter((item) => can(item, "team.view"));
  if (projects.length === 0) return <AccessDenied message={t.team.noTeamAccess} />;

  const teams = await Promise.all(
    projects.map(async (project) => ({ project, members: await getProjectTeam(project.projectId) })),
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t.team.title} description={t.team.subtitle} />
      <div className="grid gap-6 lg:grid-cols-2">
        {teams.map(({ project, members }) => (
          <Card key={project.projectId}>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <CardTitle className="truncate">{project.projectName}</CardTitle>
                <CardDescription className="flex items-center gap-1.5">
                  <Users className="size-3.5" aria-hidden />
                  {fmt(t.team.membersCount, { count: members.length })}
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/projects/${project.projectId}/team`}>
                  {t.team.manageTeam}
                  <ArrowUpRight className="rtl:-scale-x-100" aria-hidden />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {members.map((member) => (
                  <li key={member.userId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <UserAvatar name={member.displayName} seed={member.userId} />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/projects/${project.projectId}/team/${member.userId}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {member.displayName}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        <span dir="ltr">{member.email}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      <RoleBadge role={member.role} />
                      <MemberStatusBadge status={member.status} pending={!member.lastSignInAt} />
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
