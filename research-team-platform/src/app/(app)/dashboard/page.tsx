import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FolderKanban,
  ListTodo,
  Megaphone,
  Plus,
  ShieldCheck,
  Sun,
  Target,
} from "lucide-react";

import { ActivityList } from "@/components/activity/activity-list";
import { PriorityOverview } from "@/components/dashboard/priority-overview";
import { ProjectProgress } from "@/components/dashboard/project-progress";
import { StatTile } from "@/components/dashboard/stat-tile";
import { TaskListCard } from "@/components/dashboard/task-list-card";
import { TasksByMemberChart } from "@/components/dashboard/tasks-by-member-chart";
import { TasksByStatusChart } from "@/components/dashboard/tasks-by-status-chart";
import { TeamResultsCard } from "@/components/dashboard/team-results-card";
import { OrgRoleBadge, type OrgRole } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getMyProjectsAccess } from "@/server/access";
import { requireCurrentProfile } from "@/server/auth";
import { listActivity } from "@/server/queries/activity";
import { getDashboardStats } from "@/server/queries/dashboard";
import { bucketTasks, personalProgress } from "@/server/queries/planner";
import { listAssignedTasks, listOpenTasks } from "@/server/queries/tasks";
import { listMyTeamMemberships, listPublications } from "@/server/queries/teams";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.dashboard.title };
}

export default async function DashboardPage() {
  const profile = await requireCurrentProfile();
  const [i18n, access, teamMemberships] = await Promise.all([
    getI18n(),
    getMyProjectsAccess(),
    listMyTeamMemberships(profile.id),
  ]);
  const { t, fmt } = i18n;

  const memberships = access.filter((item) => can(item, "project.view"));
  const orgRole: OrgRole = profile.isDirector
    ? "director"
    : teamMemberships.some((team) => team.role === "team_lead") || access.some((item) => can(item, "tasks.edit"))
      ? "team_lead"
      : "team_member";
  const supervisor = orgRole !== "team_member";

  const header = (
    <PageHeader
      title={fmt(t.dashboard.greeting, { name: profile.displayName })}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <OrgRoleBadge role={orgRole} />
          <span>{t.orgRoles.descriptions[orgRole]}</span>
        </span>
      }
      actions={
        profile.canCreateProjects ? (
          <Button asChild variant="outline">
            <Link href="/projects/new">
              <Plus aria-hidden />
              {t.projects.new}
            </Link>
          </Button>
        ) : null
      }
    />
  );

  if (memberships.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState icon={FolderKanban} title={t.dashboard.welcomeTitle} description={t.dashboard.welcomeBody} />
      </div>
    );
  }

  const canSeeActivity = access.some((item) => can(item, "activity.view"));
  const [stats, openTasks, myTasks, publications, activity] = await Promise.all([
    getDashboardStats(),
    listOpenTasks(),
    listAssignedTasks(profile.id),
    listPublications({ limit: 5 }),
    listActivity({ pageSize: 8, actorId: canSeeActivity ? undefined : profile.id }),
  ]);

  const myOpen = myTasks.filter((task) => task.status !== "completed");
  const mine = bucketTasks(myOpen);
  const progress = personalProgress(myTasks);

  const memberSection = (
    <section className="space-y-4" aria-label={t.planner.member}>
      <h2 className="text-lg font-semibold">{t.planner.member}</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <TaskListCard
          title={t.planner.myTasks}
          icon={<ListTodo className="size-4" aria-hidden />}
          tasks={myOpen}
          href="/tasks?assignee=me"
          limit={6}
        />
        <TaskListCard
          title={t.planner.mySchedule}
          icon={<CalendarDays className="size-4" aria-hidden />}
          tasks={mine.thisWeek}
          date="start"
          href="/schedule?assignee=me"
          limit={6}
        />
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 space-y-0">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Target className="size-4" aria-hidden />
              </span>
              <CardTitle className="text-base">{t.planner.myProgress}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress
                value={progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}
                aria-label={t.planner.myProgress}
              />
              <p className="text-sm">
                {fmt(t.planner.myProgressValue, {
                  completed: i18n.number(progress.completed),
                  total: i18n.number(progress.total),
                })}
              </p>
              {progress.onTimeRate !== null ? (
                <p className="text-xs text-muted-foreground">
                  {fmt(t.planner.onTimeRate, { rate: i18n.number(progress.onTimeRate) })}
                </p>
              ) : null}
              {mine.overdue.length > 0 ? (
                <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                  <AlertTriangle className="size-3.5" aria-hidden />
                  {t.planner.overdue}: {i18n.number(mine.overdue.length)}
                </p>
              ) : null}
            </CardContent>
          </Card>
          <TeamResultsCard items={publications} />
        </div>
      </div>
    </section>
  );

  if (!supervisor) {
    return (
      <div className="space-y-6">
        {header}
        {memberSection}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.dashboard.myActivity}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityList items={activity.items} showProject compact />
          </CardContent>
        </Card>
      </div>
    );
  }

  const all = bucketTasks(openTasks);

  return (
    <div className="space-y-6">
      {header}

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5" aria-label={t.dashboard.title}>
        <StatTile
          label={t.dashboard.stats.activeTasks}
          value={i18n.number(stats.activeTasks)}
          hint={fmt(t.dashboard.stats.ofTotal, { total: i18n.number(stats.totalTasks) })}
          icon={ListTodo}
        />
        <StatTile
          label={t.planner.overdue}
          value={i18n.number(stats.overdueTasks)}
          hint={stats.overdueTasks > 0 ? t.dashboard.stats.needsAttention : undefined}
          icon={AlertTriangle}
          tone={stats.overdueTasks > 0 ? "critical" : "default"}
        />
        <StatTile label={t.planner.dueSoon} value={i18n.number(stats.dueSoonTasks)} icon={Clock3} />
        <StatTile label={t.planner.awaitingReview} value={i18n.number(stats.awaitingReview)} icon={ShieldCheck} />
        <StatTile
          label={t.dashboard.stats.completedTasks}
          value={i18n.number(stats.completedTasks)}
          hint={fmt(t.dashboard.stats.ofTotal, { total: i18n.number(stats.totalTasks) })}
          icon={CheckCircle2}
        />
      </section>

      <section className="space-y-4" aria-label={orgRole === "director" ? t.planner.director : t.planner.lead}>
        <h2 className="text-lg font-semibold">{orgRole === "director" ? t.planner.director : t.planner.lead}</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <TaskListCard
            title={`${t.planner.today} · ${t.planner.dueToday}`}
            icon={<Sun className="size-4" aria-hidden />}
            tasks={[...all.startingToday.filter((task) => !all.dueToday.includes(task)), ...all.dueToday]}
            showAssignee
          />
          <TaskListCard
            title={t.planner.dueThisWeek}
            icon={<CalendarClock className="size-4" aria-hidden />}
            tasks={all.dueThisWeek}
            showAssignee
            href="/schedule?view=week"
          />
          <TaskListCard
            title={t.planner.overdue}
            icon={<AlertTriangle className="size-4" aria-hidden />}
            tasks={all.overdue}
            showAssignee
            tone="critical"
            href="/tasks?schedule=overdue"
          />
          <TaskListCard
            title={t.planner.dueSoon}
            icon={<Clock3 className="size-4" aria-hidden />}
            tasks={all.dueSoon}
            showAssignee
            tone="warning"
            href="/tasks?schedule=due_soon"
          />
          <TaskListCard
            title={t.planner.awaitingReview}
            icon={<ShieldCheck className="size-4" aria-hidden />}
            tasks={all.awaitingReview}
            showAssignee
          />
          <TaskListCard
            title={t.planner.readyToPublish}
            icon={<Megaphone className="size-4" aria-hidden />}
            tasks={all.readyToPublish}
            showAssignee
          />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <PriorityOverview data={stats.tasksByPriority} />
        <TasksByMemberChart data={stats.tasksByMember} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <TasksByStatusChart data={stats.tasksByStatus} />
        <ProjectProgress projects={stats.projectProgress} i18n={i18n} />
      </section>

      {myTasks.length > 0 ? memberSection : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{canSeeActivity ? t.dashboard.recentActivity : t.dashboard.myActivity}</CardTitle>
          {canSeeActivity ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/activity">{t.common.viewAll}</Link>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <ActivityList items={activity.items} showProject compact />
        </CardContent>
      </Card>
    </div>
  );
}
