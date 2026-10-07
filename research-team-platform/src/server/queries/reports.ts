import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { unwrap } from "@/server/action";
import type { ExecutionReportRow } from "@/types/app";

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Planned vs actual execution per responsible member (RLS-scoped, SECURITY INVOKER). */
export async function getExecutionReport(filters: {
  projectId?: string;
  month?: number;
}): Promise<ExecutionReportRow[]> {
  const supabase = await createSupabaseServerClient();
  const rows = unwrap(
    await supabase.rpc("get_execution_report", {
      p_project_id: filters.projectId ?? undefined,
      p_planning_month: filters.month ?? undefined,
    }),
  );
  return rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    total: Number(row.total),
    completed: Number(row.completed),
    completedOnTime: Number(row.completed_on_time),
    overdue: Number(row.overdue),
    inReview: Number(row.in_review),
    revisions: Number(row.revisions),
    submissions: Number(row.submissions),
    avgStartDelayHours: toNumber(row.avg_start_delay_hours),
    avgCompletionDelayHours: toNumber(row.avg_completion_delay_hours),
  }));
}
