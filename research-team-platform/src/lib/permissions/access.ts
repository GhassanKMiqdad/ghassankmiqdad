import type { MemberStatus, PermissionKey, ProjectRole, ProjectStatus } from "@/lib/permissions/catalog";
import type { AccessSubject } from "@/lib/permissions/policy";

/** Effective access of the current user in one project (server-side form). */
export type ProjectAccess = AccessSubject & {
  projectId: string;
  projectName: string;
  projectStatus: ProjectStatus;
  isOwner: boolean;
};

/** Plain, serializable form passed to Client Components (UI decisions only). */
export type ProjectAccessDTO = {
  projectId: string;
  projectName: string;
  projectStatus: ProjectStatus;
  userId: string;
  role: ProjectRole;
  status: MemberStatus;
  permissions: PermissionKey[];
};

export function toAccessDTO(access: ProjectAccess): ProjectAccessDTO {
  return {
    projectId: access.projectId,
    projectName: access.projectName,
    projectStatus: access.projectStatus,
    userId: access.userId,
    role: access.role,
    status: access.status,
    permissions: [...access.permissions],
  };
}

export function fromAccessDTO(dto: ProjectAccessDTO): ProjectAccess {
  return { ...dto, isOwner: dto.role === "owner", permissions: new Set(dto.permissions) };
}
