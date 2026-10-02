import { notFound } from "next/navigation";
import { z } from "zod";

import { ExportMenu } from "@/components/projects/export-menu";
import { ProjectTabs, type ProjectTabKey } from "@/components/projects/project-tabs";
import { AccessDenied } from "@/components/shared/access-denied";
import { ProjectStatusBadge, RoleBadge } from "@/components/shared/badges";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";

export default async function ProjectLayout(props: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await props.params;
  if (!z.uuid().safeParse(projectId).success) notFound();

  const [{ t }, access] = await Promise.all([getI18n(), getProjectAccess(projectId)]);

  // Non-members and members without access get the same answer, so the
  // existence of a project is never disclosed.
  if (!access) return <AccessDenied message={t.errors.PROJECT_ACCESS_DENIED} />;
  if (access.status === "suspended") return <AccessDenied message={t.projects.accessSuspended} />;
  if (!can(access, "project.view")) return <AccessDenied message={t.errors.PROJECT_ACCESS_DENIED} />;

  const tabs: ProjectTabKey[] = ["overview", "tasks"];
  if (can(access, "documents.view")) tabs.push("documents");
  if (can(access, "team.view")) tabs.push("team");
  if (can(access, "activity.view")) tabs.push("activity");
  if (can(access, "project.edit") || can(access, "project.delete") || access.isOwner) tabs.push("settings");

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight break-words">{access.projectName}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <ProjectStatusBadge status={access.projectStatus} />
              <span>{t.projects.yourRole}:</span>
              <RoleBadge role={access.role} />
            </div>
          </div>
          {can(access, "data.export") ? <ExportMenu projectId={projectId} /> : null}
        </div>
        <ProjectTabs projectId={projectId} tabs={tabs} />
      </div>
      {props.children}
    </div>
  );
}
