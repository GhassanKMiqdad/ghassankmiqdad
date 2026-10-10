"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { MAX_UPLOAD_BYTES } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { documentStoragePath, isDocumentPathFor, resolveFileType } from "@/lib/files";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidField } from "@/lib/validation/common";
import { documentDetailsSchema, finalizeUploadSchema, prepareUploadSchema } from "@/lib/validation/document";
import { canAttachTaskFile, canManageTaskFile } from "@/lib/permissions/policy";
import { assertProjectAccess, assertProjectPermission } from "@/server/access";
import { parseInput, runAction, unwrap, unwrapMaybe } from "@/server/action";
import { getDocumentForAction } from "@/server/queries/documents";
import { DOCUMENT_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/server/storage";

function revalidateDocumentPaths(projectId: string) {
  revalidatePath("/documents");
  revalidatePath(`/projects/${projectId}`, "layout");
}

/**
 * Upload rights: a private task file follows the task (the responsible member
 * while working on it, or a supervisor); a library file needs documents.upload.
 * The database re-checks both (documents RLS + documents_task_file_guard).
 */
async function assertUploadAllowed(projectId: string, taskId: string | null | undefined) {
  if (!taskId) {
    await assertProjectPermission(projectId, "documents.upload");
    return;
  }
  const access = await assertProjectAccess(projectId);
  const supabase = await createSupabaseServerClient();
  const task = unwrapMaybe(
    await supabase
      .from("tasks")
      .select("id, created_by, assigned_to, status")
      .eq("id", taskId)
      .eq("project_id", projectId)
      .maybeSingle(),
  );
  if (!task) throw new AppError("NOT_FOUND");
  const snapshot = { createdBy: task.created_by, assignedTo: task.assigned_to, status: task.status };
  if (!canAttachTaskFile(access, snapshot)) throw new AppError("TASK_EDIT_FORBIDDEN");
}

/**
 * Step 1 of an upload: authorize, validate type and size, and issue a signed
 * upload URL for a server-chosen path. The browser then uploads the file
 * straight to Storage (no size limits of serverless functions).
 */
export async function prepareDocumentUploadAction(
  input: unknown,
): Promise<ActionResult<{ documentId: string; storagePath: string; token: string; mimeType: string }>> {
  return runAction(async () => {
    const values = parseInput(prepareUploadSchema, input);
    await assertUploadAllowed(values.projectId, values.taskId);

    const fileType = resolveFileType(values.fileName);
    if (!fileType) throw new AppError("FILE_TYPE_NOT_ALLOWED");
    if (values.size > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", { values: { size: "50 MB" } });

    const documentId = crypto.randomUUID();
    const storagePath = documentStoragePath(values.projectId, documentId, values.fileName);

    // Created with the user's session: Storage checks the INSERT policy
    // (documents.upload in this project) before issuing the URL.
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(storagePath);
    if (error || !data) {
      console.error("[documents] signed upload URL failed", error?.message);
      throw new AppError("UPLOAD_FAILED");
    }

    return { documentId, storagePath, token: data.token, mimeType: fileType.mimeType };
  });
}

/** Step 2: register the uploaded file (the database verifies the object exists). */
export async function finalizeDocumentUploadAction(input: unknown): Promise<ActionResult<{ documentId: string }>> {
  return runAction(async () => {
    const values = parseInput(finalizeUploadSchema, input);
    await assertUploadAllowed(values.projectId, values.taskId);

    if (!isDocumentPathFor(values.projectId, values.documentId, values.storagePath)) {
      throw new AppError("INVALID_INPUT");
    }
    const fileType = resolveFileType(values.fileName);
    if (!fileType) throw new AppError("FILE_TYPE_NOT_ALLOWED");

    const supabase = await createSupabaseServerClient();
    unwrap(
      await supabase.from("documents").insert({
        id: values.documentId,
        project_id: values.projectId,
        task_id: values.taskId ?? null,
        title: values.title,
        description: values.description,
        file_name: values.fileName,
        storage_path: values.storagePath,
        mime_type: fileType.mimeType,
        size_bytes: 0, // replaced by the real size from Storage (trigger)
      }),
    );

    revalidateDocumentPaths(values.projectId);
    if (values.taskId) revalidatePath(`/projects/${values.projectId}/tasks/${values.taskId}`);
    return { documentId: values.documentId };
  });
}

/** Removes an uploaded object that could not be registered (failed step 2). */
export async function discardDocumentUploadAction(projectId: string, storagePath: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    await assertProjectPermission(id, "documents.upload");
    const segments = storagePath.split("/");
    if (segments.length !== 3 || segments[0] !== id || !isDocumentPathFor(id, segments[1] ?? "", storagePath)) {
      throw new AppError("INVALID_INPUT");
    }

    // The user's own session: the storage DELETE policy only lets the
    // uploader remove their object while no document row references it.
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
    if (error) console.warn("[documents] could not discard pending upload", error.message);
    return null;
  });
}

/**
 * Library files: documents.edit / documents.delete. Task files: their uploader or
 * a supervisor; a file handed in with a version is locked (DOCUMENT_LOCKED).
 */
async function assertDocumentManageable(
  document: { project_id: string; task_id: string | null; uploaded_by: string | null },
  libraryPermission: "documents.edit" | "documents.delete",
) {
  if (!document.task_id) {
    await assertProjectPermission(document.project_id, libraryPermission);
    return;
  }
  const access = await assertProjectAccess(document.project_id);
  if (!canManageTaskFile(access, document.uploaded_by)) throw new AppError("PERMISSION_DENIED");
}

export async function getDocumentUrlAction(
  documentId: string,
  mode: "view" | "download",
): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const id = parseInput(uuidField, documentId);
    // RLS decides which rows are readable: a private task file only by the task's
    // supervisors and responsible member, by the team only once published.
    const document = await getDocumentForAction(id);
    if (!document) throw new AppError("NOT_FOUND");
    if (document.task_id) await assertProjectAccess(document.project_id);
    else await assertProjectPermission(document.project_id, "documents.view");

    // Signed with the caller's session: the storage SELECT policy applies the same rule.
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS, {
        download: mode === "download" ? document.file_name : false,
      });
    if (error || !data) throw new AppError("NOT_FOUND");
    return { url: data.signedUrl };
  });
}

export async function updateDocumentAction(documentId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, documentId);
    const values = parseInput(documentDetailsSchema, input);
    const document = await getDocumentForAction(id);
    if (!document) throw new AppError("NOT_FOUND");
    await assertDocumentManageable(document, "documents.edit");

    const supabase = await createSupabaseServerClient();
    const updated = unwrap(
      await supabase
        .from("documents")
        .update({ title: values.title, description: values.description })
        .eq("id", id)
        .select("id"),
    );
    if (updated.length === 0) throw new AppError("PERMISSION_DENIED");

    revalidateDocumentPaths(document.project_id);
    if (document.task_id) revalidatePath(`/projects/${document.project_id}/tasks/${document.task_id}`);
    return null;
  });
}

export async function deleteDocumentAction(documentId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, documentId);
    const document = await getDocumentForAction(id);
    if (!document) throw new AppError("NOT_FOUND");
    await assertDocumentManageable(document, "documents.delete");

    const supabase = await createSupabaseServerClient();
    const deleted = unwrap(await supabase.from("documents").delete().eq("id", id).select("id"));
    if (deleted.length === 0) throw new AppError("PERMISSION_DENIED");

    // Same user session: the storage DELETE policy requires documents.delete too.
    const { error } = await supabase.storage.from(DOCUMENT_BUCKET).remove([document.storage_path]);
    if (error) console.error("[documents] file removal failed", error.message);

    revalidateDocumentPaths(document.project_id);
    if (document.task_id) revalidatePath(`/projects/${document.project_id}/tasks/${document.task_id}`);
    return null;
  });
}
