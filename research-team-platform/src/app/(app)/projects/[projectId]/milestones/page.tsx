import { notFound } from "next/navigation";
import { CalendarClock, CircleAlert, Flag } from "lucide-react";
import { z } from "zod";

import { CompleteMilestoneButton } from "@/components/research/complete-milestone-button";
import { MilestoneFormDialog } from "@/components/research/milestone-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { DateText } from "@/components/shared/date-text";
import { AccessDenied } from "@/components/shared/access-denied";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { listResearchTeams, listProjectMilestones } from "@/server/queries/research";
import { listAssignableMembers } from "@/server/queries/tasks";
import type { ResearchMilestone } from "@/types/research";

function milestoneState(milestone: ResearchMilestone) {
  const today = new Date().toISOString().slice(0, 10);
  if (milestone.status !== "completed" && milestone.deadline && milestone.deadline < today) return "overdue" as const;
  return milestone.status;
}

export default async function ProjectMilestonesPage(props: PageProps<"/projects/[projectId]/milestones">) {
  const { projectId } = await props.params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const [i18n, access] = await Promise.all([getI18n(), getProjectAccess(projectId)]);
  if (!access || !can(access, "project.view")) return <AccessDenied message={i18n.t.errors.PROJECT_ACCESS_DENIED} />;
  const { t } = i18n;
  const canManage = access.isOwner || can(access, "members.manage");
  const [milestones, teams, members] = await Promise.all([
    listProjectMilestones(projectId),
    canManage ? listResearchTeams(projectId) : Promise.resolve([]),
    canManage ? listAssignableMembers(projectId) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t.milestones.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t.milestones.subtitle}</p>
        </div>
        {canManage ? <MilestoneFormDialog projectId={projectId} teams={teams} members={members} /> : null}
      </header>
      {milestones.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={t.milestones.empty}
          description={t.milestones.emptyHint}
          action={canManage ? <MilestoneFormDialog projectId={projectId} teams={teams} members={members} /> : undefined}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {milestones.map((milestone) => {
            const state = milestoneState(milestone);
            const label =
              state === "overdue"
                ? t.milestones.overdue
                : state === "at_risk"
                  ? t.milestones.atRisk
                  : state === "in_progress"
                    ? t.milestones.inProgress
                    : state === "completed"
                      ? t.milestones.completed
                      : t.milestones.pending;
            const assignedToCurrentUser = milestone.responsibleResearcherId === access.userId;
            return (
              <Card key={milestone.id} className="min-w-0">
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                  <div className="min-w-0">
                    <CardTitle className="text-base break-words">{milestone.name}</CardTitle>
                    <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">
                      {milestone.description || t.common.noDescription}
                    </p>
                  </div>
                  <Badge
                    variant={
                      state === "overdue"
                        ? "destructive"
                        : state === "completed"
                          ? "success"
                          : state === "at_risk"
                            ? "warning"
                            : "info"
                    }
                  >
                    {label}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="size-4" aria-hidden />
                      {t.milestones.deadline}: <DateText value={milestone.deadline} fallback={t.tasks.noDueDate} />
                    </span>
                    {state === "overdue" ? (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <CircleAlert className="size-4" aria-hidden />
                        {t.milestones.overdue}
                      </span>
                    ) : null}
                  </div>
                  {canManage ? (
                    <MilestoneFormDialog projectId={projectId} milestone={milestone} teams={teams} members={members} />
                  ) : null}
                  {!canManage && assignedToCurrentUser && state !== "completed" ? (
                    <CompleteMilestoneButton milestone={milestone} />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
