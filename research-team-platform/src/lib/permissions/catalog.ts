/**
 * Permission catalog — shared by Firestore authorization, UI policy, and
 * Firebase Security Rules. Emulator tests verify rule parity for core cases.
 */
export const PERMISSION_KEYS = [
  "project.view",
  "project.edit",
  "project.delete",
  "tasks.view",
  "tasks.create",
  "tasks.edit",
  "tasks.assign",
  "tasks.review",
  "tasks.delete",
  "tasks.update_progress",
  "tasks.add_work_notes",
  "tasks.submit",
  "tasks.accept",
  "documents.view",
  "documents.upload",
  "documents.edit",
  "documents.delete",
  "comments.create",
  "comments.delete",
  "team.view",
  "members.add",
  "members.remove",
  "members.manage",
  "permissions.manage",
  "activity.view",
  "data.export",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_CATEGORIES = ["project", "tasks", "documents", "comments", "team", "administration"] as const;
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

export const PERMISSION_CATEGORY: Record<PermissionKey, PermissionCategory> = {
  "project.view": "project",
  "project.edit": "project",
  "project.delete": "project",
  "tasks.view": "tasks",
  "tasks.create": "tasks",
  "tasks.edit": "tasks",
  "tasks.assign": "tasks",
  "tasks.review": "tasks",
  "tasks.delete": "tasks",
  "tasks.update_progress": "tasks",
  "tasks.add_work_notes": "tasks",
  "tasks.submit": "tasks",
  "tasks.accept": "tasks",
  "documents.view": "documents",
  "documents.upload": "documents",
  "documents.edit": "documents",
  "documents.delete": "documents",
  "comments.create": "comments",
  "comments.delete": "comments",
  "team.view": "team",
  "members.add": "team",
  "members.remove": "team",
  "members.manage": "team",
  "permissions.manage": "team",
  "activity.view": "administration",
  "data.export": "administration",
};

export type ProjectRole = "owner" | "manager" | "member" | "reviewer";
export type MemberStatus = "active" | "suspended";
export type TaskStatus =
  | "assigned"
  | "accepted"
  | "in_progress"
  | "submitted"
  | "under_review"
  | "revision_required"
  | "approved"
  | "completed"
  | "cancelled";
export type LegacyTaskStatus = "todo" | "review" | "rejected";
export type TaskPriority = "low" | "medium" | "high" | "urgent" | "critical";
export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "archived";

export const PROJECT_ROLES = ["owner", "manager", "member", "reviewer"] as const satisfies readonly ProjectRole[];
export const MEMBER_STATUSES = ["active", "suspended"] as const satisfies readonly MemberStatus[];
export const TASK_STATUSES = [
  "assigned",
  "accepted",
  "in_progress",
  "submitted",
  "under_review",
  "revision_required",
  "approved",
  "completed",
  "cancelled",
] as const satisfies readonly TaskStatus[];

/** Normalize the previous Firebase/Supabase vocabulary at read/import boundaries. */
export function normalizeTaskStatus(value: unknown): TaskStatus | null {
  if (TASK_STATUSES.includes(value as TaskStatus)) return value as TaskStatus;
  if (value === "todo") return "assigned";
  if (value === "review") return "under_review";
  if (value === "rejected") return "cancelled";
  return null;
}
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const satisfies readonly TaskPriority[];
export const PROJECT_STATUSES = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "archived",
] as const satisfies readonly ProjectStatus[];

/** Final workflow states: entering or leaving them requires review rights. */
export const FINAL_TASK_STATUSES: readonly TaskStatus[] = ["approved", "completed", "cancelled"];

/** Higher rank can manage lower rank. Mirrors private.role_rank(). */
export const ROLE_RANK: Record<ProjectRole, number> = {
  owner: 100,
  manager: 50,
  reviewer: 10,
  member: 10,
};

/** Default permission templates. Mirrors public.role_permissions. */
export const ROLE_TEMPLATES: Record<ProjectRole, readonly PermissionKey[]> = {
  owner: PERMISSION_KEYS,
  manager: [
    "project.view",
    "project.edit",
    "tasks.view",
    "tasks.create",
    "tasks.edit",
    "tasks.assign",
    "tasks.review",
    "tasks.delete",
    "documents.view",
    "documents.upload",
    "documents.edit",
    "documents.delete",
    "comments.create",
    "comments.delete",
    "team.view",
    "members.add",
    "members.remove",
    "members.manage",
    "data.export",
  ],
  member: [
    "project.view",
    "team.view",
    "tasks.update_progress",
    "tasks.add_work_notes",
    "tasks.submit",
    "tasks.accept",
    "documents.upload",
    "comments.create",
  ],
  reviewer: ["project.view", "tasks.review", "comments.create"],
};

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);
}

export function sortPermissionKeys(keys: Iterable<PermissionKey>): PermissionKey[] {
  const set = new Set(keys);
  return PERMISSION_KEYS.filter((key) => set.has(key));
}
