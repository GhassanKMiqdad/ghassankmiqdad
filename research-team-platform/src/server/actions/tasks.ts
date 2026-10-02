"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { evaluateTaskCreate, evaluateTaskUpdate } from "@/lib/permissions/policy";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidField } from "@/lib/validation/common";
import { taskFormSchema, taskPatchSchema } from "@/lib/validation/task";
import { assertProjectAccess, assertProjectPermission } from "@/server/access";
import { parseInput, runAction, unwrap, unwrapMaybe } from "@/server/action";

function revalidateTaskPaths(projectId: string, taskId?: string) {
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath(`/projects/${projectId}`, "layout");
  if (taskId) revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}

export async function createTaskAction(projectId: string, input: unknown): Promise<ActionResult<{ taskId: string }>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const values = parseInput(taskFormSchema, input);
    const access = await assertProjectPermission(id, "tasks.create");

    const decision = evaluateTaskCreate(access, { assignedTo: values.assignedTo, status: values.status });
    if (!decision.ok) throw new AppError(decision.code);

    const supabase = await createSupabaseServerClient();
    const task = unwrap(
      await supabase
        .from("tasks")
        .insert({
          project_id: id,
          title: values.title,
          description: values.description,
          status: values.status,
          priority: values.priority,
          assigned_to: values.assignedTo,
          due_date: values.dueDate,
        })
        .select("id")
        .single(),
    );

    revalidateTaskPaths(id);
    return { taskId: task.id };
  });
}

export async function updateTaskAction(taskId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const patch = parseInput(taskPatchSchema, input);
    const supabase = await createSupabaseServerClient();

    // RLS: a task the user cannot see does not exist for them (no IDOR).
    const task = unwrapMaybe(
      await supabase
        .from("tasks")
        .select("id, project_id, title, description, priority, due_date, status, created_by, assigned_to")
        .eq("id", id)
        .maybeSingle(),
    );
    if (!task) throw new AppError("NOT_FOUND");

    const access = await assertProjectAccess(task.project_id);
    const decision = evaluateTaskUpdate(
      access,
      { createdBy: task.created_by, assignedTo: task.assigned_to, status: task.status },
      {
        title: patch.title,
        description: patch.description,
        priority: patch.priority,
        dueDate: patch.dueDate,
        status: patch.status,
        assignedTo: patch.assignedTo,
      },
      { title: task.title, description: task.description, priority: task.priority, dueDate: task.due_date },
    );
    if (!decision.ok) throw new AppError(decision.code);

    const update: {
      title?: string;
      description?: string;
      status?: typeof task.status;
      priority?: typeof task.priority;
      assigned_to?: string | null;
      due_date?: string | null;
    } = {};
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.priority !== undefined) update.priority = patch.priority;
    if (patch.assignedTo !== undefined) update.assigned_to = patch.assignedTo;
    if (patch.dueDate !== undefined) update.due_date = patch.dueDate;

    const updated = unwrap(await supabase.from("tasks").update(update).eq("id", id).select("id"));
    if (updated.length === 0) throw new AppError("TASK_EDIT_FORBIDDEN");

    revalidateTaskPaths(task.project_id, id);
    return null;
  });
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult<{ projectId: string }>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const supabase = await createSupabaseServerClient();
    const task = unwrapMaybe(await supabase.from("tasks").select("id, project_id").eq("id", id).maybeSingle());
    if (!task) throw new AppError("NOT_FOUND");

    await assertProjectPermission(task.project_id, "tasks.delete");

    const deleted = unwrap(await supabase.from("tasks").delete().eq("id", id).select("id"));
    if (deleted.length === 0) throw new AppError("PERMISSION_DENIED");

    revalidateTaskPaths(task.project_id);
    return { projectId: task.project_id };
  });
}
