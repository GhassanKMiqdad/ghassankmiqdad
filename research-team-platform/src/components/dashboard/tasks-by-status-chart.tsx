"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartCard } from "@/components/charts/chart-card";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { useI18n } from "@/lib/i18n/provider";
import { TASK_STATUSES, type TaskStatus } from "@/lib/permissions/catalog";

/**
 * One series (task count) across the workflow stages, in workflow order:
 * a single categorical slot, no legend (the title names the series), value
 * labels at the bar tips.
 */
export function TasksByStatusChart({ data }: { data: Record<TaskStatus, number> }) {
  const { t, dir } = useI18n();
  const rtl = dir === "rtl";
  const rows = TASK_STATUSES.map((status) => ({ label: t.taskStatus[status], value: data[status] ?? 0 }));
  const empty = rows.every((row) => row.value === 0);

  return (
    <ChartCard
      title={t.dashboard.tasksByStatus}
      description={t.dashboard.tasksByStatusDescription}
      empty={empty}
      table={{
        columns: [t.tasks.fields.status, t.dashboard.tasksLabel],
        rows: rows.map((row) => [row.label, row.value]),
      }}
    >
      <div dir="ltr" style={{ height: rows.length * 40 + 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, bottom: 4, left: rtl ? 36 : 4, right: rtl ? 4 : 36 }}
            barCategoryGap={10}
          >
            <CartesianGrid horizontal={false} stroke="var(--border)" />
            <XAxis type="number" hide allowDecimals={false} reversed={rtl} />
            <YAxis
              type="category"
              dataKey="label"
              width={104}
              orientation={rtl ? "right" : "left"}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip />} />
            <Bar
              dataKey="value"
              name={t.dashboard.tasksLabel}
              fill="var(--chart-1)"
              maxBarSize={20}
              radius={rtl ? [4, 0, 0, 4] : [0, 4, 4, 0]}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="value"
                position="right"
                offset={8}
                style={{ fill: "var(--foreground)", fontSize: 12, fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
