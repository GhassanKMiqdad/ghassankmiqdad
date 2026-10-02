"use client";

import type { TooltipContentProps } from "recharts";

import { useI18n } from "@/lib/i18n/provider";

/** Values lead (strong), series names follow; series keyed with a short line in their colour. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelKey,
}: Partial<TooltipContentProps<number, string>> & { labelKey?: string }) {
  const { number } = useI18n();
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as Record<string, unknown> | undefined;
  const heading = labelKey && datum && datum[labelKey] !== undefined ? String(datum[labelKey]) : label;

  return (
    <div className="min-w-36 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {heading !== undefined ? <p className="mb-1.5 font-medium text-muted-foreground">{String(heading)}</p> : null}
      <ul className="space-y-1">
        {payload.map((entry) => (
          <li key={String(entry.dataKey ?? entry.name)} className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden />
            <span className="font-semibold text-foreground tabular-nums">
              {typeof entry.value === "number" ? number(entry.value) : String(entry.value ?? "")}
            </span>
            <span className="text-muted-foreground">{entry.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
