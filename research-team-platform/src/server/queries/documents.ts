import "server-only";

import { createFirebaseServerClient } from "@/lib/firebase/compat";
import { unwrapMaybe } from "@/server/action";
import { pageRange, PROFILE_FIELDS, sanitizeSearch, toUserRef } from "@/server/queries/shared";
import type { DocumentItem, Paginated } from "@/types/app";

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
  const firebase = await createFirebaseServerClient();

  let query = firebase.from("documents").select(DOCUMENT_SELECT, { count: "exact" });
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
  const firebase = await createFirebaseServerClient();
  return unwrapMaybe(
    await firebase
      .from("documents")
      .select("id, project_id, title, file_name, storage_path, mime_type")
      .eq("id", documentId)
      .maybeSingle(),
  );
}
