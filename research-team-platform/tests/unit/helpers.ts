import { PERMISSION_KEYS, ROLE_TEMPLATES, type PermissionKey, type ProjectRole } from "@/lib/permissions/catalog";
import type { AccessSubject } from "@/lib/permissions/policy";

export const OWNER = "00000000-0000-4000-8000-000000000001";
export const MANAGER = "00000000-0000-4000-8000-000000000002";
export const MEMBER = "00000000-0000-4000-8000-000000000003";
export const OTHER = "00000000-0000-4000-8000-000000000004";
export const REVIEWER = "00000000-0000-4000-8000-000000000005";

/** Effective access exactly as get_my_project_access() returns it. */
export function accessFor(
  role: ProjectRole,
  options: { userId?: string; permissions?: readonly PermissionKey[]; status?: "active" | "suspended" } = {},
): AccessSubject {
  const status = options.status ?? "active";
  const granted = role === "owner" ? PERMISSION_KEYS : (options.permissions ?? ROLE_TEMPLATES[role]);
  // Inactive members, or members without the project.view gate, have no effective permission.
  const effective = status !== "active" || !granted.includes("project.view") ? [] : granted;
  return {
    userId: options.userId ?? { owner: OWNER, manager: MANAGER, member: MEMBER, reviewer: REVIEWER }[role],
    role,
    status,
    permissions: new Set(effective),
  };
}
