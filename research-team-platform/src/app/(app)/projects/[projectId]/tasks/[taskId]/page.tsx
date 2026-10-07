import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { z } from "zod";

import { ActivityList } from "@/components/activity/activity-list";
import { CommentThread } from "@/components/comments/comment-thread";
import { AccessDenied } from "@/components/shared/access-denied";
import {
  PriorityBadge,
  ScheduleStatusBadge,
  TaskCode,
  TaskStatusBadge,
  VisibilityBadge,
} from "@/components/shared/badges";
import { DateText } from "@/components/shared/date-text";
import { UserAvatar } from "@/components/shared/user-avatar";
import { DeleteTaskButton } from "@/components/tasks/delete-task-button";
import { SubmissionHistory } from "@/components/tasks/submission-history";
import { TaskDependencies } from "@/components/tasks/task-dependencies";
import { TaskExecutionCard } from "@/components/tasks/task-execution-card";
import { TaskTimeline } from "@/components/tasks/task-timeline";
import { TaskWorkflowPanel } from "@/components/tasks/task-workflow-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { toAccessDTO } from "@/lib/permissions/access";
import {
  can,
  canDeleteTasks,
  canSuperviseTasks,
  canUpdateTask,
  canUpdateTaskProgress,
} from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { listActivity } from "@/server/queries/activity";
import { listComments } from "@/server/queries/comments";
import { getTask, listDependencies, listSubmissions, listTaskOptions } from "@/server/queries/tasks";

export async function generateMetadata(props: PageProps<"/projects/[projectId]/tasks/[taskId]">): Promise<Metadata> {
  const { taskId } = await props.params;
  const { t } = await getI18n();
  const task = z.uuid().safeParse(taskId).success ? await getTask(taskId) : null;
  return { title: task ? `${task.code} · ${task.title}` : t.tasks.title };
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end">{children}</dd>
    </div>
  );
}

function TextBlock({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
      <p dir="auto" className="text-start text-sm leading-relaxed whitespace-pre-wrap">
        {value}
      </p>
    </div>
  );
}

export default async function TaskPage(props: PageProps<"/projects/[projectId]/tasks/[taskId]">) {
  const { projectId, taskId } = await props.params;
  if (!z.uuid().safeParse(taskId).success) notFound();

  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null; // denial rendered by the layout

  const [i18n, task] = await Promise.all([getI18n(), getTask(taskId)]);
  const { t, fmt } = i18n;

  // RLS hides private tasks of other members: same answer as for a missing task.
  if (!task || task.projectId !== projectId) {
    return <AccessDenied message={t.errors.NOT_FOUND} />;
  }

  const supervisor = canSuperviseTasks(access);
  const [comments, submissions, dependencies, history] = await Promise.all([
    listComments(projectId, taskId),
    listSubmissions(taskId),
    listDependencies(taskId),
    // The task history is part of the audit log: only shown with activity.view.
    can(access, "activity.view") ? listActivity({ entityId: taskId, pageSize: 30 }) : Promise.resolve(null),
  ]);
  const options = supervisor
    ? await listTaskOptions(projectId, [taskId, ...dependencies.map((dependency) => dependency.taskId)])
    : [];

  const dto = toAccessDTO(access);
  const snapshot = { createdBy: task.createdById, assignedTo: task.assignedToId, status: task.status };
  const editable = canUpdateTask(access, snapshot);
  const planned = task.plannedStartAt || task.dueAt;

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
          <TaskCode code={task.code} className="text-xs" />
          <h2 dir="auto" className="text-xl font-semibold break-words">
            {task.title}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <ScheduleStatusBadge status={task.scheduleStatus} />
            <VisibilityBadge visibility={task.visibility} />
          </div>
        </div>
        <div className="flex gap-2">
          {editable ? (
            <Button variant="outline" asChild>
              <Link href={`/projects/${projectId}/tasks/${task.id}/edit`}>
                <Pencil aria-hidden />
                {t.common.edit}
              </Link>
            </Button>
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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.workflow.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskWorkflowPanel
                task={{ ...snapshot, id: task.id, isBlocked: task.isBlocked, hasSubmissions: submissions.length > 0 }}
                access={dto}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.tasks.sections.basic}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TextBlock label={t.tasks.fields.originalInstructions} value={task.originalInstructions} />
              <TextBlock label={t.tasks.fields.description} value={task.description} />
              <TextBlock label={t.tasks.fields.expectedOutput} value={task.expectedOutput} />
              <TextBlock label={t.tasks.fields.completionCriteria} value={task.completionCriteria} />
              {!task.originalInstructions && !task.description && !task.expectedOutput && !task.completionCriteria ? (
                <p className="text-sm text-muted-foreground">{t.common.noDescription}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.workflow.progressTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskExecutionCard
                taskId={task.id}
                progress={task.progress}
                workNotes={task.workNotes}
                editable={canUpdateTaskProgress(access, snapshot)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.submissions.title}</CardTitle>
              <CardDescription>{t.tasks.visibilityHint[task.visibility]}</CardDescription>
            </CardHeader>
            <CardContent>
              <SubmissionHistory submissions={submissions} />
            </CardContent>
          </Card>

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
                <DetailRow label={t.tasks.fields.assignee}>
                  {task.assignee ? (
                    <span className="inline-flex items-center gap-2">
                      <UserAvatar name={task.assignee.name} seed={task.assignee.id} className="size-6" />
                      <span className="text-start">
                        <span className="block">{task.assignee.name}</span>
                        <span className="block text-xs text-muted-foreground">{task.assigneeTitle ?? t.tasks.noJobTitle}</span>
                      </span>
                    </span>
                  ) : (
                    t.tasks.unassigned
                  )}
                </DetailRow>
                <DetailRow label={t.tasks.fields.project}>{task.projectName}</DetailRow>
                {task.teamName ? <DetailRow label={t.tasks.fields.team}>{task.teamName}</DetailRow> : null}
                <DetailRow label={t.tasks.fields.planningWeek}>
                  {task.planningWeek
                    ? fmt(t.tasks.planLabel, { month: String(task.planningMonth).padStart(2, "0"), week: task.planningWeek })
                    : fmt(t.tasks.planMonthOnly, { month: String(task.planningMonth).padStart(2, "0") })}
                </DetailRow>
                {planned ? (
                  <>
                    <DetailRow label={t.tasks.fields.plannedStart}>
                      <DateText value={task.plannedStartAt} style="datetime" fallback="—" />
                    </DetailRow>
                    <DetailRow label={t.tasks.fields.duration}>
                      {task.plannedDuration && task.durationUnit
                        ? fmt(t.tasks.durationValue, {
                            value: i18n.number(task.plannedDuration),
                            unit: t.durationUnits[task.durationUnit],
                          })
                        : "—"}
                    </DetailRow>
                    <DetailRow label={t.tasks.fields.dueAt}>
                      <DateText value={task.dueAt} style="datetime" fallback="—" />
                    </DetailRow>
                  </>
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-2 text-center text-xs font-semibold tracking-wide text-muted-foreground">
                    {t.tasks.scheduleNotDefined}
                  </p>
                )}
                <DetailRow label={t.tasks.fields.actualStart}>
                  <DateText value={task.actualStartAt} style="datetime" fallback="—" />
                </DetailRow>
                <DetailRow label={t.tasks.fields.submittedAt}>
                  <DateText value={task.submittedAt} style="datetime" fallback="—" />
                </DetailRow>
                <DetailRow label={t.tasks.fields.approvedAt}>
                  <DateText value={task.approvedAt} style="datetime" fallback="—" />
                </DetailRow>
                <DetailRow label={t.tasks.fields.completedAt}>
                  <DateText value={task.completedAt} style="datetime" fallback="—" />
                </DetailRow>
                <DetailRow label={t.tasks.fields.createdBy}>{task.createdBy?.name ?? t.common.unknownUser}</DetailRow>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.timeline.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskTimeline task={task} submissions={submissions} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.dependencies.title}</CardTitle>
              <CardDescription>{t.dependencies.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <TaskDependencies
                projectId={projectId}
                taskId={task.id}
                dependencies={dependencies}
                options={options}
                editable={supervisor && task.status !== "completed"}
              />
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
