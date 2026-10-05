import "server-only";

import { firebaseAdminFirestore } from "@/lib/firebase/admin";
import { getProjectAccess } from "@/server/access";
import { getTask } from "@/server/queries/tasks";
import type { TaskDeliverable } from "@/types/research-workflow";

function asIso(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return (value.toDate() as Date).toISOString();
  }
  return typeof value === "string" ? value : new Date(0).toISOString();
}

export async function listTaskDeliverables(projectId: string, taskId: string): Promise<TaskDeliverable[]> {
  const access = await getProjectAccess(projectId);
  if (!access || access.status !== "active") return [];
  const task = await getTask(taskId);
  if (!task || task.projectId !== projectId) return [];
  const db = firebaseAdminFirestore();
  const snapshot = await db
    .collection("deliverables")
    .where("project_id", "==", projectId)
    .where("task_id", "==", taskId)
    .orderBy("created_at", "asc")
    .limit(100)
    .get();
  return snapshot.docs.map((doc) => {
    const row = doc.data();
    return {
      id: doc.id,
      projectId,
      teamId: typeof row.team_id === "string" ? row.team_id : null,
      taskId,
      name: String(row.name ?? ""),
      description: String(row.description ?? ""),
      required: row.required === true,
      type: row.type,
      status: row.status,
      submittedFileIds: Array.isArray(row.submitted_file_ids)
        ? row.submitted_file_ids.filter((value: unknown): value is string => typeof value === "string")
        : [],
      submissionId: typeof row.submission_id === "string" ? row.submission_id : null,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
      approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
    };
  });
}
