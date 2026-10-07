import "server-only";

import { createFirebaseServerClient } from "@/lib/firebase/compat";
import { unwrap } from "@/server/action";
import { PROFILE_FIELDS, toUserRef } from "@/server/queries/shared";
import type { CommentItem } from "@/types/app";

/** Comments of a project (taskId null) or of one task, oldest first. */
export async function listComments(projectId: string, taskId: string | null): Promise<CommentItem[]> {
  const firebase = await createFirebaseServerClient();
  let query = firebase
    .from("comments")
    .select(
      `id, project_id, task_id, content, author_id, created_at, updated_at,
       author:profiles!comments_author_id_fkey(${PROFILE_FIELDS})`,
    )
    .eq("project_id", projectId);

  query = taskId ? query.eq("task_id", taskId) : query.is("task_id", null);
  const rows = unwrap(await query.order("created_at", { ascending: true }).limit(500));

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    content: row.content,
    authorId: row.author_id,
    author: toUserRef(row.author),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    edited: new Date(row.updated_at).getTime() - new Date(row.created_at).getTime() > 1000,
  }));
}
