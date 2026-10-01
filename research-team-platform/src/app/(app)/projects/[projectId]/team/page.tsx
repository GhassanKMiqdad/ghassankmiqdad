import type { Metadata } from "next";

import { AccessDenied } from "@/components/shared/access-denied";
import { AddMemberDialog } from "@/components/team/add-member-dialog";
import { TeamTable } from "@/components/team/team-table";
import { getI18n } from "@/lib/i18n/server";
import { toAccessDTO } from "@/lib/permissions/access";
import { assignableRoles, can } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { getProjectTeam } from "@/server/queries/team";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.team.title };
}

export default async function ProjectTeamPage(props: PageProps<"/projects/[projectId]/team">) {
  const { projectId } = await props.params;
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null;

  const { t } = await getI18n();
  if (!can(access, "team.view")) return <AccessDenied />;

  const team = await getProjectTeam(projectId);
  const roles = assignableRoles(access);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t.team.projectSubtitle}</p>
        {can(access, "members.add") && roles.length > 0 ? (
          <AddMemberDialog projectId={projectId} roles={roles} />
        ) : null}
      </div>
      <TeamTable projectId={projectId} members={team} access={toAccessDTO(access)} />
    </div>
  );
}
