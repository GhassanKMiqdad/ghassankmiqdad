import Link from "next/link";
import { CalendarClock, CalendarDays, Target } from "lucide-react";

import { CommentThread } from "@/components/comments/comment-thread";
import { DateText } from "@/components/shared/date-text";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getI18n } from "@/lib/i18n/server";
import { toAccessDTO } from "@/lib/permissions/access";
import { can } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { listComments } from "@/server/queries/comments";
import { getDashboardStats } from "@/server/queries/dashboard";
import { getProjectDetails } from "@/server/queries/projects";
import { appToday } from "@/server/queries/shared";
import { getProjectTeam } from "@/server/queries/team";

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export default async function ProjectOverviewPage(props: PageProps<"/projects/[projectId]">) {
  const { projectId } = await props.params;
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null; // the layout renders the denial

  const [i18n, project, comments, stats, team] = await Promise.all([
    getI18n(),
    getProjectDetails(projectId),
    listComments(projectId, null),
    getDashboardStats(),
    can(access, "team.view") ? getProjectTeam(projectId) : Promise.resolve([]),
  ]);
  if (!project) return null;

  const { t, fmt } = i18n;
  const progress = stats.projectProgress.find((item) => item.projectId === projectId);
  const total = progress?.total ?? 0;
  const completed = progress?.completed ?? 0;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const today = appToday();
  const remaining = project.deadline ? daysBetween(today, project.deadline) : null;
  const deadlineLabel =
    remaining === null
      ? null
      : remaining > 0
        ? fmt(t.projects.overview.daysLeft, { count: remaining })
        : remaining === 0
          ? t.projects.overview.dueToday
          : t.projects.overview.pastDeadline;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.projects.overview.about}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p dir="auto" className="text-start text-sm leading-relaxed whitespace-pre-wrap">
              {project.description || t.common.noDescription}
            </p>
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Target className="size-4 text-primary" aria-hidden />
                {t.projects.overview.goal}
              </div>
              <p dir="auto" className="text-start text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {project.researchGoal || t.projects.overview.noGoal}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.projects.overview.discussion}</CardTitle>
          </CardHeader>
          <CardContent>
            <CommentThread projectId={projectId} taskId={null} comments={comments} access={toAccessDTO(access)} />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t.projects.overview.progress}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-semibold">{percent}%</span>
              <span className="text-xs text-muted-foreground">
                {fmt(t.dashboard.completedOf, { completed: i18n.number(completed), total: i18n.number(total) })}
              </span>
            </div>
            <Progress value={percent} aria-label={t.projects.overview.progress} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.projects.overview.timeline}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="size-4" aria-hidden />
                  {t.projects.fields.startDate}
                </dt>
                <dd>
                  <DateText value={project.startDate} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <CalendarClock className="size-4" aria-hidden />
                  {t.projects.fields.deadline}
                </dt>
                <dd className="flex items-center gap-2">
                  <DateText value={project.deadline} />
                  {deadlineLabel ? (
                    <Badge variant={remaining !== null && remaining < 0 ? "destructive" : "muted"}>
                      {deadlineLabel}
                    </Badge>
                  ) : null}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-t pt-3">
                <dt className="text-muted-foreground">{t.projects.fields.createdBy}</dt>
                <dd>{project.createdBy?.name ?? t.common.unknownUser}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t.common.created}</dt>
                <dd>
                  <DateText value={project.createdAt} />
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {team.length > 0 ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t.projects.overview.team}</CardTitle>
              <Link href={`/projects/${projectId}/team`} className="text-xs font-medium text-primary hover:underline">
                {t.common.viewAll}
              </Link>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {team.slice(0, 6).map((member) => (
                  <li key={member.userId} className="flex items-center gap-3">
                    <UserAvatar name={member.displayName} seed={member.userId} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{member.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">{t.roles[member.role]}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
