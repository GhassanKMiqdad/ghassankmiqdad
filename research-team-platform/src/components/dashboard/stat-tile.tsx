import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * KPI tile: label, value (proportional figures), optional hint. A "critical"
 * tone pairs the status colour with an icon and label, never colour alone.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: "default" | "critical";
}) {
  return (
    <Card className="gap-3 px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            tone === "critical" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="text-3xl font-semibold tracking-tight">{value}</p>
      {hint ? (
        <p className={cn("text-xs", tone === "critical" ? "font-medium text-destructive" : "text-muted-foreground")}>
          {hint}
        </p>
      ) : null}
    </Card>
  );
}
