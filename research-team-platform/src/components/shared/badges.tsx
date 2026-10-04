"use client";

import { AlertTriangle, ArrowDown, ArrowUp, Equal, Flame } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/provider";
import type { MemberStatus, ProjectRole, ProjectStatus, TaskPriority, TaskStatus } from "@/lib/permissions/catalog";
import { cn } from "@/lib/utils";

const TASK_STATUS_VARIANT: Record<TaskStatus, "muted" | "info" | "warning" | "success" | "destructive"> = {
  todo: "muted",
  in_progress: "info",
  review: "warning",
  revision_required: "warning",
  completed: "success",
  rejected: "destructive",
};

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const { t } = useI18n();
  return (
    <Badge variant={TASK_STATUS_VARIANT[status]} className={className}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t.taskStatus[status]}
    </Badge>
  );
}

const PRIORITY_STYLE: Record<
  TaskPriority,
  { variant: "muted" | "info" | "warning" | "destructive"; icon: typeof ArrowDown }
> = {
  low: { variant: "muted", icon: ArrowDown },
  medium: { variant: "info", icon: Equal },
  high: { variant: "warning", icon: ArrowUp },
  critical: { variant: "destructive", icon: Flame },
};

export function PriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  const { t } = useI18n();
  const { variant, icon: Icon } = PRIORITY_STYLE[priority];
  return (
    <Badge variant={variant} className={className}>
      <Icon aria-hidden />
      {t.taskPriority[priority]}
    </Badge>
  );
}

const PROJECT_STATUS_VARIANT: Record<ProjectStatus, "muted" | "info" | "warning" | "success" | "outline"> = {
  planning: "muted",
  active: "info",
  on_hold: "warning",
  completed: "success",
  archived: "outline",
};

export function ProjectStatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const { t } = useI18n();
  return (
    <Badge variant={PROJECT_STATUS_VARIANT[status]} className={className}>
      {t.projectStatus[status]}
    </Badge>
  );
}

export function RoleBadge({ role, className }: { role: ProjectRole; className?: string }) {
  const { t } = useI18n();
  return (
    <Badge variant={role === "owner" ? "default" : "secondary"} className={className}>
      {t.roles[role]}
    </Badge>
  );
}

export function MemberStatusBadge({
  status,
  pending,
  className,
}: {
  status: MemberStatus;
  pending?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  if (status === "suspended") {
    return (
      <Badge variant="destructive" className={className}>
        {t.memberStatus.suspended}
      </Badge>
    );
  }
  if (pending) {
    return (
      <Badge variant="warning" className={className}>
        {t.memberStatus.pending}
      </Badge>
    );
  }
  return (
    <Badge variant="success" className={className}>
      {t.memberStatus.active}
    </Badge>
  );
}

export function OverdueBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <Badge variant="destructive" className={cn("gap-1", className)}>
      <AlertTriangle aria-hidden />
      {t.common.overdue}
    </Badge>
  );
}
