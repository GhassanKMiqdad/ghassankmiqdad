import Link from "next/link";

import { OverdueBadge, PriorityBadge, TaskStatusBadge } from "@/components/shared/badges";
import { DateText } from "@/components/shared/date-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { I18n } from "@/lib/i18n";
import type { TaskListItem } from "@/types/app";

export function MyTasks({ tasks, i18n }: { tasks: TaskListItem[]; i18n: I18n }) {
  const { t } = i18n;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.dashboard.myTasks}</CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t.dashboard.noTasks}</p>
        ) : (
          <ul className="divide-y">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/projects/${task.projectId}/tasks/${task.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {task.title}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">{task.projectName}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <TaskStatusBadge status={task.status} />
                  <PriorityBadge priority={task.priority} />
                  {task.isOverdue ? <OverdueBadge /> : null}
                  <DateText
                    value={task.dueDate}
                    fallback={t.tasks.noDueDate}
                    className="text-xs text-muted-foreground tabular-nums"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
