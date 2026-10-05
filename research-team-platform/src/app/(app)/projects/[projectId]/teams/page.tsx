import type { Metadata } from "next";

import { TeamWorkspace } from "@/components/research/team-workspace";
import { AccessDenied } from "@/components/shared/access-denied";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { getActiveProjectResearchers, getProjectTeams } from "@/server/queries/research";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.research.teamsTitle };
}

export default async function ProjectTeamsPage(props: PageProps<"/projects/[projectId]/teams">) {
  const { projectId } = await props.params;
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null;
  if (!can(access, "team.view")) return <AccessDenied />;
  const [{ t }, teams, researchers] = await Promise.all([
    getI18n(),
    getProjectTeams(projectId),
    getActiveProjectResearchers(projectId),
  ]);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t.research.teamsDescription}</p>
      <TeamWorkspace
        projectId={projectId}
        teams={teams}
        researchers={researchers}
        canManage={can(access, "members.manage")}
        canAddMembers={can(access, "members.add")}
        canRemoveMembers={can(access, "members.remove")}
      />
    </div>
  );
}
