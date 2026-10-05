import Link from "next/link";
import { Download, FileBarChart, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getAuthorizedReportData } from "@/server/queries/reports";

export default async function ReportsPage() {
  const { stats, projects, rows, truncated } = await getAuthorizedReportData();
  const visibleStatus = new Map<string, number>();
  for (const { task } of rows) visibleStatus.set(task.status, (visibleStatus.get(task.status) ?? 0) + 1);
  const teamVisibleProjectIds = new Set(projects.filter((project) => project.canViewTeam).map((project) => project.id));
  const workload = new Map<string, { name: string; active: number; completed: number; overdue: number }>();
  for (const { projectId, task } of rows) {
    if (!teamVisibleProjectIds.has(projectId)) continue;
    if (!task.assignedToId) continue;
    const current = workload.get(task.assignedToId) ?? {
      name: task.assignee?.name ?? "Researcher",
      active: 0,
      completed: 0,
      overdue: 0,
    };
    if (task.status === "completed") current.completed += 1;
    else current.active += 1;
    if (task.isOverdue) current.overdue += 1;
    workload.set(task.assignedToId, current);
  }
  const progress = new Map(stats.projectProgress.map((item) => [item.projectId, item]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Research reports"
        description="Live summaries from projects and tasks you are authorized to see. Researcher reports contain assigned work only."
        actions={
          <Button asChild variant="outline">
            <a href="/api/reports">
              <Download aria-hidden /> Export authorized CSV
            </a>
          </Button>
        }
      />
      {truncated ? (
        <div role="status" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          Some report detail exceeds the current per-project query safety bound and is not included. Use filtered
          project views or lower the data range.
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Projects", stats.totalProjects],
          ["Active projects", stats.activeProjects],
          ["Tasks in authorized scope", stats.totalTasks],
          ["Overdue tasks", stats.overdueTasks],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileBarChart className="size-4" aria-hidden />
              Project progress
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {projects.length ? (
              projects.map((project) => {
                const item = progress.get(project.id);
                const total = item?.total ?? 0;
                const completed = item?.completed ?? 0;
                const pct = total ? Math.round((completed / total) * 100) : 0;
                return (
                  <div key={project.id} className="space-y-2">
                    <div className="flex justify-between gap-3 text-sm">
                      <Link className="truncate font-medium hover:underline" href={`/projects/${project.id}`}>
                        {project.name}
                      </Link>
                      <span className="shrink-0 text-muted-foreground">
                        {completed}/{total} · {pct}%
                      </span>
                    </div>
                    <Progress value={pct} aria-label={`${project.name} progress`} />
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">No authorized projects.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Visible task status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(Object.fromEntries(visibleStatus)).length ? (
              Object.entries(Object.fromEntries(visibleStatus)).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between border-b pb-2 text-sm">
                  <span className="capitalize">{status.replaceAll("_", " ")}</span>
                  <span className="font-semibold tabular-nums">{count}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No authorized tasks in this report scope.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Workload in your authorized scope</CardTitle>
        </CardHeader>
        <CardContent>
          {workload.size ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-start text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Researcher</th>
                    <th className="px-3 py-2 font-medium">Active</th>
                    <th className="px-3 py-2 font-medium">Completed</th>
                    <th className="px-3 py-2 font-medium">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {[...workload.entries()].map(([id, item]) => (
                    <tr key={id} className="border-b">
                      <td className="px-3 py-2">{item.name}</td>
                      <td className="px-3 py-2 tabular-nums">{item.active}</td>
                      <td className="px-3 py-2 tabular-nums">{item.completed}</td>
                      <td className="px-3 py-2 tabular-nums">{item.overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No assigned workload in your authorized scope.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
