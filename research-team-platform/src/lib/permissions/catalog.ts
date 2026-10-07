import type { Database } from "@/types/database.types";

/**
 * Permission catalog — mirrors supabase/migrations/*_permission_catalog.sql.
 * A unit test parses the migration and fails if the two lists diverge.
 */
export const PERMISSION_KEYS = [
  "project.view",
  "project.edit",
  "project.delete",
  "tasks.view",
  "tasks.create",
  "tasks.edit",
  "tasks.edit_own",
  "tasks.edit_assigned",
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
  "tasks.edit_own": "tasks",
  "tasks.edit_assigned": "tasks",
  "tasks.assign": "tasks",
  "tasks.review": "tasks",
  "tasks.delete": "tasks",
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

export type ProjectRole = Database["public"]["Enums"]["project_role"];
export type MemberStatus = Database["public"]["Enums"]["member_status"];
export type TaskStatus = Database["public"]["Enums"]["task_status"];
export type TaskPriority = Database["public"]["Enums"]["task_priority"];
export type ProjectStatus = Database["public"]["Enums"]["project_status"];

export const PROJECT_ROLES = ["owner", "manager", "member", "reviewer"] as const satisfies readonly ProjectRole[];
export const MEMBER_STATUSES = ["active", "suspended"] as const satisfies readonly MemberStatus[];
export type DurationUnit = Database["public"]["Enums"]["duration_unit"];
export type TaskVisibility = Database["public"]["Enums"]["task_visibility"];
export type SubmissionStatus = Database["public"]["Enums"]["submission_status"];
export type ReviewDecision = Database["public"]["Enums"]["review_decision"];
export type TeamRole = Database["public"]["Enums"]["team_role"];
export type TeamMemberStatus = Database["public"]["Enums"]["team_member_status"];

/** Execution lifecycle, in workflow order. Mirrors public.task_status. */
export const TASK_STATUSES = [
  "not_started",
  "scheduled",
  "in_progress",
  "blocked",
  "submitted",
  "under_review",
  "revision_required",
  "approved",
  "completed",
  "cancelled",
] as const satisfies readonly TaskStatus[];
/** P0 (critical) … P3 (low). */
export const TASK_PRIORITIES = ["p0", "p1", "p2", "p3"] as const satisfies readonly TaskPriority[];
export const DURATION_UNITS = ["hours", "days", "weeks"] as const satisfies readonly DurationUnit[];
export const TEAM_ROLES = ["team_lead", "team_member"] as const satisfies readonly TeamRole[];
export const TEAM_MEMBER_STATUSES = ["pending", "active", "inactive"] as const satisfies readonly TeamMemberStatus[];

/** Computed by public.schedule_status() with the database clock. */
export const SCHEDULE_STATUSES = [
  "unscheduled",
  "not_started",
  "scheduled",
  "active",
  "due_soon",
  "overdue",
  "completed",
  "cancelled",
] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

/** Work that is not finished yet. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  "not_started",
  "scheduled",
  "in_progress",
  "blocked",
  "submitted",
  "under_review",
  "revision_required",
  "approved",
];
/** Waiting for a reviewer. */
export const REVIEW_QUEUE_STATUSES: readonly TaskStatus[] = ["submitted", "under_review"];

/** Permissions of a Team Lead in the projects of their team. Mirrors private.team_lead_permissions(). */
export const TEAM_LEAD_PERMISSIONS: readonly PermissionKey[] = [
  "project.view",
  "tasks.view",
  "tasks.create",
  "tasks.edit",
  "tasks.edit_own",
  "tasks.edit_assigned",
  "tasks.assign",
  "tasks.review",
  "tasks.delete",
  "documents.view",
  "documents.upload",
  "documents.edit",
  "comments.create",
  "comments.delete",
  "team.view",
  "activity.view",
  "data.export",
];
export const PROJECT_STATUSES = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "archived",
] as const satisfies readonly ProjectStatus[];

/** Closed workflow states. */
export const FINAL_TASK_STATUSES: readonly TaskStatus[] = ["completed", "cancelled"];

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
    "tasks.edit_own",
    "tasks.edit_assigned",
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
  member: ["project.view", "tasks.edit_assigned", "documents.view", "documents.upload", "comments.create", "team.view"],
  reviewer: ["project.view", "tasks.view", "tasks.review", "documents.view", "comments.create", "team.view"],
};

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);
}

export function sortPermissionKeys(keys: Iterable<PermissionKey>): PermissionKey[] {
  const set = new Set(keys);
  return PERMISSION_KEYS.filter((key) => set.has(key));
}
