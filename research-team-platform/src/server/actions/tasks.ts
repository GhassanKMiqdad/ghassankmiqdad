"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { normalizeTaskStatus } from "@/lib/permissions/catalog";
import { evaluateTaskCreate, evaluateTaskUpdate } from "@/lib/permissions/policy";
import { createFirebaseServerClient } from "@/lib/firebase/compat";
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
    if (values.status !== "assigned") throw new AppError("TASK_STATUS_FORBIDDEN");
    const access = await assertProjectPermission(id, "tasks.create");

    const decision = evaluateTaskCreate(access, { assignedTo: values.assignedTo, status: values.status });
    if (!decision.ok) throw new AppError(decision.code);

    const firebase = await createFirebaseServerClient();
    const task = unwrap(
      await firebase
        .from("tasks")
        .insert({
          project_id: id,
          title: values.title,
          description: values.description,
          original_instructions: values.originalInstructions,
          expected_output: values.expectedOutput,
          required_deliverables: values.requiredDeliverables,
          team_id: values.teamId ?? null,
          status: values.status,
          priority: values.priority,
          assigned_to: values.assignedTo,
          due_date: values.dueDate,
          start_date: values.startDate,
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
    const firebase = await createFirebaseServerClient();

    // RLS: a task the user cannot see does not exist for them (no IDOR).
    const task = unwrapMaybe(
      await firebase
        .from("tasks")
        .select(
          "id, project_id, team_id, title, description, original_instructions, expected_output, required_deliverables, priority, start_date, due_date, status, created_by, assigned_to",
        )
        .eq("id", id)
        .maybeSingle(),
    );
    if (!task) throw new AppError("NOT_FOUND");

    const currentStatus = normalizeTaskStatus(task.status);
    if (!currentStatus) throw new AppError("TASK_STATUS_FORBIDDEN");
    const access = await assertProjectAccess(task.project_id);
    const decision = evaluateTaskUpdate(
      access,
      { createdBy: task.created_by, assignedTo: task.assigned_to, status: currentStatus },
      {
        title: patch.title,
        description: patch.description,
        originalInstructions: patch.originalInstructions,
        expectedOutput: patch.expectedOutput,
        requiredDeliverables: patch.requiredDeliverables,
        priority: patch.priority,
        dueDate: patch.dueDate,
        startDate: patch.startDate,
        status: patch.status,
        assignedTo: patch.assignedTo !== undefined ? patch.assignedTo : task.assigned_to,
        teamId: patch.teamId !== undefined ? patch.teamId : (task.team_id ?? null),
        progress: patch.progress,
        workNotes: patch.workNotes,
      },
      {
        title: task.title,
        description: task.description,
        originalInstructions: task.original_instructions ?? "",
        expectedOutput: task.expected_output ?? "",
        requiredDeliverables: task.required_deliverables ?? "",
        priority: task.priority,
        dueDate: task.due_date,
        startDate: task.start_date ?? null,
        teamId: task.team_id ?? null,
      },
    );
    if (!decision.ok) throw new AppError(decision.code);

    const update: {
      title?: string;
      description?: string;
      original_instructions?: string;
      expected_output?: string;
      required_deliverables?: string;
      status?: typeof task.status;
      priority?: typeof task.priority;
      assigned_to?: string | null;
      team_id?: string | null;
      due_date?: string | null;
      start_date?: string | null;
      progress?: number;
      work_notes?: string;
    } = {};
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.originalInstructions !== undefined) update.original_instructions = patch.originalInstructions;
    if (patch.expectedOutput !== undefined) update.expected_output = patch.expectedOutput;
    if (patch.requiredDeliverables !== undefined) update.required_deliverables = patch.requiredDeliverables;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.priority !== undefined) update.priority = patch.priority;
    if (patch.assignedTo !== undefined) update.assigned_to = patch.assignedTo;
    if (patch.teamId !== undefined) update.team_id = patch.teamId;
    if (patch.dueDate !== undefined) update.due_date = patch.dueDate;
    if (patch.startDate !== undefined) update.start_date = patch.startDate;
    if (patch.progress !== undefined) update.progress = patch.progress;
    if (patch.workNotes !== undefined) update.work_notes = patch.workNotes;

    const updated = unwrap(await firebase.from("tasks").update(update).eq("id", id).select("id"));
    if (updated.length === 0) throw new AppError("TASK_EDIT_FORBIDDEN");

    revalidateTaskPaths(task.project_id, id);
    return null;
  });
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult<{ projectId: string }>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const firebase = await createFirebaseServerClient();
    const task = unwrapMaybe(await firebase.from("tasks").select("id, project_id").eq("id", id).maybeSingle());
    if (!task) throw new AppError("NOT_FOUND");

    await assertProjectPermission(task.project_id, "tasks.delete");

    const deleted = unwrap(await firebase.from("tasks").delete().eq("id", id).select("id"));
    if (deleted.length === 0) throw new AppError("PERMISSION_DENIED");

    revalidateTaskPaths(task.project_id);
    return { projectId: task.project_id };
  });
}
