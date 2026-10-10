/**
 * Pure authorization rules shared by Server Actions (friendly, early errors)
 * and the UI (hiding actions the user cannot perform).
 *
 * They mirror the database rules — RLS policies, the tasks_before_update
 * trigger and the membership RPCs — which remain the source of truth: a check
 * passing here never bypasses the database, it only avoids a round trip that
 * would be rejected anyway.
 */
import {
  FINAL_TASK_STATUSES,
  PERMISSION_KEYS,
  ROLE_RANK,
  type MemberStatus,
  type PermissionKey,
  type ProjectRole,
  type TaskStatus,
} from "@/lib/permissions/catalog";

/** The caller's effective access inside one project (as returned by get_my_project_access). */
export type AccessSubject = {
  userId: string;
  role: ProjectRole;
  status: MemberStatus;
  /** Effective permissions (owners: all; inactive members or no project.view: none). */
  permissions: ReadonlySet<PermissionKey>;
  /** Organization Director (may review their own work; holds every permission everywhere). */
  isDirector?: boolean;
};

export type PolicyResult = { ok: true } | { ok: false; code: PolicyErrorCode };

export type PolicyErrorCode =
  | "PERMISSION_DENIED"
  | "TASK_EDIT_FORBIDDEN"
  | "TASK_STATUS_FORBIDDEN"
  | "TASK_ASSIGN_FORBIDDEN"
  | "SELF_REVIEW_FORBIDDEN"
  | "ROLE_NOT_ALLOWED"
  | "CANNOT_MODIFY_OWNER"
  | "CANNOT_MODIFY_SELF"
  | "INSUFFICIENT_RANK"
  | "PERMISSION_ESCALATION";

const OK: PolicyResult = { ok: true };
const deny = (code: PolicyErrorCode): PolicyResult => ({ ok: false, code });

export function isActive(access: AccessSubject | null | undefined): access is AccessSubject {
  return !!access && access.status === "active" && access.permissions.has("project.view");
}

export function can(access: AccessSubject | null | undefined, permission: PermissionKey): boolean {
  return !!access && access.status === "active" && access.permissions.has(permission);
}

export function canAny(access: AccessSubject | null | undefined, permissions: readonly PermissionKey[]): boolean {
  return permissions.some((permission) => can(access, permission));
}

// -----------------------------------------------------------------------------
// Tasks — mirrors private.tasks_before_insert / tasks_before_update,
// private.task_transition_allowed and the workflow functions.
// -----------------------------------------------------------------------------
export type TaskSnapshot = {
  createdBy: string | null;
  assignedTo: string | null;
  status: TaskStatus;
};

/** Supervisor: plans, schedules, edits, cancels (tasks.edit). Directors and Team Leads hold it. */
export function canSuperviseTasks(access: AccessSubject | null | undefined): boolean {
  return can(access, "tasks.edit");
}

/** Title, description, instructions, expected output, completion criteria, priority. */
export function canEditTaskContent(access: AccessSubject | null | undefined, task: TaskSnapshot): boolean {
  if (!access || task.status === "completed") return false;
  return canSuperviseTasks(access) || (can(access, "tasks.edit_own") && task.createdBy === access.userId);
}

/** Planning month/week, start, duration and deadline: supervisors only. */
export function canEditTaskSchedule(access: AccessSubject | null | undefined, task: TaskSnapshot): boolean {
  return task.status !== "completed" && canSuperviseTasks(access);
}

/** The responsible member executing their task (start, progress, notes, submit). */
export function canExecuteTask(access: AccessSubject | null | undefined, task: TaskSnapshot): boolean {
  return !!access && task.assignedTo === access.userId && can(access, "tasks.edit_assigned");
}

export function canUpdateTaskProgress(access: AccessSubject | null | undefined, task: TaskSnapshot): boolean {
  return task.status !== "completed" && (canExecuteTask(access, task) || canSuperviseTasks(access));
}

/** Review, approve, request revisions and publish. Only a project owner/manager or Director may review their own task. */
export function canReviewTask(access: AccessSubject | null | undefined, task: TaskSnapshot): boolean {
  if (!access || !can(access, "tasks.review")) return false;
  return (
    task.assignedTo !== access.userId ||
    access.isDirector === true ||
    access.role === "owner" ||
    access.role === "manager"
  );
}

/** Status changes allowed through a direct update (SQL: private.task_transition_allowed). */
export function isDirectTransitionAllowed(
  from: TaskStatus,
  to: TaskStatus,
  isSupervisor: boolean,
  isExecutor: boolean,
): boolean {
  if (from === to) return true;
  switch (to) {
    case "in_progress":
      return (
        (["not_started", "scheduled", "revision_required"].includes(from) && (isSupervisor || isExecutor)) ||
        (from === "blocked" && isSupervisor)
      );
    case "blocked":
      return ["not_started", "scheduled", "in_progress"].includes(from) && isSupervisor;
    case "not_started":
    case "scheduled":
      return ["blocked", "cancelled", "not_started", "scheduled"].includes(from) && isSupervisor;
    case "cancelled":
      return !FINAL_TASK_STATUSES.includes(from) && isSupervisor;
    default:
      return false;
  }
}

export function canChangeTaskStatus(
  access: AccessSubject | null | undefined,
  task: TaskSnapshot,
  next: TaskStatus,
): boolean {
  if (!access || !isActive(access)) return false;
  return isDirectTransitionAllowed(task.status, next, canSuperviseTasks(access), canExecuteTask(access, task));
}

export function canSubmitTask(access: AccessSubject | null | undefined, task: TaskSnapshot): boolean {
  return canExecuteTask(access, task) && (task.status === "in_progress" || task.status === "revision_required");
}

export function canAssignTasks(access: AccessSubject | null | undefined): boolean {
  return can(access, "tasks.assign");
}

export function canDeleteTasks(access: AccessSubject | null | undefined): boolean {
  return can(access, "tasks.delete");
}

/** Whether the task definition form can be opened at all. */
export function canUpdateTask(access: AccessSubject | null | undefined, task: TaskSnapshot): boolean {
  return (
    canEditTaskContent(access, task) ||
    canEditTaskSchedule(access, task) ||
    (canAssignTasks(access) && task.status !== "completed")
  );
}

export type TaskPatch = Partial<{
  content: boolean;
  schedule: boolean;
  progress: boolean;
  status: TaskStatus;
  assignedTo: string | null;
}>;

/** Field-group evaluation of a direct update, identical to the tasks_before_update trigger. */
export function evaluateTaskUpdate(
  access: AccessSubject | null | undefined,
  task: TaskSnapshot,
  patch: TaskPatch,
): PolicyResult {
  if (!access || !isActive(access)) return deny("PERMISSION_DENIED");
  if (patch.content && !canEditTaskContent(access, task)) return deny("TASK_EDIT_FORBIDDEN");
  if (patch.schedule && !canEditTaskSchedule(access, task)) return deny("TASK_EDIT_FORBIDDEN");
  if (patch.progress && !canUpdateTaskProgress(access, task)) return deny("TASK_EDIT_FORBIDDEN");
  if (patch.status !== undefined && patch.status !== task.status && !canChangeTaskStatus(access, task, patch.status)) {
    return deny("TASK_STATUS_FORBIDDEN");
  }
  if (patch.assignedTo !== undefined && patch.assignedTo !== task.assignedTo && !canAssignTasks(access)) {
    return deny("TASK_ASSIGN_FORBIDDEN");
  }
  return OK;
}

/** Creating a task: tasks.create; others' assignment needs tasks.assign; plan, schedule and manual IDs need tasks.edit. */
export function evaluateTaskCreate(
  access: AccessSubject | null | undefined,
  input: { assignedTo: string | null; planned: boolean; responsibleMemberId?: string | null },
): PolicyResult {
  if (!can(access, "tasks.create") || !access) return deny("PERMISSION_DENIED");
  if (input.responsibleMemberId && !canAssignTasks(access)) return deny("TASK_ASSIGN_FORBIDDEN");
  if (input.assignedTo && input.assignedTo !== access.userId && !canAssignTasks(access)) {
    return deny("TASK_ASSIGN_FORBIDDEN");
  }
  if (input.planned && !canSuperviseTasks(access)) return deny("TASK_EDIT_FORBIDDEN");
  return OK;
}

// -----------------------------------------------------------------------------
// Members and permissions
// -----------------------------------------------------------------------------
export type MemberSnapshot = { userId: string; role: ProjectRole };

/** Owners outrank everybody; otherwise a strictly higher rank is required. */
export function outranks(actorRole: ProjectRole, targetRole: ProjectRole): boolean {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}

function evaluateMemberAction(
  actor: AccessSubject | null | undefined,
  target: MemberSnapshot,
  permission: PermissionKey,
): PolicyResult {
  if (!actor || !can(actor, permission)) return deny("PERMISSION_DENIED");
  if (target.role === "owner") return deny("CANNOT_MODIFY_OWNER");
  if (target.userId === actor.userId) return deny("CANNOT_MODIFY_SELF");
  if (!outranks(actor.role, target.role)) return deny("INSUFFICIENT_RANK");
  return OK;
}

export function evaluateMemberManage(actor: AccessSubject | null | undefined, target: MemberSnapshot) {
  return evaluateMemberAction(actor, target, "members.manage");
}

export function evaluateMemberRemove(actor: AccessSubject | null | undefined, target: MemberSnapshot) {
  return evaluateMemberAction(actor, target, "members.remove");
}

/** Roles the actor may hand out when adding a member or changing a role. */
export function assignableRoles(actor: AccessSubject | null | undefined): ProjectRole[] {
  if (!actor) return [];
  const candidates: ProjectRole[] = ["manager", "member", "reviewer"];
  if (actor.role === "owner") return candidates;
  return candidates.filter((role) => ROLE_RANK[role] < ROLE_RANK[actor.role]);
}

export function evaluateRoleChange(
  actor: AccessSubject | null | undefined,
  target: MemberSnapshot,
  nextRole: ProjectRole,
): PolicyResult {
  const base = evaluateMemberManage(actor, target);
  if (!base.ok) return base;
  if (!assignableRoles(actor).includes(nextRole)) return deny("ROLE_NOT_ALLOWED");
  return OK;
}

export function evaluateMemberAdd(actor: AccessSubject | null | undefined, role: ProjectRole): PolicyResult {
  if (!can(actor, "members.add")) return deny("PERMISSION_DENIED");
  if (!assignableRoles(actor).includes(role)) return deny("ROLE_NOT_ALLOWED");
  return OK;
}

/** Permissions the actor may toggle on others: owners all, others only their own. */
export function editablePermissionKeys(actor: AccessSubject | null | undefined): Set<PermissionKey> {
  if (!actor || !isActive(actor)) return new Set();
  if (actor.role === "owner") return new Set(PERMISSION_KEYS);
  return new Set(actor.permissions);
}

export function evaluatePermissionChange(
  actor: AccessSubject | null | undefined,
  target: MemberSnapshot,
  current: ReadonlySet<PermissionKey>,
  desired: ReadonlySet<PermissionKey>,
): PolicyResult {
  if (!actor || !can(actor, "permissions.manage")) return deny("PERMISSION_DENIED");
  if (target.role === "owner") return deny("CANNOT_MODIFY_OWNER");
  if (target.userId === actor.userId) return deny("CANNOT_MODIFY_SELF");
  if (!outranks(actor.role, target.role)) return deny("INSUFFICIENT_RANK");

  if (actor.role !== "owner") {
    const editable = editablePermissionKeys(actor);
    for (const key of PERMISSION_KEYS) {
      if (current.has(key) !== desired.has(key) && !editable.has(key)) {
        return deny("PERMISSION_ESCALATION");
      }
    }
  }
  return OK;
}

// -----------------------------------------------------------------------------
// Comments
// -----------------------------------------------------------------------------
export function canEditComment(access: AccessSubject | null | undefined, authorId: string | null): boolean {
  return !!access && authorId === access.userId && can(access, "comments.create");
}

export function canDeleteComment(access: AccessSubject | null | undefined, authorId: string | null): boolean {
  if (!access) return false;
  return can(access, "comments.delete") || (authorId === access.userId && isActive(access));
}
