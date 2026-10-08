import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { unwrapMaybe } from "@/server/action";
import { pageRange, PROFILE_FIELDS, sanitizeSearch, toUserRef } from "@/server/queries/shared";
import type { DocumentItem, Paginated, TaskFileItem } from "@/types/app";

export type DocumentFilters = {
  projectId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

const DOCUMENT_SELECT = `id, project_id, title, description, file_name, mime_type, size_bytes, created_at, updated_at,
  project:projects(id, name),
  uploader:profiles!documents_uploaded_by_fkey(${PROFILE_FIELDS})`;

export async function listDocuments(filters: DocumentFilters): Promise<Paginated<DocumentItem>> {
  const pageSize = filters.pageSize ?? 25;
  const { page, from, to } = pageRange(filters.page ?? 1, pageSize);
  const supabase = await createSupabaseServerClient();

  // The library lists project documents only; private task files live on their task.
  let query = supabase.from("documents").select(DOCUMENT_SELECT, { count: "exact" }).is("task_id", null);
  if (filters.projectId) query = query.eq("project_id", filters.projectId);
  const search = sanitizeSearch(filters.q);
  if (search) query = query.or(`title.ilike.%${search}%,file_name.ilike.%${search}%`);

  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);
  if (error) throw error;

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project?.name ?? "",
      title: row.title,
      description: row.description,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      uploadedBy: toUserRef(row.uploader),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getDocumentForAction(documentId: string) {
  const supabase = await createSupabaseServerClient();
  return unwrapMaybe(
    await supabase
      .from("documents")
      .select("id, project_id, task_id, uploaded_by, title, file_name, storage_path, mime_type")
      .eq("id", documentId)
      .maybeSingle(),
  );
}

const TASK_FILE_SELECT = `id, task_id, title, file_name, mime_type, size_bytes, uploaded_by, created_at,
  uploader:profiles!documents_uploaded_by_fkey(${PROFILE_FIELDS})`;

type TaskFileRow = {
  id: string;
  task_id: string | null;
  title: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
  uploader: Parameters<typeof toUserRef>[0];
};

function toTaskFile(row: TaskFileRow): TaskFileItem {
  return {
    id: row.id,
    taskId: row.task_id ?? "",
    title: row.title,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedById: row.uploaded_by,
    uploadedBy: toUserRef(row.uploader),
    createdAt: row.created_at,
  };
}

/** Private files of a task (RLS: supervisors and the responsible member; the team once published). */
export async function listTaskFiles(taskId: string): Promise<TaskFileItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .select(TASK_FILE_SELECT)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toTaskFile);
}

/** Task files by id, as far as the caller may read them (RLS decides, ids are only a filter). */
export async function listTaskFilesByIds(ids: string[]): Promise<TaskFileItem[]> {
  if (ids.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .select(TASK_FILE_SELECT)
    .in("id", ids)
    .not("task_id", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toTaskFile);
}
