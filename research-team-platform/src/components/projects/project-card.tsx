import Link from "next/link";
import { CalendarDays, ListChecks, Users } from "lucide-react";

import { ProjectStatusBadge, RoleBadge } from "@/components/shared/badges";
import { DateText } from "@/components/shared/date-text";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { I18n } from "@/lib/i18n";
import type { ProjectListItem } from "@/types/app";

export function ProjectCard({ project, i18n }: { project: ProjectListItem; i18n: I18n }) {
  const { t, fmt } = i18n;
  const percent = project.taskTotal > 0 ? Math.round((project.taskCompleted / project.taskTotal) * 100) : 0;

  return (
    <Card className="group relative gap-4 p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <h2 className="truncate font-semibold">
            <Link href={`/projects/${project.id}`} className="after:absolute after:inset-0">
              {project.name}
            </Link>
          </h2>
          <div className="flex flex-wrap gap-1.5">
            <ProjectStatusBadge status={project.status} />
            <RoleBadge role={project.role} />
          </div>
        </div>
      </div>
      <p dir="auto" className="line-clamp-2 min-h-10 text-start text-sm text-muted-foreground">
        {project.description || t.common.noDescription}
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {fmt(t.dashboard.completedOf, {
              completed: i18n.number(project.taskCompleted),
              total: i18n.number(project.taskTotal),
            })}
          </span>
          <span className="tabular-nums">{percent}%</span>
        </div>
        <Progress value={percent} aria-label={project.name} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ListChecks className="size-3.5" aria-hidden />
          {fmt(t.projects.tasksCount, { count: i18n.number(project.taskTotal) })}
        </span>
        {project.memberCount !== null ? (
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5" aria-hidden />
            {fmt(t.projects.members, { count: i18n.number(project.memberCount) })}
          </span>
        ) : null}
        {project.deadline ? (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5" aria-hidden />
            <DateText value={project.deadline} />
          </span>
        ) : null}
      </div>
    </Card>
  );
}
