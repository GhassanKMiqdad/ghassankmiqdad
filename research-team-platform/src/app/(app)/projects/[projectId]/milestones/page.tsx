import type { Metadata } from "next";

import { MilestoneWorkspace } from "@/components/research/milestone-workspace";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { getActiveProjectResearchers, getProjectMilestones, getProjectTeams } from "@/server/queries/research";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.research.milestonesTitle };
}

export default async function ProjectMilestonesPage(props: PageProps<"/projects/[projectId]/milestones">) {
  const { projectId } = await props.params;
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null;
  const canViewAssociations = can(access, "team.view") || can(access, "project.edit");
  const [milestones, teams, researchers] = await Promise.all([
    getProjectMilestones(projectId),
    canViewAssociations ? getProjectTeams(projectId) : Promise.resolve([]),
    canViewAssociations ? getActiveProjectResearchers(projectId) : Promise.resolve([]),
  ]);
  const { t } = await getI18n();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t.research.milestonesDescription}</p>
      <MilestoneWorkspace
        projectId={projectId}
        milestones={milestones}
        teams={teams}
        researchers={researchers}
        canManage={can(access, "project.edit")}
      />
    </div>
  );
}
