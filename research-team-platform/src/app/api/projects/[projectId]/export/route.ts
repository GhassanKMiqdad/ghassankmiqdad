import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { mapFirebaseError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { createFirebaseServerClient } from "@/lib/firebase/compat";
import { getProjectAccess } from "@/server/access";
import { getSessionUser } from "@/server/auth";

const querySchema = z.object({ format: z.enum(["csv", "json"]).default("csv") });

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function fileSafe(name: string): string {
  return (
    name
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

/**
 * Exports project data for members holding data.export. Every query below runs
 * with the caller's session, so RLS still filters what each section contains,
 * and the export itself is written to the activity log.
 */
export async function GET(request: NextRequest, context: RouteContext<"/api/projects/[projectId]/export">) {
  const { projectId } = await context.params;
  const { t } = await getI18n();

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: t.errors.NOT_AUTHENTICATED }, { status: 401 });

  const parsedId = z.uuid().safeParse(projectId);
  const parsedQuery = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsedId.success || !parsedQuery.success) {
    return NextResponse.json({ error: t.errors.INVALID_INPUT }, { status: 400 });
  }

  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) {
    return NextResponse.json({ error: t.errors.PROJECT_ACCESS_DENIED }, { status: 403 });
  }
  if (!can(access, "data.export")) {
    return NextResponse.json({ error: t.errors.PERMISSION_DENIED }, { status: 403 });
  }

  const { format } = parsedQuery.data;
  const firebase = await createFirebaseServerClient();

  // Audit first: if the export cannot be recorded, it does not happen.
  const audit = await firebase.rpc("record_project_export", {
    p_project_id: projectId,
    p_format: format,
    p_scope: format === "csv" ? "tasks" : "project",
  });
  if (audit.error) {
    const code = mapFirebaseError(audit.error);
    return NextResponse.json({ error: t.errors[code] }, { status: code === "PERMISSION_DENIED" ? 403 : 500 });
  }

  const tasks = await firebase
    .from("tasks")
    .select(
      "id, title, description, status, priority, due_date, created_at, updated_at, completed_at, assignee:profiles!tasks_assigned_to_fkey(full_name, email), creator:profiles!tasks_created_by_fkey(full_name, email)",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (tasks.error) return NextResponse.json({ error: t.errors.UNEXPECTED }, { status: 500 });

  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = `${fileSafe(access.projectName)}-${stamp}`;
  const headers = { "Cache-Control": "private, no-store" };

  if (format === "csv") {
    const header = [
      "id",
      "title",
      "description",
      "status",
      "priority",
      "assignee",
      "assignee_email",
      "created_by",
      "due_date",
      "created_at",
      "updated_at",
      "completed_at",
    ];
    const rows = (tasks.data ?? []).map((task) =>
      [
        task.id,
        task.title,
        task.description,
        task.status,
        task.priority,
        task.assignee?.full_name ?? "",
        task.assignee?.email ?? "",
        task.creator?.full_name ?? "",
        task.due_date,
        task.created_at,
        task.updated_at,
        task.completed_at,
      ]
        .map(csvCell)
        .join(","),
    );
    // BOM so Excel opens UTF-8 (Arabic) correctly.
    const body = `﻿${[header.join(","), ...rows].join("\r\n")}`;
    return new NextResponse(body, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(baseName)}-tasks.csv"; filename*=UTF-8''${encodeURIComponent(baseName)}-tasks.csv`,
      },
    });
  }

  const [project, documents, comments, members] = await Promise.all([
    firebase
      .from("projects")
      .select(
        "id, name, description, research_goal, research_type, research_objectives, research_questions, methodology, status, start_date, deadline, created_at, updated_at",
      )
      .eq("id", projectId)
      .maybeSingle(),
    can(access, "documents.view")
      ? firebase
          .from("documents")
          .select("id, title, description, file_name, mime_type, size_bytes, created_at, uploaded_by")
          .eq("project_id", projectId)
      : Promise.resolve({ data: null, error: null }),
    firebase
      .from("comments")
      .select("id, task_id, content, author_id, created_at, updated_at")
      .eq("project_id", projectId),
    can(access, "team.view")
      ? firebase.rpc("get_project_team", { p_project_id: projectId })
      : Promise.resolve({ data: null, error: null }),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    exported_by: user.email,
    project: project.data,
    tasks: tasks.data,
    documents: documents.data ?? undefined,
    comments: comments.data,
    members:
      members.data?.map((member: Record<string, unknown>) => ({
        user_id: member.user_id,
        full_name: member.full_name,
        email: member.email,
        role: member.role,
        status: member.status,
        permissions: member.permissions,
      })) ?? undefined,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(baseName)}.json"; filename*=UTF-8''${encodeURIComponent(baseName)}.json`,
    },
  });
}
