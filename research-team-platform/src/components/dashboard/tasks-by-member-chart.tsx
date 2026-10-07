"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartCard } from "@/components/charts/chart-card";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { useI18n } from "@/lib/i18n/provider";

type MemberRow = { userId: string; name: string; open: number; completed: number; total: number; overdue?: number };

function shorten(name: string, max = 16) {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/**
 * Two series (open, completed) stacked per assignee. Slots 1 and 2 of the
 * validated palette in fixed order, a legend, a 2px surface gap between the
 * segments and the total labelled at the bar end.
 */
export function TasksByMemberChart({ data }: { data: MemberRow[] }) {
  const { t, dir } = useI18n();
  const rtl = dir === "rtl";
  const rows = data.map((row) => ({ ...row, short: shorten(row.name) }));
  const series = [
    { key: "open", label: t.dashboard.open, color: "var(--chart-1)" },
    { key: "completed", label: t.dashboard.completed, color: "var(--chart-2)" },
  ] as const;

  return (
    <ChartCard
      title={t.dashboard.tasksByMember}
      description={t.dashboard.tasksByMemberDescription}
      empty={rows.length === 0}
      table={{
        columns: [
          t.dashboard.member,
          t.dashboard.open,
          t.planner.overdueTasks,
          t.dashboard.completed,
          t.dashboard.total,
        ],
        rows: rows.map((row) => [row.name, row.open, row.overdue ?? 0, row.completed, row.total]),
      }}
    >
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden>
        {series.map((item) => (
          <span key={item.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <div dir="ltr" style={{ height: Math.max(rows.length, 1) * 40 + 8 }}>
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
              dataKey="short"
              width={120}
              orientation={rtl ? "right" : "left"}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip labelKey="name" />} />
            <Bar
              dataKey="open"
              name={t.dashboard.open}
              stackId="tasks"
              fill="var(--chart-1)"
              stroke="var(--card)"
              strokeWidth={2}
              maxBarSize={20}
              isAnimationActive={false}
            />
            <Bar
              dataKey="completed"
              name={t.dashboard.completed}
              stackId="tasks"
              fill="var(--chart-2)"
              stroke="var(--card)"
              strokeWidth={2}
              maxBarSize={20}
              radius={rtl ? [4, 0, 0, 4] : [0, 4, 4, 0]}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="total"
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
