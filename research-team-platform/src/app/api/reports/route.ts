import { NextResponse } from "next/server";

import { can } from "@/lib/permissions/policy";
import { getMyProjectsAccess } from "@/server/access";
import { getSessionUser } from "@/server/auth";
import { getAuthorizedReportData } from "@/server/queries/reports";

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  const [report, access] = await Promise.all([getAuthorizedReportData(), getMyProjectsAccess()]);
  const grants = new Map(access.map((item) => [item.projectId, item]));
  const exportableRows = report.rows.filter(({ projectId, task }) => {
    const projectAccess = grants.get(projectId);
    return !!projectAccess && (can(projectAccess, "data.export") || task.assignedToId === user.id);
  });
  const header = ["project_id", "project", "task_id", "title", "status", "priority", "assignee", "due_date", "overdue"];
  const rows = exportableRows.map(({ projectId, projectName, task }) =>
    [
      projectId,
      projectName,
      task.id,
      task.title,
      task.status,
      task.priority,
      task.assignee?.name ?? "",
      task.dueDate,
      task.isOverdue,
    ]
      .map(csvCell)
      .join(","),
  );
  const body = `\uFEFF${[header.join(","), ...rows].join("\r\n")}`;
  return new NextResponse(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="authorized-research-report.csv"',
      "X-Report-Truncated": report.truncated && access.some((item) => can(item, "data.export")) ? "true" : "false",
    },
  });
}
