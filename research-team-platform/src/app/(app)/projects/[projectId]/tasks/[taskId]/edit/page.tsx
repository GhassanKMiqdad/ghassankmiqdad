import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { TaskEditor } from "@/components/tasks/task-editor";
import { getI18n } from "@/lib/i18n/server";
import { toAccessDTO } from "@/lib/permissions/access";
import { can, canAssignTasks, canUpdateTask } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { getTask, listAssignableMembersWithRoster } from "@/server/queries/tasks";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.tasks.editTitle };
}

export default async function EditTaskPage(props: PageProps<"/projects/[projectId]/tasks/[taskId]/edit">) {
  const { projectId, taskId } = await props.params;
  if (!z.uuid().safeParse(taskId).success) notFound();

  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null; // denial rendered by the layout

  const [{ t }, task] = await Promise.all([getI18n(), getTask(taskId)]);
  if (!task || task.projectId !== projectId) return <AccessDenied message={t.errors.NOT_FOUND} />;

  const snapshot = { createdBy: task.createdById, assignedTo: task.assignedToId, status: task.status };
  if (!canUpdateTask(access, snapshot)) return <AccessDenied message={t.errors.TASK_EDIT_FORBIDDEN} />;

  const members =
    can(access, "team.view") || canAssignTasks(access) ? await listAssignableMembersWithRoster(projectId, task.teamId) : [];

  return (
    <div className="space-y-6">
      <PageHeader title={t.tasks.editTitle} description={t.tasks.editSubtitle} className="mx-auto max-w-3xl" />
      <TaskEditor
        projectId={projectId}
        projectName={access.projectName}
        teamName={task.teamName}
        access={toAccessDTO(access)}
        members={members}
        task={task}
      />
    </div>
  );
}
