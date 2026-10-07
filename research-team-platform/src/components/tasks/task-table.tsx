"use client";

import Link from "next/link";
import { Lock } from "lucide-react";

import { PriorityBadge, ScheduleStatusBadge, TaskCode, TaskStatusBadge } from "@/components/shared/badges";
import { DateText } from "@/components/shared/date-text";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/provider";
import type { TaskListItem } from "@/types/app";

/** Task list: ID, task, responsible, plan, priority, status/schedule, start and deadline. */
export function TaskTable({ tasks, showProject = false }: { tasks: TaskListItem[]; showProject?: boolean }) {
  const { t, fmt } = useI18n();

  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-4">{t.tasks.fields.taskCode}</TableHead>
            <TableHead>{t.tasks.fields.title}</TableHead>
            {showProject ? <TableHead>{t.tasks.fields.project}</TableHead> : null}
            <TableHead>{t.tasks.fields.assignee}</TableHead>
            <TableHead>{t.tasks.fields.planningWeek}</TableHead>
            <TableHead>{t.tasks.fields.priority}</TableHead>
            <TableHead>{t.tasks.fields.status}</TableHead>
            <TableHead>{t.tasks.fields.plannedStart}</TableHead>
            <TableHead className="pe-4">{t.tasks.fields.dueAt}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const href = `/projects/${task.projectId}/tasks/${task.id}`;
            return (
              <TableRow key={task.id}>
                <TableCell className="ps-4">
                  <Link href={href} className="hover:opacity-80">
                    <TaskCode code={task.code} />
                  </Link>
                </TableCell>
                <TableCell className="max-w-72">
                  <Link href={href} className="flex items-center gap-1.5 font-medium hover:underline">
                    {task.visibility === "private" ? (
                      <Lock className="size-3 shrink-0 text-muted-foreground" aria-label={t.tasks.visibility.private} />
                    ) : null}
                    <span className="truncate" dir="auto">
                      {task.title}
                    </span>
                  </Link>
                </TableCell>
                {showProject ? (
                  <TableCell className="max-w-40">
                    <Link
                      href={`/projects/${task.projectId}`}
                      className="block truncate text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {task.projectName}
                    </Link>
                  </TableCell>
                ) : null}
                <TableCell>
                  {task.responsibleName ? (
                    <span className="flex items-center gap-2">
                      <UserAvatar
                        name={task.responsibleName}
                        seed={task.assignee?.id ?? task.responsibleMemberId ?? task.id}
                        className="size-6"
                      />
                      <span className="min-w-0">
                        <span className="block max-w-36 truncate">
                          {task.responsibleName}
                          {task.responsiblePending ? (
                            <span className="ms-1 text-xs text-muted-foreground">({t.tasks.pendingAccount})</span>
                          ) : null}
                        </span>
                        {task.assigneeTitle ? (
                          <span className="block max-w-36 truncate text-xs text-muted-foreground">
                            {task.assigneeTitle}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t.tasks.unassigned}</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                  {task.planningWeek
                    ? fmt(t.tasks.planLabel, {
                        month: String(task.planningMonth).padStart(2, "0"),
                        week: task.planningWeek,
                      })
                    : fmt(t.tasks.planMonthOnly, { month: String(task.planningMonth).padStart(2, "0") })}
                </TableCell>
                <TableCell>
                  <PriorityBadge priority={task.priority} />
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <TaskStatusBadge status={task.status} />
                    <ScheduleStatusBadge status={task.scheduleStatus} />
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <DateText value={task.plannedStartAt} style="datetime" fallback="—" className="tabular-nums" />
                </TableCell>
                <TableCell className="pe-4 whitespace-nowrap">
                  <DateText value={task.dueAt} style="datetime" fallback="—" className="tabular-nums" />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
