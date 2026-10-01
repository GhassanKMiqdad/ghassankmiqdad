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
};

export type PolicyResult = { ok: true } | { ok: false; code: PolicyErrorCode };

export type PolicyErrorCode =
  | "PERMISSION_DENIED"
  | "TASK_EDIT_FORBIDDEN"
  | "TASK_STATUS_FORBIDDEN"
  | "TASK_ASSIGN_FORBIDDEN"
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
// Tasks
// -----------------------------------------------------------------------------
export type TaskSnapshot = {
  createdBy: string | null;
  assignedTo: string | null;
  status: TaskStatus;
};

export type TaskPatch = Partial<{
  title: string;
  description: string;
  priority: string;
  dueDate: string | null;
  status: TaskStatus;
  assignedTo: string | null;
}>;

/** Title, description, priority and due date. */
export function canEditTaskContent(access: AccessSubject | null | undefined, task: TaskSnapshot): boolean {
  if (!access) return false;
  return (
    can(access, "tasks.edit") ||
    (can(access, "tasks.edit_own") && task.createdBy === access.userId) ||
    (can(access, "tasks.edit_assigned") && task.assignedTo === access.userId)
  );
}

export function canChangeTaskStatus(
  access: AccessSubject | null | undefined,
  task: TaskSnapshot,
  next: TaskStatus,
): boolean {
  if (!access) return false;
  if (next === task.status) return true;
  if (can(access, "tasks.edit")) return true;
  if (can(access, "tasks.review") && (task.status === "review" || FINAL_TASK_STATUSES.includes(task.status))) {
    return true;
  }
  return (
    canEditTaskContent(access, task) &&
    !FINAL_TASK_STATUSES.includes(task.status) &&
    !FINAL_TASK_STATUSES.includes(next)
  );
}

export function allowedTaskStatuses(access: AccessSubject | null | undefined, task: TaskSnapshot): TaskStatus[] {
  const all: TaskStatus[] = ["todo", "in_progress", "review", "completed", "rejected"];
  return all.filter((status) => canChangeTaskStatus(access, task, status));
}

export function canAssignTasks(access: AccessSubject | null | undefined): boolean {
  return can(access, "tasks.assign");
}

export function canDeleteTasks(access: AccessSubject | null | undefined): boolean {
  return can(access, "tasks.delete");
}

/** Whether the task offers any editing path at all (used to show the edit form). */
export function canUpdateTask(access: AccessSubject | null | undefined, task: TaskSnapshot): boolean {
  return (
    canEditTaskContent(access, task) ||
    canAssignTasks(access) ||
    allowedTaskStatuses(access, task).some((status) => status !== task.status)
  );
}

/** Field-level evaluation of an update, identical to the tasks_before_update trigger. */
export function evaluateTaskUpdate(
  access: AccessSubject | null | undefined,
  task: TaskSnapshot,
  patch: TaskPatch,
  current: { title: string; description: string; priority: string; dueDate: string | null },
): PolicyResult {
  if (!access || !isActive(access)) return deny("PERMISSION_DENIED");

  const contentChanged =
    (patch.title !== undefined && patch.title !== current.title) ||
    (patch.description !== undefined && patch.description !== current.description) ||
    (patch.priority !== undefined && patch.priority !== current.priority) ||
    (patch.dueDate !== undefined && patch.dueDate !== current.dueDate);

  if (contentChanged && !canEditTaskContent(access, task)) return deny("TASK_EDIT_FORBIDDEN");

  if (patch.status !== undefined && patch.status !== task.status && !canChangeTaskStatus(access, task, patch.status)) {
    return deny("TASK_STATUS_FORBIDDEN");
  }

  if (patch.assignedTo !== undefined && patch.assignedTo !== task.assignedTo && !canAssignTasks(access)) {
    return deny("TASK_ASSIGN_FORBIDDEN");
  }

  return OK;
}

/** Creating a task: tasks.create, and assignment to others requires tasks.assign. */
export function evaluateTaskCreate(
  access: AccessSubject | null | undefined,
  input: { assignedTo: string | null; status: TaskStatus },
): PolicyResult {
  if (!can(access, "tasks.create") || !access) return deny("PERMISSION_DENIED");
  if (input.assignedTo && input.assignedTo !== access.userId && !canAssignTasks(access)) {
    return deny("TASK_ASSIGN_FORBIDDEN");
  }
  if (FINAL_TASK_STATUSES.includes(input.status) && !can(access, "tasks.edit")) {
    return deny("TASK_STATUS_FORBIDDEN");
  }
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
