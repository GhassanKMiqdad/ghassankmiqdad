"use server";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { firebaseAdminFirestore } from "@/lib/firebase/admin";
import { can } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { parseInput, runAction } from "@/server/action";
import { uuidField } from "@/lib/validation/common";
import { taskDeliverableSchema } from "@/lib/validation/deliverable";

function hasTaskEdit(member: FirebaseFirestore.DocumentData) {
  return member.role === "owner" || (Array.isArray(member.permissions) && member.permissions.includes("tasks.edit"));
}

export async function createTaskDeliverableAction(taskId: string, input: unknown) {
  return runAction(async (user) => {
    const id = parseInput(uuidField, taskId);
    const values = parseInput(taskDeliverableSchema, input);
    const db = firebaseAdminFirestore();
    const taskRef = db.collection("tasks").doc(id);
    const taskSnapshot = await taskRef.get();
    if (!taskSnapshot.exists) throw new AppError("NOT_FOUND");
    const task = taskSnapshot.data()!;
    const projectId = String(task.project_id ?? "");
    const access = await getProjectAccess(projectId);
    if (!access || !can(access, "project.view")) throw new AppError("NOT_FOUND");
    if (!can(access, "tasks.edit")) throw new AppError("PERMISSION_DENIED");

    const memberRef = db.collection("project_members").doc(`${projectId}_${user.id}`);
    const deliverableRef = db.collection("deliverables").doc(crypto.randomUUID());
    const activityRef = db.collection("activity_logs").doc(crypto.randomUUID());
    const profile = await db.collection("profiles").doc(user.id).get();
    const actorName = String(profile.get("full_name") ?? user.email ?? "User");
    const timestamp = new Date().toISOString();

    await db.runTransaction(async (transaction) => {
      const [currentTask, currentMember] = await Promise.all([transaction.get(taskRef), transaction.get(memberRef)]);
      if (!currentTask.exists || currentTask.get("project_id") !== projectId) throw new AppError("NOT_FOUND");
      if (!currentMember.exists || currentMember.get("status") !== "active" || !hasTaskEdit(currentMember.data()!)) {
        throw new AppError("PERMISSION_DENIED");
      }
      transaction.create(deliverableRef, {
        id: deliverableRef.id,
        project_id: projectId,
        team_id: typeof currentTask.get("team_id") === "string" ? currentTask.get("team_id") : null,
        task_id: id,
        name: values.name,
        description: values.description,
        required: values.required,
        type: values.type,
        status: "pending",
        submitted_file_ids: [],
        submission_id: null,
        created_by: user.id,
        created_at: timestamp,
        updated_at: timestamp,
        approved_at: null,
      });
      transaction.create(activityRef, {
        id: activityRef.id,
        project_id: projectId,
        actor_id: user.id,
        actor_email: user.email,
        actor_name: actorName,
        action: "deliverable.created",
        entity_type: "task",
        entity_id: id,
        entity_label: String(currentTask.get("title") ?? ""),
        old_values: null,
        new_values: {
          deliverable_id: deliverableRef.id,
          name: values.name,
          required: values.required,
          type: values.type,
        },
        metadata: { task_title: String(currentTask.get("title") ?? "") },
        ip_address: null,
        user_agent: null,
        created_at: timestamp,
      });
    });

    revalidatePath(`/projects/${projectId}/tasks/${id}`);
    revalidatePath(`/projects/${projectId}/tasks/${id}/submissions`);
    return { deliverableId: deliverableRef.id };
  });
}
