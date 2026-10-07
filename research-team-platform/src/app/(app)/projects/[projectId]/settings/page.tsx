import type { Metadata } from "next";

import { DeleteProject, TransferOwnership } from "@/components/projects/project-danger-zone";
import { ProjectForm } from "@/components/projects/project-form";
import { AccessDenied } from "@/components/shared/access-denied";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { getProjectDetails } from "@/server/queries/projects";
import { listAssignableMembers } from "@/server/queries/tasks";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.projects.tabs.settings };
}

export default async function ProjectSettingsPage(props: PageProps<"/projects/[projectId]/settings">) {
  const { projectId } = await props.params;
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null;

  const { t } = await getI18n();
  const canEdit = can(access, "project.edit");
  const canDelete = can(access, "project.delete");
  if (!canEdit && !canDelete && !access.isOwner) return <AccessDenied />;

  const [project, members] = await Promise.all([
    getProjectDetails(projectId),
    access.isOwner ? listAssignableMembers(projectId) : Promise.resolve([]),
  ]);
  if (!project) return <AccessDenied message={t.errors.PROJECT_ACCESS_DENIED} />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.projects.settings.general}</CardTitle>
          <CardDescription>{t.projects.settings.generalDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm
            mode="edit"
            projectId={projectId}
            readOnly={!canEdit}
            defaults={{
              name: project.name,
              description: project.description,
              researchGoal: project.researchGoal,
              researchType: project.researchType,
              researchObjectives: project.researchObjectives,
              researchQuestions: project.researchQuestions,
              methodology: project.methodology,
              status: project.status,
              priority: project.priority,
              startDate: project.startDate,
              deadline: project.deadline,
            }}
          />
        </CardContent>
      </Card>

      {access.isOwner || canDelete ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">{t.projects.settings.dangerZone}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            {access.isOwner ? (
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">{t.projects.settings.transferTitle}</h3>
                  <p className="text-sm text-muted-foreground">{t.projects.settings.transferDescription}</p>
                </div>
                <TransferOwnership
                  projectId={projectId}
                  candidates={members.filter((member) => member.id !== access.userId)}
                />
              </section>
            ) : null}
            {canDelete ? (
              <section className="space-y-3 border-t pt-6">
                <div>
                  <h3 className="text-sm font-semibold">{t.projects.deleteTitle}</h3>
                  <p className="text-sm text-muted-foreground">{t.projects.deleteDescription}</p>
                </div>
                <DeleteProject projectId={projectId} projectName={project.name} />
              </section>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
