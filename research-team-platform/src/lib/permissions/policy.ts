/**
 * Pure authorization rules shared by Server Actions (friendly, early errors)
 * and the UI (hiding actions the user cannot perform).
 *
 * They mirror the Firebase Security Rules and the Admin-backed Firestore
 * authorization checks. These UI checks improve feedback; server authorization
 * remains mandatory for every mutation.
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

/** The caller's effective access inside one project, computed from Firebase membership documents. */
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
  teamId?: string | null;
  status: TaskStatus;
};

export type TaskPatch = Partial<{
  title: string;
  description: string;
  expectedOutput: string;
  requiredDeliverables: string;
  priority: string;
  dueDate: string | null;
  status: TaskStatus;
  assignedTo: string | null;
  teamId: string | null;
  progress: number;
  workNotes: string;
}>;

/** Title, description, priority and due date. */
export function canEditTaskContent(access: AccessSubject | null | undefined, _task: TaskSnapshot): boolean {
  if (!access) return false;
  return can(access, "tasks.edit");
}

export function canChangeTaskStatus(
  access: AccessSubject | null | undefined,
  task: TaskSnapshot,
  next: TaskStatus,
): boolean {
  if (!access) return false;
  if (next === task.status) return true;
  const assigned = task.assignedTo === access.userId;
  if (next === "accepted") return assigned && can(access, "tasks.submit") && task.status === "todo";
  if (next === "in_progress") {
    return (
      assigned &&
      can(access, "tasks.update_progress") &&
      ["todo", "accepted", "revision_required"].includes(task.status)
    );
  }
  // Submissions, review start, and reviewer decisions must pass through their
  // dedicated actions so immutable version/review records are always created.
  if (["submitted", "review", "revision_required", "approved", "completed", "rejected"].includes(next)) return false;
  if (next === "cancelled") return can(access, "tasks.edit") && task.status !== "completed";
  return can(access, "tasks.edit") && ["todo", "in_progress", "accepted"].includes(next);
}

export function allowedTaskStatuses(access: AccessSubject | null | undefined, task: TaskSnapshot): TaskStatus[] {
  const all: TaskStatus[] = [
    "todo",
    "accepted",
    "in_progress",
    "submitted",
    "review",
    "revision_required",
    "approved",
    "completed",
    "rejected",
    "cancelled",
  ];
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
    (task.assignedTo === access?.userId && (can(access, "tasks.update_progress") || can(access, "tasks.submit"))) ||
    allowedTaskStatuses(access, task).some((status) => status !== task.status)
  );
}

/** Field-level evaluation of an update, identical to the tasks_before_update trigger. */
export function evaluateTaskUpdate(
  access: AccessSubject | null | undefined,
  task: TaskSnapshot,
  patch: TaskPatch,
  current: {
    title: string;
    description: string;
    expectedOutput?: string;
    requiredDeliverables?: string;
    priority: string;
    dueDate: string | null;
  },
): PolicyResult {
  if (!access || !isActive(access)) return deny("PERMISSION_DENIED");

  const contentChanged =
    (patch.title !== undefined && patch.title !== current.title) ||
    (patch.description !== undefined && patch.description !== current.description) ||
    (patch.expectedOutput !== undefined && patch.expectedOutput !== (current.expectedOutput ?? "")) ||
    (patch.requiredDeliverables !== undefined && patch.requiredDeliverables !== (current.requiredDeliverables ?? "")) ||
    (patch.priority !== undefined && patch.priority !== current.priority) ||
    (patch.dueDate !== undefined && patch.dueDate !== current.dueDate);

  if (contentChanged && !canEditTaskContent(access, task)) return deny("TASK_EDIT_FORBIDDEN");
  if (patch.progress !== undefined && (task.assignedTo !== access.userId || !can(access, "tasks.update_progress"))) {
    return deny("TASK_EDIT_FORBIDDEN");
  }
  if (patch.workNotes !== undefined && (task.assignedTo !== access.userId || !can(access, "tasks.add_work_notes"))) {
    return deny("TASK_EDIT_FORBIDDEN");
  }
  if (patch.status !== undefined && patch.status !== task.status && !canChangeTaskStatus(access, task, patch.status)) {
    return deny("TASK_STATUS_FORBIDDEN");
  }

  if (patch.assignedTo !== undefined && patch.assignedTo !== task.assignedTo && !canAssignTasks(access)) {
    return deny("TASK_ASSIGN_FORBIDDEN");
  }
  if (patch.teamId !== undefined && patch.teamId !== (task.teamId ?? null) && !canAssignTasks(access)) {
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
  if (input.status !== "todo") return deny("TASK_STATUS_FORBIDDEN");
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
