"use client";

import { CalendarClock, CheckCircle2, CircleDot, Flag, Megaphone, Play, RotateCcw, Send } from "lucide-react";

import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { SubmissionItem, TaskDetails } from "@/types/app";

type TimelineEvent = {
  key: string;
  at: string;
  label: string;
  icon: typeof Flag;
  tone: "default" | "planned" | "success" | "warning" | "destructive";
  note?: string;
};

/**
 * Planned vs actual milestones of a task, built from data the viewer may
 * already see (the task row and its submissions/reviews).
 */
export function TaskTimeline({ task, submissions }: { task: TaskDetails; submissions: SubmissionItem[] }) {
  const { t, fmt, date } = useI18n();
  const events: TimelineEvent[] = [
    { key: "created", at: task.createdAt, label: t.timeline.created, icon: CircleDot, tone: "default" },
  ];

  if (task.plannedStartAt) {
    events.push({
      key: "planned",
      at: task.plannedStartAt,
      label: t.timeline.plannedStart,
      icon: CalendarClock,
      tone: "planned",
    });
  }
  if (task.actualStartAt) {
    events.push({ key: "started", at: task.actualStartAt, label: t.timeline.actualStart, icon: Play, tone: "default" });
  }
  for (const submission of [...submissions].reverse()) {
    events.push({
      key: `s-${submission.id}`,
      at: submission.submittedAt,
      label: fmt(t.timeline.submitted, { version: submission.version }),
      icon: Send,
      tone: "default",
      note: task.dueAt
        ? new Date(submission.submittedAt) <= new Date(task.dueAt)
          ? t.timeline.onTime
          : t.timeline.late
        : undefined,
    });
    for (const review of submission.reviews) {
      events.push({
        key: `r-${review.id}`,
        at: review.createdAt,
        label: review.decision === "approved" ? t.timeline.approved : t.timeline.revision,
        icon: review.decision === "approved" ? CheckCircle2 : RotateCcw,
        tone: review.decision === "approved" ? "success" : "warning",
      });
    }
  }
  if (task.completedAt) {
    events.push({
      key: "completed",
      at: task.completedAt,
      label: t.timeline.completed,
      icon: Megaphone,
      tone: "success",
    });
  }
  if (task.dueAt) {
    events.push({
      key: "due",
      at: task.dueAt,
      label: t.timeline.dueAt,
      icon: Flag,
      tone: task.scheduleStatus === "overdue" ? "destructive" : "planned",
    });
  }
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const toneClass: Record<TimelineEvent["tone"], string> = {
    default: "bg-primary/10 text-primary",
    planned: "border border-dashed border-muted-foreground/50 bg-background text-muted-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground dark:text-warning",
    destructive: "bg-destructive/15 text-destructive",
  };

  return (
    <ol className="relative space-y-4 border-s ps-6">
      {events.map((event) => {
        const Icon = event.icon;
        return (
          <li key={event.key} className="relative">
            <span
              className={cn(
                "absolute -start-[2.15rem] flex size-7 items-center justify-center rounded-full ring-4 ring-card",
                toneClass[event.tone],
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <p className="text-sm font-medium">
              {event.label}
              {event.note ? (
                <span className="ms-2 text-xs font-normal text-muted-foreground">· {event.note}</span>
              ) : null}
            </p>
            <time dateTime={event.at} className="text-xs text-muted-foreground tabular-nums">
              {date(event.at, "datetime")}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
