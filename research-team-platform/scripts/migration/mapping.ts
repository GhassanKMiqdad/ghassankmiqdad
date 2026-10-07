import type { UserImportRecord } from "firebase-admin/auth";

import {
  PERMISSION_CATEGORY,
  PERMISSION_KEYS,
  PROJECT_STATUSES,
  ROLE_TEMPLATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  isPermissionKey,
  sortPermissionKeys,
  type ProjectRole,
} from "../../src/lib/permissions/catalog";

export type LegacyRow = Record<string, unknown>;
export type SourceAuthUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  created_at?: string | null;
  banned_until?: string | null;
  user_metadata?: Record<string, unknown> | null;
  identities?: Array<{ provider?: string }> | null;
};
export type MappedDocument = { collection: string; id: string; data: LegacyRow };

export function mapPermissionCatalogs(sourcePermissions: readonly LegacyRow[] = []): MappedDocument[] {
  const legacyByKey = new Map(sourcePermissions.map((row) => [String(row.key), row]));
  const permissions = PERMISSION_KEYS.map((key, index) => ({
    collection: "permissions",
    id: key,
    data: {
      id: key,
      key,
      category: PERMISSION_CATEGORY[key],
      sort_order:
        typeof legacyByKey.get(key)?.sort_order === "number" ? legacyByKey.get(key)!.sort_order : (index + 1) * 10,
      description: text(legacyByKey.get(key)?.description),
    },
  }));
  const templates = Object.entries(ROLE_TEMPLATES).flatMap(([role, keys]) =>
    keys.map((permissionKey) => ({
      collection: "role_permissions",
      id: `${role}_${permissionKey}`,
      data: { id: `${role}_${permissionKey}`, role, permission_key: permissionKey },
    })),
  );
  return [...permissions, ...templates];
}

const ROLES = new Set<ProjectRole>(["owner", "manager", "member", "reviewer"]);
const MEMBER_STATUSES = new Set(["active", "suspended"]);
const LEGACY_TASK_STATUSES = new Set(["todo", "in_progress", "review", "completed", "rejected"]);

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("/")) {
    throw new Error(`Invalid ${label}; expected a non-empty Firestore-safe string.`);
  }
  return value;
}

function requiredStoragePath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid ${label}; expected a relative Storage object path without traversal segments.`);
  }
  return value;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function validRole(value: unknown): ProjectRole {
  if (typeof value !== "string" || !ROLES.has(value as ProjectRole)) {
    throw new Error(`Unsupported legacy project role: ${String(value)}.`);
  }
  return value as ProjectRole;
}

export function membershipDocumentId(projectId: string, userId: string): string {
  return `${requiredString(projectId, "project id")}_${requiredString(userId, "user id")}`;
}

export function permissionDocumentId(projectId: string, userId: string, permission: string): string {
  return `${membershipDocumentId(projectId, userId)}_${requiredString(permission, "permission key")}`;
}

export function mapProject(row: LegacyRow): MappedDocument {
  const id = requiredString(row.id, "project id");
  if (!PROJECT_STATUSES.includes(row.status as (typeof PROJECT_STATUSES)[number])) {
    throw new Error(`Project ${id} has an unsupported status: ${String(row.status)}.`);
  }
  return {
    collection: "projects",
    id,
    data: {
      id,
      name: text(row.name),
      description: text(row.description),
      research_goal: text(row.research_goal),
      research_type: text(row.research_type),
      research_objectives: text(row.research_objectives),
      research_questions: text(row.research_questions),
      methodology: text(row.methodology),
      status: row.status,
      priority: TASK_PRIORITIES.includes(row.priority as (typeof TASK_PRIORITIES)[number]) ? row.priority : "medium",
      start_date: nullableText(row.start_date),
      deadline: nullableText(row.deadline),
      created_by: nullableText(row.created_by),
      created_at: nullableText(row.created_at),
      updated_at: nullableText(row.updated_at),
    },
  };
}

export function mapProfile(row: LegacyRow | null, authUser: SourceAuthUser): MappedDocument {
  const id = requiredString(authUser.id, "auth user id");
  const metadataName = authUser.user_metadata?.full_name;
  const fullName = text(row?.full_name, text(metadataName, authUser.email?.split("@")[0] ?? ""));
  const email = nullableText(row?.email) ?? nullableText(authUser.email);
  return {
    collection: "profiles",
    id,
    data: {
      id,
      email,
      email_lower: email?.toLowerCase() ?? null,
      email_verified: Boolean(authUser.email_confirmed_at),
      full_name: fullName,
      avatar_url: nullableText(row?.avatar_url),
      is_platform_admin: bool(row?.is_platform_admin),
      can_create_projects: bool(row?.can_create_projects),
      created_at: nullableText(row?.created_at) ?? nullableText(authUser.created_at),
      updated_at: nullableText(row?.updated_at),
      last_sign_in_at: nullableText(row?.last_sign_in_at) ?? nullableText(authUser.last_sign_in_at),
    },
  };
}

export function mapAuthUser(
  user: SourceAuthUser,
  profile: LegacyRow | null = null,
  now = Date.now(),
): UserImportRecord {
  const email = nullableText(user.email);
  const bannedUntil = nullableText(user.banned_until);
  const disabled = Boolean(bannedUntil && Date.parse(bannedUntil) > now);
  const displayName = text(profile?.full_name, text(user.user_metadata?.full_name, email?.split("@")[0] ?? ""));
  return {
    uid: requiredString(user.id, "auth user id"),
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
    emailVerified: Boolean(user.email_confirmed_at),
    disabled,
  };
}

export function mapMembership(
  row: LegacyRow,
  sourceGrants: readonly string[],
): { membership: MappedDocument; grants: MappedDocument[]; removedPermissions: string[] } {
  const projectId = requiredString(row.project_id, "membership project id");
  const userId = requiredString(row.user_id, "membership user id");
  const id = membershipDocumentId(projectId, userId);
  const role = validRole(row.role);
  const status = text(row.status, "active");
  if (!MEMBER_STATUSES.has(status)) throw new Error(`Membership ${id} has unsupported status: ${status}.`);

  // Never carry forward a legacy grant that is outside the new role template.
  // The old member/reviewer defaults included broad task/document visibility;
  // those permissions are deliberately dropped and reported for manual review.
  const granted = new Set(sourceGrants.filter(isPermissionKey));
  const researcherSafeDefaults =
    role === "member" ? (["tasks.update_progress", "tasks.add_work_notes", "tasks.submit"] as const) : [];
  const targetTemplate = new Set<string>([...ROLE_TEMPLATES[role], ...researcherSafeDefaults]);
  const nextPermissions =
    role === "owner"
      ? [...PERMISSION_KEYS]
      : sortPermissionKeys(
          [...new Set([...granted, ...researcherSafeDefaults])].filter((key) => targetTemplate.has(key)),
        );
  const nextPermissionSet = new Set<string>(nextPermissions);
  const removedPermissions = sourceGrants.filter((permission) => !nextPermissionSet.has(permission));

  const membership: MappedDocument = {
    collection: "project_members",
    id,
    data: {
      id,
      project_id: projectId,
      user_id: userId,
      role,
      status,
      permissions: nextPermissions,
      added_by: nullableText(row.added_by),
      joined_at: nullableText(row.created_at),
      updated_at: nullableText(row.updated_at),
    },
  };
  const grants = (role === "owner" ? [] : nextPermissions).map((permission) => ({
    collection: "user_permissions",
    id: permissionDocumentId(projectId, userId, permission),
    data: {
      id: permissionDocumentId(projectId, userId, permission),
      project_id: projectId,
      user_id: userId,
      permission_key: permission,
    },
  }));
  return { membership, grants, removedPermissions: [...new Set(removedPermissions)].sort() };
}

export function mapTask(row: LegacyRow): MappedDocument {
  const id = requiredString(row.id, "task id");
  const status = text(row.status);
  if (!LEGACY_TASK_STATUSES.has(status) || !TASK_STATUSES.includes(status as (typeof TASK_STATUSES)[number])) {
    throw new Error(`Task ${id} has an unsupported legacy status: ${status}.`);
  }
  const priority = text(row.priority, "medium");
  if (!TASK_PRIORITIES.includes(priority as (typeof TASK_PRIORITIES)[number])) {
    throw new Error(`Task ${id} has an unsupported priority: ${priority}.`);
  }
  return {
    collection: "tasks",
    id,
    data: {
      id,
      project_id: requiredString(row.project_id, "task project id"),
      title: text(row.title),
      description: text(row.description),
      expected_output: text(row.expected_output),
      required_deliverables: text(row.required_deliverables),
      status,
      priority,
      assigned_to: nullableText(row.assigned_to),
      created_by: nullableText(row.created_by),
      due_date: nullableText(row.due_date),
      completed_at: nullableText(row.completed_at),
      progress:
        typeof row.progress === "number"
          ? Math.max(0, Math.min(100, Math.round(row.progress)))
          : status === "review" || status === "completed"
            ? 100
            : 0,
      work_notes: text(row.work_notes),
      created_at: nullableText(row.created_at),
      updated_at: nullableText(row.updated_at),
    },
  };
}

export function mapDocument(row: LegacyRow): MappedDocument {
  const id = requiredString(row.id, "document id");
  const projectId = requiredString(row.project_id, "document project id");
  const uploadedBy = nullableText(row.uploaded_by);
  return {
    collection: "documents",
    id,
    data: {
      id,
      project_id: projectId,
      title: text(row.title),
      description: text(row.description),
      file_name: text(row.file_name),
      storage_path: requiredStoragePath(row.storage_path, "document storage path"),
      mime_type: text(row.mime_type, "application/octet-stream"),
      size_bytes: Number(row.size_bytes ?? 0),
      uploaded_by: uploadedBy,
      // Source documents were project-scoped. Restrict migrated files to their
      // uploader; target managers with team.view may still manage project files.
      authorized_users: uploadedBy ? [uploadedBy] : [],
      created_at: nullableText(row.created_at),
      updated_at: nullableText(row.updated_at),
    },
  };
}

export function mapComment(row: LegacyRow): MappedDocument {
  const id = requiredString(row.id, "comment id");
  return {
    collection: "comments",
    id,
    data: {
      id,
      project_id: requiredString(row.project_id, "comment project id"),
      task_id: nullableText(row.task_id),
      author_id: nullableText(row.author_id),
      content: text(row.content),
      created_at: nullableText(row.created_at),
      updated_at: nullableText(row.updated_at),
    },
  };
}

export function mapActivityLog(row: LegacyRow): MappedDocument {
  const id = requiredString(row.id, "activity id");
  return {
    collection: "activity_logs",
    id,
    data: {
      ...row,
      id,
      project_id: nullableText(row.project_id),
      actor_id: nullableText(row.actor_id),
      entity_id: nullableText(row.entity_id),
      ip_address: nullableText(row.ip_address),
      created_at: nullableText(row.created_at),
    },
  };
}

export function isSafeSubsetEqual(expected: LegacyRow, actual: LegacyRow): boolean {
  return Object.entries(expected).every(([key, expectedValue]) => {
    const actualValue = actual[key];
    if (Array.isArray(expectedValue)) {
      return Array.isArray(actualValue) && JSON.stringify(actualValue) === JSON.stringify(expectedValue);
    }
    if (expectedValue && typeof expectedValue === "object") {
      return (
        Boolean(actualValue && typeof actualValue === "object") &&
        isSafeSubsetEqual(expectedValue as LegacyRow, actualValue as LegacyRow)
      );
    }
    return expectedValue === actualValue;
  });
}
