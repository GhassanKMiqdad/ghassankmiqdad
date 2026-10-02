"use client";

import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { OverdueBadge, PriorityBadge } from "@/components/shared/badges";
import { DateText } from "@/components/shared/date-text";
import { UserAvatar } from "@/components/shared/user-avatar";
import { DeleteTaskButton } from "@/components/tasks/delete-task-button";
import { TaskStatusSelect } from "@/components/tasks/task-status-select";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/provider";
import { fromAccessDTO, type ProjectAccessDTO } from "@/lib/permissions/access";
import { canDeleteTasks } from "@/lib/permissions/policy";
import type { TaskListItem } from "@/types/app";

export function TaskTable({
  tasks,
  accessByProject,
  showProject = false,
}: {
  tasks: TaskListItem[];
  accessByProject: Record<string, ProjectAccessDTO>;
  showProject?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-4">{t.tasks.fields.title}</TableHead>
            {showProject ? <TableHead>{t.tasks.fields.project}</TableHead> : null}
            <TableHead>{t.tasks.fields.status}</TableHead>
            <TableHead>{t.tasks.fields.priority}</TableHead>
            <TableHead>{t.tasks.fields.assignee}</TableHead>
            <TableHead>{t.tasks.fields.dueDate}</TableHead>
            <TableHead className="w-12 pe-4">
              <span className="sr-only">{t.common.actions}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const access = accessByProject[task.projectId];
            const canDelete = access ? canDeleteTasks(fromAccessDTO(access)) : false;
            const href = `/projects/${task.projectId}/tasks/${task.id}`;
            return (
              <TableRow key={task.id}>
                <TableCell className="max-w-80 ps-4">
                  <Link href={href} className="block truncate font-medium hover:underline">
                    {task.title}
                  </Link>
                </TableCell>
                {showProject ? (
                  <TableCell className="max-w-48">
                    <Link
                      href={`/projects/${task.projectId}`}
                      className="block truncate text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {task.projectName}
                    </Link>
                  </TableCell>
                ) : null}
                <TableCell>
                  <TaskStatusSelect task={task} access={access} />
                </TableCell>
                <TableCell>
                  <PriorityBadge priority={task.priority} />
                </TableCell>
                <TableCell>
                  {task.assignee ? (
                    <span className="flex items-center gap-2">
                      <UserAvatar name={task.assignee.name} seed={task.assignee.id} className="size-6" />
                      <span className="max-w-36 truncate">{task.assignee.name}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t.tasks.unassigned}</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <DateText value={task.dueDate} fallback="—" className="tabular-nums" />
                    {task.isOverdue ? <OverdueBadge /> : null}
                  </span>
                </TableCell>
                <TableCell className="pe-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={t.common.actions}>
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={href}>
                          <Pencil aria-hidden />
                          {t.common.open}
                        </Link>
                      </DropdownMenuItem>
                      {canDelete ? (
                        <DeleteTaskButton
                          taskId={task.id}
                          trigger={
                            <DropdownMenuItem variant="destructive" onSelect={(event) => event.preventDefault()}>
                              <Trash2 aria-hidden />
                              {t.common.delete}
                            </DropdownMenuItem>
                          }
                        />
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
