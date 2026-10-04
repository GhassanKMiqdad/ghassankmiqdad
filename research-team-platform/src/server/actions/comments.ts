"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { canDeleteComment, canEditComment } from "@/lib/permissions/policy";
import { createFirebaseServerClient } from "@/lib/firebase/compat";
import { optionalUuidField, uuidField } from "@/lib/validation/common";
import { commentSchema } from "@/lib/validation/comment";
import { assertProjectAccess, assertProjectPermission } from "@/server/access";
import { parseInput, runAction, unwrap, unwrapMaybe } from "@/server/action";

function revalidateCommentPaths(projectId: string, taskId: string | null) {
  revalidatePath(taskId ? `/projects/${projectId}/tasks/${taskId}` : `/projects/${projectId}`);
}

export async function addCommentAction(
  projectId: string,
  taskId: string | null,
  input: unknown,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const task = parseInput(optionalUuidField, taskId);
    const { content } = parseInput(commentSchema, input);
    await assertProjectPermission(id, "comments.create");

    const firebase = await createFirebaseServerClient();
    if (task) {
      const visible = unwrapMaybe(
        await firebase.from("tasks").select("id").eq("id", task).eq("project_id", id).maybeSingle(),
      );
      if (!visible) throw new AppError("NOT_FOUND");
    }

    unwrap(await firebase.from("comments").insert({ project_id: id, task_id: task, content }));
    revalidateCommentPaths(id, task);
    return null;
  });
}

async function loadComment(commentId: string) {
  const firebase = await createFirebaseServerClient();
  const comment = unwrapMaybe(
    await firebase.from("comments").select("id, project_id, task_id, author_id").eq("id", commentId).maybeSingle(),
  );
  if (!comment) throw new AppError("NOT_FOUND");
  return { firebase, comment };
}

export async function updateCommentAction(commentId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, commentId);
    const { content } = parseInput(commentSchema, input);
    const { firebase, comment } = await loadComment(id);
    const access = await assertProjectAccess(comment.project_id);
    if (!canEditComment(access, comment.author_id)) throw new AppError("PERMISSION_DENIED");

    const updated = unwrap(await firebase.from("comments").update({ content }).eq("id", id).select("id"));
    if (updated.length === 0) throw new AppError("PERMISSION_DENIED");

    revalidateCommentPaths(comment.project_id, comment.task_id);
    return null;
  });
}

export async function deleteCommentAction(commentId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, commentId);
    const { firebase, comment } = await loadComment(id);
    const access = await assertProjectAccess(comment.project_id);
    if (!canDeleteComment(access, comment.author_id)) throw new AppError("PERMISSION_DENIED");

    const deleted = unwrap(await firebase.from("comments").delete().eq("id", id).select("id"));
    if (deleted.length === 0) throw new AppError("PERMISSION_DENIED");

    revalidateCommentPaths(comment.project_id, comment.task_id);
    return null;
  });
}
