import "server-only";

import { cache } from "react";

import { AppError } from "@/lib/errors";
import type { ProjectAccess } from "@/lib/permissions/access";
import {
  isPermissionKey,
  type MemberStatus,
  type PermissionKey,
  type ProjectRole,
  type ProjectStatus,
} from "@/lib/permissions/catalog";
import { can } from "@/lib/permissions/policy";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile, getSessionUser } from "@/server/auth";

export type { ProjectAccess };

type AccessRow = {
  project_id: string;
  project_name: string;
  project_status: ProjectStatus;
  role: ProjectRole;
  member_status: MemberStatus;
  permissions: string[];
};

function toAccess(row: AccessRow, userId: string, isDirector: boolean): ProjectAccess {
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    projectStatus: row.project_status,
    userId,
    role: row.role,
    status: row.member_status,
    isOwner: row.role === "owner",
    permissions: new Set((row.permissions ?? []).filter(isPermissionKey)),
    isDirector,
  };
}

/**
 * Effective access of the current user in all their projects. Computed by the
 * database (get_my_project_access) with exactly the rules RLS applies.
 */
export const getMyProjectsAccess = cache(async (): Promise<ProjectAccess[]> => {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, profile] = await Promise.all([
    supabase.rpc("get_my_project_access", {}),
    getCurrentProfile(),
  ]);
  if (error) throw error;
  return (data ?? []).map((row) => toAccess(row, user.id, profile?.isDirector === true));
});

export const getProjectAccess = cache(async (projectId: string): Promise<ProjectAccess | null> => {
  const all = await getMyProjectsAccess();
  return all.find((access) => access.projectId === projectId) ?? null;
});

/** Projects in which the user currently holds a permission. */
export async function projectsWithPermission(permission: PermissionKey): Promise<ProjectAccess[]> {
  const all = await getMyProjectsAccess();
  return all.filter((access) => can(access, permission));
}

/** For Server Actions: throws a localized, user-facing error when access is missing. */
export async function assertProjectPermission(projectId: string, permission: PermissionKey): Promise<ProjectAccess> {
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) {
    throw new AppError("PROJECT_ACCESS_DENIED");
  }
  if (!can(access, permission)) {
    throw new AppError("PERMISSION_DENIED");
  }
  return access;
}

export async function assertProjectAccess(projectId: string): Promise<ProjectAccess> {
  return assertProjectPermission(projectId, "project.view");
}
