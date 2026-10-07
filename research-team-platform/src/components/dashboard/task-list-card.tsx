"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { PriorityBadge, ScheduleStatusBadge, TaskCode, TaskStatusBadge } from "@/components/shared/badges";
import { DateText } from "@/components/shared/date-text";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { TaskListItem } from "@/types/app";

/** Compact task list used by the dashboards (today, this week, overdue, review queue…). */
export function TaskListCard({
  title,
  icon,
  tasks,
  showAssignee = false,
  date = "due",
  tone = "default",
  limit = 8,
  href,
  className,
}: {
  title: string;
  /** A rendered icon element (components cannot be passed from Server Components). */
  icon?: ReactNode;
  tasks: TaskListItem[];
  showAssignee?: boolean;
  date?: "due" | "start";
  tone?: "default" | "critical" | "warning";
  limit?: number;
  href?: string;
  className?: string;
}) {
  const { t, number } = useI18n();
  const visible = tasks.slice(0, limit);

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        {icon ? (
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-md",
              tone === "critical"
                ? "bg-destructive/10 text-destructive"
                : tone === "warning"
                  ? "bg-warning/20 text-warning-foreground dark:text-warning"
                  : "bg-primary/10 text-primary",
            )}
          >
            {icon}
          </span>
        ) : null}
        <CardTitle className="text-base">{title}</CardTitle>
        <Badge
          variant={tasks.length > 0 && tone === "critical" ? "destructive" : "secondary"}
          className="ms-auto tabular-nums"
        >
          {number(tasks.length)}
        </Badge>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t.planner.nothing}</p>
        ) : (
          <ul className="divide-y">
            {visible.map((task) => (
              <li key={task.id} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-2">
                  <TaskCode code={task.code} />
                  <Link
                    href={`/projects/${task.projectId}/tasks/${task.id}`}
                    dir="auto"
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {task.title}
                  </Link>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {showAssignee ? <span className="me-1">{task.responsibleName ?? t.tasks.unassigned}</span> : null}
                  <TaskStatusBadge status={task.status} />
                  <PriorityBadge priority={task.priority} />
                  <ScheduleStatusBadge status={task.scheduleStatus} />
                  <DateText
                    value={date === "start" ? task.plannedStartAt : task.dueAt}
                    style="datetime"
                    fallback={t.tasks.scheduleNotDefined}
                    className="ms-auto tabular-nums"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {href && tasks.length > limit ? (
          <Link href={href} className="mt-3 block text-sm text-primary hover:underline">
            {t.common.viewAll}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
