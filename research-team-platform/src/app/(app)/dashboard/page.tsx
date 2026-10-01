import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FolderKanban, ListTodo, Plus, Users } from "lucide-react";

import { ActivityList } from "@/components/activity/activity-list";
import { MyTasks } from "@/components/dashboard/my-tasks";
import { ProjectProgress } from "@/components/dashboard/project-progress";
import { StatTile } from "@/components/dashboard/stat-tile";
import { TasksByMemberChart } from "@/components/dashboard/tasks-by-member-chart";
import { TasksByStatusChart } from "@/components/dashboard/tasks-by-status-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getMyProjectsAccess } from "@/server/access";
import { requireCurrentProfile } from "@/server/auth";
import { listActivity } from "@/server/queries/activity";
import { getDashboardStats } from "@/server/queries/dashboard";
import { listMyOpenTasks } from "@/server/queries/tasks";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.dashboard.title };
}

export default async function DashboardPage() {
  const profile = await requireCurrentProfile();
  const [i18n, access] = await Promise.all([getI18n(), getMyProjectsAccess()]);
  const { t, fmt } = i18n;

  const memberships = access.filter((item) => can(item, "project.view"));
  if (memberships.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={fmt(t.dashboard.greeting, { name: profile.displayName })}
          description={t.dashboard.subtitle}
        />
        <EmptyState
          icon={FolderKanban}
          title={t.dashboard.welcomeTitle}
          description={t.dashboard.welcomeBody}
          action={
            profile.canCreateProjects ? (
              <Button asChild>
                <Link href="/projects/new">
                  <Plus aria-hidden />
                  {t.projects.new}
                </Link>
              </Button>
            ) : null
          }
        />
      </div>
    );
  }

  // The full log is shown where the user may read it; otherwise only their own actions.
  const canSeeActivity = access.some((item) => can(item, "activity.view"));
  const [stats, myTasks, activity] = await Promise.all([
    getDashboardStats(),
    listMyOpenTasks(profile.id),
    listActivity({ pageSize: 8, actorId: canSeeActivity ? undefined : profile.id }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={fmt(t.dashboard.greeting, { name: profile.displayName })}
        description={t.dashboard.subtitle}
        actions={
          profile.canCreateProjects ? (
            <Button asChild>
              <Link href="/projects/new">
                <Plus aria-hidden />
                {t.projects.new}
              </Link>
            </Button>
          ) : null
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5" aria-label={t.dashboard.title}>
        <StatTile
          label={t.dashboard.stats.totalProjects}
          value={i18n.number(stats.totalProjects)}
          hint={fmt(t.dashboard.stats.activeProjects, { count: i18n.number(stats.activeProjects) })}
          icon={FolderKanban}
        />
        <StatTile
          label={t.dashboard.stats.activeTasks}
          value={i18n.number(stats.activeTasks)}
          hint={fmt(t.dashboard.stats.ofTotal, { total: i18n.number(stats.totalTasks) })}
          icon={ListTodo}
        />
        <StatTile
          label={t.dashboard.stats.completedTasks}
          value={i18n.number(stats.completedTasks)}
          hint={fmt(t.dashboard.stats.ofTotal, { total: i18n.number(stats.totalTasks) })}
          icon={CheckCircle2}
        />
        <StatTile
          label={t.dashboard.stats.overdueTasks}
          value={i18n.number(stats.overdueTasks)}
          hint={stats.overdueTasks > 0 ? t.dashboard.stats.needsAttention : undefined}
          icon={AlertTriangle}
          tone={stats.overdueTasks > 0 ? "critical" : "default"}
        />
        {stats.canViewTeam ? (
          <StatTile
            label={t.dashboard.stats.teamMembers}
            value={i18n.number(stats.teamMembers)}
            hint={t.dashboard.stats.acrossProjects}
            icon={Users}
          />
        ) : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <TasksByStatusChart data={stats.tasksByStatus} />
        <TasksByMemberChart data={stats.tasksByMember} />
      </section>

      <section className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <MyTasks tasks={myTasks} i18n={i18n} />
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
        <div className="lg:col-span-2">
          <ProjectProgress projects={stats.projectProgress} i18n={i18n} />
        </div>
      </section>
    </div>
  );
}
