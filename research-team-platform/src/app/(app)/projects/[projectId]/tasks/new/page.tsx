import type { Metadata } from "next";

import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { TaskEditor } from "@/components/tasks/task-editor";
import { getI18n } from "@/lib/i18n/server";
import { toAccessDTO } from "@/lib/permissions/access";
import { can, canAssignTasks } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { listAssignableMembersWithRoster } from "@/server/queries/tasks";
import { getProjectTeam } from "@/server/queries/teams";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.tasks.createTitle };
}

export default async function NewTaskPage(props: PageProps<"/projects/[projectId]/tasks/new">) {
  const { projectId } = await props.params;
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null; // denial rendered by the layout

  const { t } = await getI18n();
  if (!can(access, "tasks.create")) return <AccessDenied message={t.errors.PERMISSION_DENIED} />;

  const team = await getProjectTeam(projectId);
  const members =
    can(access, "team.view") || canAssignTasks(access)
      ? await listAssignableMembersWithRoster(projectId, team?.id ?? null)
      : [];

  return (
    <div className="space-y-6">
      <PageHeader title={t.tasks.createTitle} description={t.tasks.createSubtitle} className="mx-auto max-w-3xl" />
      <TaskEditor
        projectId={projectId}
        projectName={access.projectName}
        teamName={team?.name ?? null}
        access={toAccessDTO(access)}
        members={members}
      />
    </div>
  );
}
