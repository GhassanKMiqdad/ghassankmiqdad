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
import { getFirebaseFirestore } from "@/lib/firebase/server";
import { getSessionUser } from "@/server/auth";

export type { ProjectAccess };

function makeAccess(
  projectId: string,
  project: FirebaseFirestore.DocumentData,
  member: FirebaseFirestore.DocumentData,
  userId: string,
): ProjectAccess {
  const role = member.role as ProjectRole;
  const permissions = Array.isArray(member.permissions) ? member.permissions.filter(isPermissionKey) : [];
  return {
    projectId,
    projectName: typeof project.name === "string" ? project.name : "",
    projectStatus: project.status as ProjectStatus,
    userId,
    role,
    status: member.status as MemberStatus,
    isOwner: role === "owner",
    permissions: new Set(permissions),
  };
}

/** Effective project access is loaded from server-only Firestore membership documents. */
export const getMyProjectsAccess = cache(async (): Promise<ProjectAccess[]> => {
  const user = await getSessionUser();
  if (!user) return [];
  const db = getFirebaseFirestore();
  const memberships = await db.collection("project_members").where("user_id", "==", user.id).limit(200).get();
  const records = await Promise.all(
    memberships.docs.map(async (memberDoc) => {
      const member = memberDoc.data();
      const projectId = typeof member.project_id === "string" ? member.project_id : "";
      if (!projectId) return null;
      const projectSnapshot = await db.collection("projects").doc(projectId).get();
      if (!projectSnapshot.exists) return null;
      return makeAccess(projectId, projectSnapshot.data()!, member, user.id);
    }),
  );
  return records.filter((item): item is ProjectAccess => item !== null);
});

export const getProjectAccess = cache(async (projectId: string): Promise<ProjectAccess | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const db = getFirebaseFirestore();
  const memberSnapshot = await db.collection("project_members").doc(`${projectId}_${user.id}`).get();
  if (!memberSnapshot.exists) return null;
  const projectSnapshot = await db.collection("projects").doc(projectId).get();
  if (!projectSnapshot.exists) return null;
  return makeAccess(projectId, projectSnapshot.data()!, memberSnapshot.data()!, user.id);
});

/** Projects in which the current user holds a permission. */
export async function projectsWithPermission(permission: PermissionKey): Promise<ProjectAccess[]> {
  return (await getMyProjectsAccess()).filter((access) => can(access, permission));
}

/** For Server Actions: checks the verified user against current Firestore grants on every call. */
export async function assertProjectPermission(projectId: string, permission: PermissionKey): Promise<ProjectAccess> {
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) throw new AppError("PROJECT_ACCESS_DENIED");
  if (!can(access, permission)) throw new AppError("PERMISSION_DENIED");
  return access;
}

export async function assertProjectAccess(projectId: string): Promise<ProjectAccess> {
  return assertProjectPermission(projectId, "project.view");
}
