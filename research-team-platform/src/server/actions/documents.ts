"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { MAX_UPLOAD_BYTES } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { documentStoragePath, isDocumentPathFor, resolveFileType } from "@/lib/files";
import { createFirebaseServerClient } from "@/lib/firebase/compat";
import { uuidField } from "@/lib/validation/common";
import { documentDetailsSchema, finalizeUploadSchema, prepareUploadSchema } from "@/lib/validation/document";
import { assertProjectPermission } from "@/server/access";
import { can } from "@/lib/permissions/policy";
import { requireTaskAccess } from "@/server/research-domain";
import { parseInput, runAction, unwrap } from "@/server/action";
import { getDocumentForAction } from "@/server/queries/documents";
import { DOCUMENT_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/server/storage";

function revalidateDocumentPaths(projectId: string) {
  revalidatePath("/documents");
  revalidatePath(`/projects/${projectId}`, "layout");
}

/**
 * Step 1 of an upload: authorize, validate type and size, and issue a signed
 * upload URL for a server-chosen path. The browser then uploads the file
 * straight to Storage (no size limits of serverless functions).
 */
export async function prepareDocumentUploadAction(input: unknown): Promise<
  ActionResult<{
    documentId: string;
    storagePath: string;
    signedUrl: string;
    signedFields: Record<string, string>;
    mimeType: string;
  }>
> {
  return runAction(async (user) => {
    const values = parseInput(prepareUploadSchema, input);
    if (values.taskId) {
      const { projectId, task, access } = await requireTaskAccess(user.id, values.taskId);
      if (
        projectId !== values.projectId ||
        task.assigned_to !== user.id ||
        !can(access, "tasks.submit") ||
        !["accepted", "in_progress", "revision_required"].includes(String(task.status))
      )
        throw new AppError("PERMISSION_DENIED");
    } else {
      await assertProjectPermission(values.projectId, "documents.upload");
    }

    const fileType = resolveFileType(values.fileName);
    if (!fileType) throw new AppError("FILE_TYPE_NOT_ALLOWED");
    if (values.size > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", { values: { size: "50 MB" } });

    const documentId = crypto.randomUUID();
    const storagePath = documentStoragePath(values.projectId, documentId, values.fileName);

    // The server authorizes the user's project upload permission and signs a
    // bounded POST policy (content type + 50 MB cap) for this exact object path.
    const firebase = await createFirebaseServerClient();
    const { data, error } = await firebase.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(storagePath, {
      contentType: fileType.mimeType,
      maxBytes: MAX_UPLOAD_BYTES,
    });
    if (error || !data) {
      console.error("[documents] signed upload URL failed", error?.message);
      throw new AppError("UPLOAD_FAILED");
    }

    return {
      documentId,
      storagePath,
      signedUrl: data.signedUrl,
      signedFields: data.signedFields,
      mimeType: fileType.mimeType,
    };
  });
}

/** Step 2: register the uploaded file (the database verifies the object exists). */
export async function finalizeDocumentUploadAction(input: unknown): Promise<ActionResult<{ documentId: string }>> {
  return runAction(async (user) => {
    const values = parseInput(finalizeUploadSchema, input);
    if (values.taskId) {
      const { projectId, task, access } = await requireTaskAccess(user.id, values.taskId);
      if (
        projectId !== values.projectId ||
        task.assigned_to !== user.id ||
        !can(access, "tasks.submit") ||
        !["accepted", "in_progress", "revision_required"].includes(String(task.status))
      )
        throw new AppError("PERMISSION_DENIED");
    } else {
      await assertProjectPermission(values.projectId, "documents.upload");
    }

    if (!isDocumentPathFor(values.projectId, values.documentId, values.storagePath)) {
      throw new AppError("INVALID_INPUT");
    }
    const fileType = resolveFileType(values.fileName);
    if (!fileType) throw new AppError("FILE_TYPE_NOT_ALLOWED");

    const firebase = await createFirebaseServerClient();
    unwrap(
      await firebase.from("documents").insert({
        id: values.documentId,
        project_id: values.projectId,
        task_id: values.taskId,
        title: values.title,
        description: values.description,
        file_name: values.fileName,
        storage_path: values.storagePath,
        mime_type: fileType.mimeType,
        size_bytes: 0, // replaced by the real size from Storage (trigger)
      }),
    );

    revalidateDocumentPaths(values.projectId);
    return { documentId: values.documentId };
  });
}

/** Removes an uploaded object that could not be registered (failed step 2). */
export async function discardDocumentUploadAction(
  projectId: string,
  storagePath: string,
  taskId?: string,
): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, projectId);
    const validatedTaskId = taskId ? parseInput(uuidField, taskId) : null;
    if (validatedTaskId) {
      const { projectId, task, access } = await requireTaskAccess(user.id, validatedTaskId);
      if (projectId !== id || task.assigned_to !== user.id || !can(access, "tasks.submit"))
        throw new AppError("PERMISSION_DENIED");
    } else {
      await assertProjectPermission(id, "documents.upload");
    }
    const segments = storagePath.split("/");
    if (segments.length !== 3 || segments[0] !== id || !isDocumentPathFor(id, segments[1] ?? "", storagePath)) {
      throw new AppError("INVALID_INPUT");
    }

    // The user's own session: the storage DELETE policy only lets the
    // uploader remove their object while no document row references it.
    const firebase = await createFirebaseServerClient();
    const { error } = await firebase.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
    if (error) console.warn("[documents] could not discard pending upload", error.message);
    return null;
  });
}

export async function getDocumentUrlAction(
  documentId: string,
  mode: "view" | "download",
): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const id = parseInput(uuidField, documentId);
    const document = await getDocumentForAction(id);
    if (!document) throw new AppError("NOT_FOUND");

    const firebase = await createFirebaseServerClient();
    const { data, error } = await firebase.storage
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
    await assertProjectPermission(document.project_id, "documents.edit");

    const firebase = await createFirebaseServerClient();
    const updated = unwrap(
      await firebase
        .from("documents")
        .update({ title: values.title, description: values.description })
        .eq("id", id)
        .select("id"),
    );
    if (updated.length === 0) throw new AppError("PERMISSION_DENIED");

    revalidateDocumentPaths(document.project_id);
    return null;
  });
}

export async function deleteDocumentAction(documentId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, documentId);
    const document = await getDocumentForAction(id);
    if (!document) throw new AppError("NOT_FOUND");
    await assertProjectPermission(document.project_id, "documents.delete");

    const firebase = await createFirebaseServerClient();
    const deleted = unwrap(await firebase.from("documents").delete().eq("id", id).select("id"));
    if (deleted.length === 0) throw new AppError("PERMISSION_DENIED");

    // Same user session: the storage DELETE policy requires documents.delete too.
    const { error } = await firebase.storage.from(DOCUMENT_BUCKET).remove([document.storage_path]);
    if (error) console.error("[documents] file removal failed", error.message);

    revalidateDocumentPaths(document.project_id);
    return null;
  });
}
