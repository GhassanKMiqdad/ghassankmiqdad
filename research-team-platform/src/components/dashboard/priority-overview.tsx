"use client";

import { PriorityBadge } from "@/components/shared/badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";
import { TASK_PRIORITIES, type TaskPriority } from "@/lib/permissions/catalog";

const BAR: Record<TaskPriority, string> = {
  p0: "bg-destructive",
  p1: "bg-warning",
  p2: "bg-info",
  p3: "bg-muted-foreground/50",
};

/** Open tasks per priority; each bar is labelled with its badge and count (never colour alone). */
export function PriorityOverview({ data }: { data: Record<TaskPriority, number> }) {
  const { t, number } = useI18n();
  const max = Math.max(1, ...TASK_PRIORITIES.map((priority) => data[priority] ?? 0));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.planner.byPriority}</CardTitle>
        <CardDescription>{t.planner.byPriorityDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {TASK_PRIORITIES.map((priority) => {
            const value = data[priority] ?? 0;
            return (
              <li key={priority} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3">
                <PriorityBadge priority={priority} />
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${BAR[priority]}`}
                    style={{ width: `${(value / max) * 100}%` }}
                  />
                </div>
                <span className="text-end text-sm font-semibold tabular-nums">{number(value)}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
