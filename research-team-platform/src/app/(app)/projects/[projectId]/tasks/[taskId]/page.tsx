import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { z } from "zod";

import { ActivityList } from "@/components/activity/activity-list";
import { CommentThread } from "@/components/comments/comment-thread";
import { AccessDenied } from "@/components/shared/access-denied";
import { OverdueBadge, PriorityBadge, TaskStatusBadge } from "@/components/shared/badges";
import { DateText } from "@/components/shared/date-text";
import { UserAvatar } from "@/components/shared/user-avatar";
import { DeleteTaskButton } from "@/components/tasks/delete-task-button";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { TaskProgressEditor } from "@/components/tasks/task-progress-editor";
import { TaskSubmissionPanel } from "@/components/research/task-submission-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { toAccessDTO } from "@/lib/permissions/access";
import { can, canAssignTasks, canDeleteTasks, canUpdateTask } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { listActivity } from "@/server/queries/activity";
import { listComments } from "@/server/queries/comments";
import { getTask, listAssignableMembers } from "@/server/queries/tasks";
import { listResearchTeams } from "@/server/queries/research";
import { listTaskSubmissionHistory } from "@/server/queries/research";

export async function generateMetadata(props: PageProps<"/projects/[projectId]/tasks/[taskId]">): Promise<Metadata> {
  const { taskId } = await props.params;
  const { t } = await getI18n();
  const task = z.uuid().safeParse(taskId).success ? await getTask(taskId) : null;
  return { title: task?.title ?? t.tasks.title };
}

export default async function TaskPage(props: PageProps<"/projects/[projectId]/tasks/[taskId]">) {
  const { projectId, taskId } = await props.params;
  if (!z.uuid().safeParse(taskId).success) notFound();

  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null; // denial rendered by the layout

  const [i18n, task] = await Promise.all([getI18n(), getTask(taskId)]);
  const { t } = i18n;

  // RLS hides tasks the user may not see: same answer as for a missing task.
  if (!task || task.projectId !== projectId) {
    return <AccessDenied message={t.errors.NOT_FOUND} />;
  }

  const [comments, members, history, teams, submissions] = await Promise.all([
    listComments(projectId, taskId),
    can(access, "team.view") || canAssignTasks(access) ? listAssignableMembers(projectId) : Promise.resolve([]),
    // The task history is part of the audit log: only shown with activity.view.
    can(access, "activity.view") ? listActivity({ entityId: taskId, pageSize: 20 }) : Promise.resolve(null),
    access.isOwner || can(access, "members.manage") || can(access, "team.view")
      ? listResearchTeams(projectId)
      : Promise.resolve([]),
    listTaskSubmissionHistory(taskId),
  ]);

  const dto = toAccessDTO(access);
  const snapshot = { createdBy: task.createdById, assignedTo: task.assignedToId, status: task.status };
  const editable = canUpdateTask(access, snapshot);
  const memberOptions =
    members.length > 0
      ? members
      : [...(task.assignee ? [{ id: task.assignee.id, name: task.assignee.name, role: "member" as const }] : [])];

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}/tasks`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t.tasks.backToTasks}
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h2 className="text-xl font-semibold break-words">{task.title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.isOverdue ? <OverdueBadge /> : null}
          </div>
        </div>
        <div className="flex gap-2">
          {editable ? (
            <TaskFormDialog
              projectId={projectId}
              access={dto}
              members={memberOptions}
              teams={teams}
              task={task}
              trigger={
                <Button variant="outline">
                  <Pencil aria-hidden />
                  {t.common.edit}
                </Button>
              }
            />
          ) : null}
          {canDeleteTasks(access) ? (
            <DeleteTaskButton
              taskId={task.id}
              redirectTo={`/projects/${projectId}/tasks`}
              trigger={
                <Button variant="outline" className="text-destructive hover:text-destructive">
                  <Trash2 aria-hidden />
                  {t.common.delete}
                </Button>
              }
            />
          ) : null}
        </div>
      </div>

      {!editable ? <p className="text-sm text-muted-foreground">{t.tasks.readOnly}</p> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <TaskSubmissionPanel task={task} access={dto} history={submissions} />
          {task.assignedToId === access.userId &&
          (can(access, "tasks.update_progress") || can(access, "tasks.add_work_notes")) ? (
            <TaskProgressEditor
              taskId={task.id}
              progress={task.progress}
              workNotes={task.workNotes}
              canUpdateProgress={can(access, "tasks.update_progress")}
              canAddWorkNotes={can(access, "tasks.add_work_notes")}
            />
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{t.tasks.fields.description}</CardTitle>
            </CardHeader>
            <CardContent>
              <p dir="auto" className="text-start text-sm leading-relaxed whitespace-pre-wrap">
                {task.description || t.common.noDescription}
              </p>
            </CardContent>
          </Card>
          {task.expectedOutput ? (
            <Card>
              <CardHeader>
                <CardTitle>{t.tasks.fields.expectedOutput}</CardTitle>
              </CardHeader>
              <CardContent>
                <p dir="auto" className="text-start text-sm leading-relaxed whitespace-pre-wrap">
                  {task.expectedOutput}
                </p>
              </CardContent>
            </Card>
          ) : null}
          {task.requiredDeliverables ? (
            <Card>
              <CardHeader>
                <CardTitle>{t.tasks.fields.requiredDeliverables}</CardTitle>
              </CardHeader>
              <CardContent>
                <p dir="auto" className="text-start text-sm leading-relaxed whitespace-pre-wrap">
                  {task.requiredDeliverables}
                </p>
              </CardContent>
            </Card>
          ) : null}
          {task.workNotes && task.assignedToId !== access.userId && can(access, "tasks.view") ? (
            <Card>
              <CardHeader>
                <CardTitle>{t.tasks.fields.workNotes}</CardTitle>
              </CardHeader>
              <CardContent>
                <p dir="auto" className="text-start text-sm leading-relaxed whitespace-pre-wrap">
                  {task.workNotes}
                </p>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{t.comments.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentThread projectId={projectId} taskId={task.id} comments={comments} access={dto} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t.common.details}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{t.tasks.fields.assignee}</dt>
                  <dd className="flex items-center gap-2">
                    {task.assignee ? (
                      <>
                        <UserAvatar name={task.assignee.name} seed={task.assignee.id} className="size-6" />
                        {task.assignee.name}
                      </>
                    ) : (
                      t.tasks.unassigned
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{t.tasks.fields.dueDate}</dt>
                  <dd>
                    <DateText value={task.dueDate} fallback={t.tasks.noDueDate} />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{t.tasks.fields.createdBy}</dt>
                  <dd>{task.createdBy?.name ?? t.common.unknownUser}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{t.tasks.fields.createdAt}</dt>
                  <dd>
                    <DateText value={task.createdAt} style="datetime" />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{t.tasks.fields.updatedAt}</dt>
                  <dd>
                    <DateText value={task.updatedAt} style="datetime" />
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          {history ? (
            <Card>
              <CardHeader>
                <CardTitle>{t.tasks.history}</CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityList items={history.items} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
