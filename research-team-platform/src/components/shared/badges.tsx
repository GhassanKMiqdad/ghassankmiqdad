"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CalendarX2,
  Clock3,
  Equal,
  Flame,
  Globe2,
  Lock,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/provider";
import type {
  MemberStatus,
  ProjectRole,
  ProjectStatus,
  ScheduleStatus,
  TaskPriority,
  TaskStatus,
  TaskVisibility,
} from "@/lib/permissions/catalog";
import { cn } from "@/lib/utils";

const TASK_STATUS_VARIANT: Record<TaskStatus, "muted" | "info" | "warning" | "success" | "destructive" | "outline"> = {
  not_started: "muted",
  scheduled: "outline",
  in_progress: "info",
  blocked: "destructive",
  submitted: "warning",
  under_review: "warning",
  revision_required: "destructive",
  approved: "success",
  completed: "success",
  cancelled: "muted",
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
  p0: { variant: "destructive", icon: Flame },
  p1: { variant: "warning", icon: ArrowUp },
  p2: { variant: "info", icon: Equal },
  p3: { variant: "muted", icon: ArrowDown },
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

const SCHEDULE_STYLE: Partial<
  Record<ScheduleStatus, { variant: "muted" | "info" | "warning" | "destructive" | "outline"; icon: typeof Clock3 }>
> = {
  unscheduled: { variant: "outline", icon: CalendarX2 },
  scheduled: { variant: "outline", icon: CalendarClock },
  not_started: { variant: "muted", icon: Clock3 },
  due_soon: { variant: "warning", icon: Clock3 },
  overdue: { variant: "destructive", icon: AlertTriangle },
};

/** Schedule signal computed by the database (shown only when it adds information). */
export function ScheduleStatusBadge({ status, className }: { status: ScheduleStatus; className?: string }) {
  const { t } = useI18n();
  const style = SCHEDULE_STYLE[status];
  if (!style) return null;
  const Icon = style.icon;
  return (
    <Badge variant={style.variant} className={cn("gap-1", className)}>
      <Icon aria-hidden />
      {t.scheduleStatus[status]}
    </Badge>
  );
}

export function VisibilityBadge({ visibility, className }: { visibility: TaskVisibility; className?: string }) {
  const { t } = useI18n();
  const Icon = visibility === "team" ? Globe2 : Lock;
  return (
    <Badge
      variant={visibility === "team" ? "success" : "secondary"}
      className={cn("gap-1", className)}
      title={t.tasks.visibilityHint[visibility]}
    >
      <Icon aria-hidden />
      {t.tasks.visibility[visibility]}
    </Badge>
  );
}

/** Task ID chip (always left-to-right, monospaced). */
export function TaskCode({ code, className }: { code: string; className?: string }) {
  return (
    <span
      dir="ltr"
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-tight text-foreground/80",
        className,
      )}
    >
      {code}
    </span>
  );
}

export type OrgRole = "director" | "team_lead" | "team_member";

export function OrgRoleBadge({ role, className }: { role: OrgRole; className?: string }) {
  const { t } = useI18n();
  return (
    <Badge
      variant={role === "director" ? "default" : role === "team_lead" ? "info" : "secondary"}
      className={className}
    >
      {t.orgRoles[role]}
    </Badge>
  );
}
