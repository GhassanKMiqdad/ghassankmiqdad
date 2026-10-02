"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/provider";

export type ChartTable = {
  columns: string[];
  rows: (string | number)[][];
};

/**
 * Card wrapper for every chart: title, optional description and a
 * chart/table toggle so values are never reachable through hover alone.
 */
export function ChartCard({
  title,
  description,
  table,
  empty,
  children,
}: {
  title: string;
  description?: string;
  table: ChartTable;
  empty?: boolean;
  children: ReactNode;
}) {
  const { t, number } = useI18n();
  const [view, setView] = useState<"chart" | "table">("chart");

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {!empty ? (
          <CardAction>
            <div className="inline-flex rounded-md border p-0.5" role="group">
              <Button
                type="button"
                size="icon-sm"
                variant={view === "chart" ? "secondary" : "ghost"}
                aria-pressed={view === "chart"}
                aria-label={t.dashboard.chartView}
                onClick={() => setView("chart")}
              >
                <BarChart3 aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant={view === "table" ? "secondary" : "ghost"}
                aria-pressed={view === "table"}
                aria-label={t.dashboard.tableView}
                onClick={() => setView("table")}
              >
                <Table2 aria-hidden />
              </Button>
            </div>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t.dashboard.chartEmpty}</p>
        ) : view === "chart" ? (
          children
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {table.columns.map((column, index) => (
                  <TableHead key={column} className={index > 0 ? "text-end" : undefined}>
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <TableCell key={cellIndex} className={cellIndex > 0 ? "text-end tabular-nums" : undefined}>
                      {typeof cell === "number" ? number(cell) : cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
