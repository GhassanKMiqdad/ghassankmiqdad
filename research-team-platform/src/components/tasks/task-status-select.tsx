"use client";

import { useMemo } from "react";

import { TaskStatusBadge } from "@/components/shared/badges";
import { useServerAction } from "@/components/shared/use-action";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/provider";
import { fromAccessDTO, type ProjectAccessDTO } from "@/lib/permissions/access";
import type { TaskStatus } from "@/lib/permissions/catalog";
import { allowedTaskStatuses } from "@/lib/permissions/policy";
import { updateTaskAction } from "@/server/actions/tasks";
import type { TaskListItem } from "@/types/app";

/** Inline status change offering only the transitions the user may perform. */
export function TaskStatusSelect({ task, access }: { task: TaskListItem; access: ProjectAccessDTO | undefined }) {
  const { t, fmt } = useI18n();
  const { pending, run } = useServerAction();
  const options = useMemo(
    () =>
      access
        ? allowedTaskStatuses(fromAccessDTO(access), {
            createdBy: task.createdById,
            assignedTo: task.assignedToId,
            status: task.status,
          })
        : [],
    [access, task.createdById, task.assignedToId, task.status],
  );

  if (options.length <= 1) return <TaskStatusBadge status={task.status} />;

  return (
    <Select
      value={task.status}
      disabled={pending}
      onValueChange={(value) =>
        void run(() => updateTaskAction(task.id, { status: value as TaskStatus }), {
          success: fmt(t.tasks.statusChanged, { status: t.taskStatus[value as TaskStatus] }),
        })
      }
    >
      <SelectTrigger
        size="sm"
        className="h-7 border-none bg-transparent px-1 shadow-none"
        aria-label={t.tasks.quickStatus}
      >
        <TaskStatusBadge status={task.status} />
      </SelectTrigger>
      <SelectContent>
        {options.map((status) => (
          <SelectItem key={status} value={status}>
            {t.taskStatus[status]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
