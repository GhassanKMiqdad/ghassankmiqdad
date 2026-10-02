import Link from "next/link";

import { ProjectStatusBadge } from "@/components/shared/badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { I18n } from "@/lib/i18n";
import type { DashboardStats } from "@/types/app";

/** One meter per project: completed share of its tasks (same-hue track and fill). */
export function ProjectProgress({ projects, i18n }: { projects: DashboardStats["projectProgress"]; i18n: I18n }) {
  const { t, fmt } = i18n;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.dashboard.taskProgress}</CardTitle>
        <CardDescription>{t.dashboard.taskProgressDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        {projects.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t.dashboard.chartEmpty}</p>
        ) : (
          <ul className="space-y-5">
            {projects.map((project) => {
              const percent = project.total > 0 ? Math.round((project.completed / project.total) * 100) : 0;
              return (
                <li key={project.projectId} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href={`/projects/${project.projectId}`}
                      className="min-w-0 truncate text-sm font-medium hover:underline"
                    >
                      {project.name}
                    </Link>
                    <ProjectStatusBadge status={project.status} />
                  </div>
                  <Progress value={percent} aria-label={project.name} />
                  <p className="text-xs text-muted-foreground">
                    {fmt(t.dashboard.completedOf, {
                      completed: i18n.number(project.completed),
                      total: i18n.number(project.total),
                    })}{" "}
                    · {percent}%
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
