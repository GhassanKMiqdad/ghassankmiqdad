import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { SubmissionWorkflow } from "@/components/submissions/submission-workflow";
import { can } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { listMySubmittableDocuments, listTaskSubmissionHistory } from "@/server/queries/submissions";
import { listTaskDeliverables } from "@/server/queries/deliverables";
import { getTask } from "@/server/queries/tasks";

export default async function SubmissionHistoryPage(
  props: PageProps<"/projects/[projectId]/tasks/[taskId]/submissions">,
) {
  const { projectId, taskId } = await props.params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(taskId).success) notFound();

  const access = await getProjectAccess(projectId);
  if (!access || access.status !== "active" || !can(access, "project.view")) notFound();
  const task = await getTask(taskId);
  if (!task || task.projectId !== projectId) notFound();
  const isAssignee = task.assignedToId === access.userId;
  const canReview = can(access, "tasks.review") && ["submitted", "under_review"].includes(task.status);
  const canSubmit =
    isAssignee && can(access, "tasks.submit") && (task.status === "in_progress" || task.status === "revision_required");
  const canViewAll = can(access, "tasks.view") || canReview;
  if (!isAssignee && !canViewAll) notFound();

  const [submissions, documents, deliverables] = await Promise.all([
    listTaskSubmissionHistory(projectId, taskId),
    canSubmit ? listMySubmittableDocuments(projectId, task.teamId) : Promise.resolve([]),
    listTaskDeliverables(projectId, taskId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Submission history — ${task.title}`}
        description="Versioned work and formal review decisions for this task."
      />
      <Button asChild variant="outline">
        <Link href={`/projects/${projectId}/tasks/${taskId}`}>Back to task</Link>
      </Button>
      <SubmissionWorkflow
        taskId={taskId}
        submissions={submissions}
        documents={documents}
        deliverables={deliverables}
        canSubmit={canSubmit}
        canReview={canReview}
        canManageDeliverables={can(access, "tasks.edit")}
      />
    </div>
  );
}
