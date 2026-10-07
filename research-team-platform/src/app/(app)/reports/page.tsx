import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { z } from "zod";

import { ReportFilters } from "@/components/reports/report-filters";
import { AccessDenied } from "@/components/shared/access-denied";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getMyProjectsAccess } from "@/server/access";
import { getExecutionReport } from "@/server/queries/reports";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.reports.title };
}

export default async function ReportsPage(props: PageProps<"/reports">) {
  const params = await props.searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const projectId = z.uuid().optional().catch(undefined).parse(first(params.project));
  const month = z.coerce.number().int().min(1).max(99).optional().catch(undefined).parse(first(params.month));

  const [i18n, access] = await Promise.all([getI18n(), getMyProjectsAccess()]);
  const { t, fmt } = i18n;
  const projects = access.filter((item) => can(item, "tasks.view"));
  if (projects.length === 0) return <AccessDenied message={t.errors.PERMISSION_DENIED} />;

  const rows = await getExecutionReport({ projectId, month });
  const hours = (value: number | null) => (value === null ? "—" : fmt(t.reports.hours, { value: i18n.number(value) }));

  return (
    <div className="space-y-6">
      <PageHeader title={t.reports.title} description={t.reports.subtitle} />
      <ReportFilters projects={projects.map((item) => ({ id: item.projectId, name: item.projectName }))} />
      {rows.length === 0 ? (
        <EmptyState icon={BarChart3} title={t.reports.empty} />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-4">{t.reports.columns.member}</TableHead>
                <TableHead className="text-end">{t.reports.columns.total}</TableHead>
                <TableHead className="text-end">{t.reports.columns.completed}</TableHead>
                <TableHead className="text-end">{t.reports.columns.onTime}</TableHead>
                <TableHead className="text-end">{t.reports.columns.overdue}</TableHead>
                <TableHead className="text-end">{t.reports.columns.inReview}</TableHead>
                <TableHead className="text-end">{t.reports.columns.revisions}</TableHead>
                <TableHead className="text-end">{t.reports.columns.submissions}</TableHead>
                <TableHead className="text-end">{t.reports.columns.startDelay}</TableHead>
                <TableHead className="pe-4 text-end">{t.reports.columns.completionDelay}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.userId}>
                  <TableCell className="ps-4 font-medium">{row.name}</TableCell>
                  <TableCell className="text-end tabular-nums">{i18n.number(row.total)}</TableCell>
                  <TableCell className="text-end tabular-nums">{i18n.number(row.completed)}</TableCell>
                  <TableCell className="text-end tabular-nums">{i18n.number(row.completedOnTime)}</TableCell>
                  <TableCell
                    className={`text-end tabular-nums ${row.overdue > 0 ? "font-semibold text-destructive" : ""}`}
                  >
                    {i18n.number(row.overdue)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{i18n.number(row.inReview)}</TableCell>
                  <TableCell className="text-end tabular-nums">{i18n.number(row.revisions)}</TableCell>
                  <TableCell className="text-end tabular-nums">{i18n.number(row.submissions)}</TableCell>
                  <TableCell className="text-end tabular-nums">{hours(row.avgStartDelayHours)}</TableCell>
                  <TableCell className="pe-4 text-end tabular-nums">{hours(row.avgCompletionDelayHours)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t.reports.note}</p>
    </div>
  );
}
