"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { getAppTimeZone } from "@/lib/env.server";
import { AppError } from "@/lib/errors";
import {
  canExecuteTask,
  canReviewTask,
  canSubmitTask,
  canSuperviseTasks,
  evaluateTaskCreate,
  evaluateTaskUpdate,
  type TaskSnapshot,
} from "@/lib/permissions/policy";
import { zonedLocalToIso } from "@/lib/schedule";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidField } from "@/lib/validation/common";
import {
  completeTaskSchema,
  dependencySchema,
  reviewTaskSchema,
  submitTaskSchema,
  taskFormSchema,
  taskProgressSchema,
  taskStatusSchema,
  type TaskFormValues,
} from "@/lib/validation/task";
import { assertProjectAccess, assertProjectPermission } from "@/server/access";
import { parseInput, runAction, unwrap, unwrapMaybe } from "@/server/action";

function revalidateTaskPaths(projectId: string, taskId?: string) {
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/schedule");
  revalidatePath("/results");
  revalidatePath("/reports");
  revalidatePath(`/projects/${projectId}`, "layout");
  if (taskId) revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}

/** Wall-clock form values (application time zone) → instants stored by the database. */
function toSchedule(values: TaskFormValues) {
  const timeZone = getAppTimeZone();
  const start = values.plannedStart ? zonedLocalToIso(values.plannedStart, timeZone) : null;
  const due = values.dueOverride && values.dueAt ? zonedLocalToIso(values.dueAt, timeZone) : null;
  if ((values.plannedStart && !start) || (values.dueOverride && values.dueAt && !due)) {
    throw new AppError("VALIDATION_ERROR", { fieldErrors: { plannedStart: "validation.invalidDate" } });
  }
  return {
    planning_month: values.planningMonth,
    planning_week: values.planningWeek,
    planned_start_at: start,
    planned_duration: values.plannedDuration,
    duration_unit: values.plannedDuration === null ? null : values.durationUnit,
    // Without an override the database calculates the deadline (start + duration).
    due_at: values.dueOverride ? due : null,
    due_at_overridden: values.dueOverride,
  };
}

const sameInstant = (a: string | null, b: string | null) =>
  a === b || (!!a && !!b && new Date(a).getTime() === new Date(b).getTime());

const TASK_SNAPSHOT_FIELDS = "id, project_id, task_code, created_by, assigned_to, status";

async function loadTaskSnapshot(taskId: string) {
  const supabase = await createSupabaseServerClient();
  // RLS: a task the user cannot see does not exist for them (no IDOR).
  const task = unwrapMaybe(await supabase.from("tasks").select(TASK_SNAPSHOT_FIELDS).eq("id", taskId).maybeSingle());
  if (!task) throw new AppError("NOT_FOUND");
  const snapshot: TaskSnapshot = { createdBy: task.created_by, assignedTo: task.assigned_to, status: task.status };
  return { supabase, task, snapshot };
}

// -----------------------------------------------------------------------------
// Definition (supervisors)
// -----------------------------------------------------------------------------
export async function createTaskAction(
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ taskId: string; code: string }>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const values = parseInput(taskFormSchema, input);
    const access = await assertProjectPermission(id, "tasks.create");

    const schedule = toSchedule(values);
    const planned =
      !!values.taskCode ||
      values.planningMonth !== 1 ||
      values.planningWeek !== null ||
      schedule.planned_start_at !== null ||
      schedule.planned_duration !== null ||
      schedule.due_at !== null;
    const responsibleMemberId = values.assignedTo ? null : values.responsibleMemberId;
    const decision = evaluateTaskCreate(access, { assignedTo: values.assignedTo, planned, responsibleMemberId });
    if (!decision.ok) throw new AppError(decision.code);

    const supabase = await createSupabaseServerClient();
    const task = unwrap(
      await supabase
        .from("tasks")
        .insert({
          project_id: id,
          task_code: values.taskCode ?? "",
          title: values.title,
          description: values.description,
          original_instructions: values.originalInstructions,
          expected_output: values.expectedOutput,
          completion_criteria: values.completionCriteria,
          priority: values.priority,
          assigned_to: values.assignedTo,
          responsible_member_id: responsibleMemberId,
          ...schedule,
        })
        .select("id, task_code")
        .single(),
    );

    revalidateTaskPaths(id);
    return { taskId: task.id, code: task.task_code };
  });
}

export async function updateTaskAction(taskId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const values = parseInput(taskFormSchema, input);
    const supabase = await createSupabaseServerClient();

    const current = unwrapMaybe(
      await supabase
        .from("tasks")
        .select(
          `${TASK_SNAPSHOT_FIELDS}, title, description, original_instructions, expected_output, completion_criteria, priority,
           planning_month, planning_week, planned_start_at, planned_duration, duration_unit, due_at, due_at_overridden,
           responsible_member_id`,
        )
        .eq("id", id)
        .maybeSingle(),
    );
    if (!current) throw new AppError("NOT_FOUND");
    const access = await assertProjectAccess(current.project_id);

    const content = {
      title: values.title,
      description: values.description,
      original_instructions: values.originalInstructions,
      expected_output: values.expectedOutput,
      completion_criteria: values.completionCriteria,
      priority: values.priority,
    };
    const contentChanged = (Object.keys(content) as (keyof typeof content)[]).some(
      (key) => content[key] !== current[key],
    );

    const schedule = toSchedule(values);
    const scheduleChanged =
      schedule.planning_month !== current.planning_month ||
      schedule.planning_week !== current.planning_week ||
      !sameInstant(schedule.planned_start_at, current.planned_start_at) ||
      (schedule.planned_duration ?? null) !==
        (current.planned_duration === null ? null : Number(current.planned_duration)) ||
      schedule.duration_unit !== current.duration_unit ||
      schedule.due_at_overridden !== current.due_at_overridden ||
      (schedule.due_at_overridden && !sameInstant(schedule.due_at, current.due_at));
    // Choosing a roster member without an account plans the task for them.
    const responsibleMemberId = values.assignedTo ? null : values.responsibleMemberId;
    const assigneeChanged =
      values.assignedTo !== current.assigned_to ||
      (!values.assignedTo && responsibleMemberId !== current.responsible_member_id);

    const snapshot: TaskSnapshot = {
      createdBy: current.created_by,
      assignedTo: current.assigned_to,
      status: current.status,
    };
    const decision = evaluateTaskUpdate(access, snapshot, {
      content: contentChanged,
      schedule: scheduleChanged,
      assignedTo: assigneeChanged ? values.assignedTo : undefined,
    });
    if (!decision.ok) throw new AppError(decision.code);
    if (!contentChanged && !scheduleChanged && !assigneeChanged) return null;

    // Only the changed field groups are sent, so each is checked against its own rule.
    const update = {
      ...(contentChanged ? content : {}),
      ...(scheduleChanged ? schedule : {}),
      ...(assigneeChanged
        ? responsibleMemberId
          ? { responsible_member_id: responsibleMemberId }
          : values.assignedTo
            ? { assigned_to: values.assignedTo }
            : { assigned_to: null, responsible_member_id: null }
        : {}),
    };
    const updated = unwrap(await supabase.from("tasks").update(update).eq("id", id).select("id"));
    if (updated.length === 0) throw new AppError("TASK_EDIT_FORBIDDEN");

    revalidateTaskPaths(current.project_id, id);
    return null;
  });
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult<{ projectId: string }>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const { supabase, task } = await loadTaskSnapshot(id);
    await assertProjectPermission(task.project_id, "tasks.delete");

    const deleted = unwrap(await supabase.from("tasks").delete().eq("id", id).select("id"));
    if (deleted.length === 0) throw new AppError("PERMISSION_DENIED");

    revalidateTaskPaths(task.project_id);
    return { projectId: task.project_id };
  });
}

// -----------------------------------------------------------------------------
// Execution
// -----------------------------------------------------------------------------

/** Start / resume (responsible member or supervisor), block, unblock, cancel, re-open (supervisors). */
export async function changeTaskStatusAction(taskId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const { status } = parseInput(taskStatusSchema, input);
    const { supabase, task, snapshot } = await loadTaskSnapshot(id);
    const access = await assertProjectAccess(task.project_id);

    const decision = evaluateTaskUpdate(access, snapshot, { status });
    if (!decision.ok) throw new AppError(decision.code);

    const updated = unwrap(await supabase.from("tasks").update({ status }).eq("id", id).select("id"));
    if (updated.length === 0) throw new AppError("TASK_EDIT_FORBIDDEN");

    revalidateTaskPaths(task.project_id, id);
    return null;
  });
}

export async function updateTaskProgressAction(taskId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const values = parseInput(taskProgressSchema, input);
    const { supabase, task, snapshot } = await loadTaskSnapshot(id);
    const access = await assertProjectAccess(task.project_id);

    const decision = evaluateTaskUpdate(access, snapshot, { progress: true });
    if (!decision.ok) throw new AppError(decision.code);

    const updated = unwrap(
      await supabase
        .from("tasks")
        .update({ progress: values.progress, work_notes: values.workNotes })
        .eq("id", id)
        .select("id"),
    );
    if (updated.length === 0) throw new AppError("TASK_EDIT_FORBIDDEN");

    revalidateTaskPaths(task.project_id, id);
    return null;
  });
}

// -----------------------------------------------------------------------------
// Workflow (database functions decide; these only add friendly early errors)
// -----------------------------------------------------------------------------
export async function submitTaskAction(taskId: string, input: unknown): Promise<ActionResult<{ version: number }>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const values = parseInput(submitTaskSchema, input);
    const { supabase, task, snapshot } = await loadTaskSnapshot(id);
    const access = await assertProjectAccess(task.project_id);
    if (!canExecuteTask(access, snapshot)) throw new AppError("TASK_EDIT_FORBIDDEN");
    if (!canSubmitTask(access, snapshot)) throw new AppError("TASK_STATUS_FORBIDDEN");

    const submissionId = unwrap(
      await supabase.rpc("submit_task", {
        p_task_id: id,
        p_summary: values.summary,
        p_deliverable_links: values.links,
        p_notes: values.notes,
      }),
    );
    const submission = unwrap(
      await supabase.from("task_submissions").select("version").eq("id", submissionId).single(),
    );

    revalidateTaskPaths(task.project_id, id);
    revalidatePath("/notifications");
    return { version: submission.version };
  });
}

async function assertReviewer(taskId: string) {
  const loaded = await loadTaskSnapshot(taskId);
  const access = await assertProjectAccess(loaded.task.project_id);
  if (!canReviewTask(access, loaded.snapshot)) {
    throw new AppError(loaded.snapshot.assignedTo === access.userId ? "SELF_REVIEW_FORBIDDEN" : "PERMISSION_DENIED");
  }
  return loaded;
}

export async function startTaskReviewAction(taskId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const { supabase, task } = await assertReviewer(id);
    unwrap(await supabase.rpc("start_task_review", { p_task_id: id }));
    revalidateTaskPaths(task.project_id, id);
    return null;
  });
}

export async function reviewTaskAction(taskId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const values = parseInput(reviewTaskSchema, input);
    const { supabase, task } = await assertReviewer(id);

    const newDueAt = values.newDueAt ? zonedLocalToIso(values.newDueAt, getAppTimeZone()) : null;
    unwrap(
      await supabase.rpc("review_task", {
        p_task_id: id,
        p_decision: values.decision,
        p_comment: values.comment,
        p_required_changes: values.requiredChanges,
        p_additional_instructions: values.additionalInstructions,
        p_new_due_at: newDueAt ?? undefined,
      }),
    );

    revalidateTaskPaths(task.project_id, id);
    revalidatePath("/notifications");
    return null;
  });
}

/** MARK AS COMPLETED: publishes the approved final result to the team. */
export async function completeTaskAction(taskId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const values = parseInput(completeTaskSchema, input);
    const { supabase, task } = await assertReviewer(id);

    unwrap(await supabase.rpc("complete_task", { p_task_id: id, p_team_comment: values.teamComment }));

    revalidateTaskPaths(task.project_id, id);
    revalidatePath("/notifications");
    return null;
  });
}

// -----------------------------------------------------------------------------
// Dependencies (supervisors)
// -----------------------------------------------------------------------------
export async function addTaskDependencyAction(taskId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const { dependsOn } = parseInput(dependencySchema, input);
    const { supabase, task } = await loadTaskSnapshot(id);
    const access = await assertProjectAccess(task.project_id);
    if (!canSuperviseTasks(access)) throw new AppError("PERMISSION_DENIED");

    unwrap(
      await supabase
        .from("task_dependencies")
        .insert({ task_id: id, depends_on_task_id: dependsOn, project_id: task.project_id })
        .select("task_id"),
    );
    revalidateTaskPaths(task.project_id, id);
    return null;
  });
}

export async function removeTaskDependencyAction(taskId: string, dependsOnId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, taskId);
    const dependsOn = parseInput(uuidField, dependsOnId);
    const { supabase, task } = await loadTaskSnapshot(id);
    const access = await assertProjectAccess(task.project_id);
    if (!canSuperviseTasks(access)) throw new AppError("PERMISSION_DENIED");

    const deleted = unwrap(
      await supabase
        .from("task_dependencies")
        .delete()
        .eq("task_id", id)
        .eq("depends_on_task_id", dependsOn)
        .select("task_id"),
    );
    if (deleted.length === 0) throw new AppError("PERMISSION_DENIED");
    revalidateTaskPaths(task.project_id, id);
    return null;
  });
}
