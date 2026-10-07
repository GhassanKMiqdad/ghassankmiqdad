import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Download,
  FolderKanban,
  ListTodo,
  RefreshCw,
} from "lucide-react";
import { notFound } from "next/navigation";

import { ProjectProgress } from "@/components/dashboard/project-progress";
import { StatTile } from "@/components/dashboard/stat-tile";
import { TasksByMemberChart } from "@/components/dashboard/tasks-by-member-chart";
import { TasksByStatusChart } from "@/components/dashboard/tasks-by-status-chart";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getMyProjectsAccess } from "@/server/access";
import { requireCurrentProfile } from "@/server/auth";
import { getDashboardStats } from "@/server/queries/dashboard";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.reports.title };
}

export default async function ReportsPage() {
  const profile = await requireCurrentProfile();
  const [i18n, access] = await Promise.all([getI18n(), getMyProjectsAccess()]);
  const canViewReports =
    profile.isPlatformAdmin || access.some((item) => can(item, "team.view") || can(item, "data.export"));
  if (!canViewReports) notFound();

  const stats = await getDashboardStats();
  const exportProjects = access.filter((item) => can(item, "project.view") && can(item, "data.export"));
  const { t, fmt } = i18n;

  return (
    <div className="space-y-6">
      <PageHeader title={t.reports.title} description={t.reports.subtitle} />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5" aria-label={t.reports.title}>
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
        <StatTile label={t.reports.awaitingReview} value={i18n.number(stats.tasksByStatus.review)} icon={Clock3} />
        <StatTile
          label={t.reports.revisions}
          value={i18n.number(stats.tasksByStatus.revision_required)}
          icon={RefreshCw}
        />
        <StatTile
          label={t.dashboard.stats.overdueTasks}
          value={i18n.number(stats.overdueTasks)}
          hint={stats.overdueTasks > 0 ? t.dashboard.stats.needsAttention : undefined}
          icon={AlertTriangle}
          tone={stats.overdueTasks > 0 ? "critical" : "default"}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2" aria-label={t.reports.title}>
        <TasksByStatusChart data={stats.tasksByStatus} />
        {stats.canViewTeam ? (
          <TasksByMemberChart data={stats.tasksByMember} />
        ) : (
          <ProjectProgress projects={stats.projectProgress} i18n={i18n} />
        )}
      </section>
      {stats.canViewTeam ? <ProjectProgress projects={stats.projectProgress} i18n={i18n} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="size-5" aria-hidden />
            {t.reports.exportTitle}
          </CardTitle>
          <CardDescription>{t.reports.exportDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {exportProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.reports.noExports}</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {exportProjects.map((project) => (
                <li key={project.projectId} className="flex flex-col justify-between gap-3 rounded-lg border p-4">
                  <div className="min-w-0">
                    <Link href={`/projects/${project.projectId}`} className="truncate font-medium hover:underline">
                      {project.projectName}
                    </Link>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/api/projects/${project.projectId}/export?format=csv`} prefetch={false}>
                        <Download aria-hidden />
                        {t.reports.exportCsv}
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/api/projects/${project.projectId}/export?format=json`} prefetch={false}>
                        <CheckCircle2 aria-hidden />
                        {t.reports.exportJson}
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
