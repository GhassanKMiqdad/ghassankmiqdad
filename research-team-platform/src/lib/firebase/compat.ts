import "server-only";

import { headers } from "next/headers";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

import { MAX_UPLOAD_BYTES } from "@/lib/env";
import {
  firebaseAdminAuth,
  firebaseAdminFirestore,
  firebaseAdminStorage,
  syncPlatformAdminClaim,
} from "@/lib/firebase/admin";
import { AppError } from "@/lib/errors";
import { documentStoragePath, isDocumentPathFor, resolveFileType } from "@/lib/files";
import { can, canDeleteComment, canEditComment } from "@/lib/permissions/policy";
import {
  PERMISSION_KEYS,
  ROLE_TEMPLATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  isPermissionKey,
  type PermissionKey,
  type ProjectRole,
} from "@/lib/permissions/catalog";
import type { ProjectAccess } from "@/lib/permissions/access";
import { getSessionUser, type SessionUser } from "@/server/auth";

// Firestore is the source of truth. This small query facade lets the established
// server data-access modules migrate incrementally without pretending Firestore
// has SQL joins: joins are batched document lookups and all visibility is
// resolved against the caller's verified membership before returning rows.

// Firestore documents are runtime-shaped; validation and authorization happen before rows leave this server-only adapter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type RowValue = Row[string];
type CompatError = { code: string; message: string; details?: string };
type CompatResponse<T = RowValue> = { data: T; error: CompatError | null; count?: number | null };
type Condition = { field: string; op: string; value: unknown };
type Order = { field: string; ascending: boolean; nullsFirst?: boolean };

const COLLECTIONS = new Set([
  "projects",
  "project_members",
  "user_permissions",
  "tasks",
  "documents",
  "comments",
  "activity_logs",
  "notifications",
  "profiles",
]);

function nowIso() {
  return new Date().toISOString();
}
function rowFromSnapshot(snapshot: QueryDocumentSnapshot): Row {
  const row = normalize(snapshot.data()) as Row;
  return { ...row, id: typeof row.id === "string" ? row.id : snapshot.id };
}
function normalize(value: unknown): unknown {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function")
    return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}
function normalizeRow(value: unknown): Row {
  const normalized = normalize(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized) ? (normalized as Row) : {};
}
function failure(code: string, message = code): CompatError {
  return { code, message };
}
function responseError(error: unknown): CompatResponse<never> {
  if (error instanceof AppError) return { data: null as never, error: failure(error.code, error.code) };
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: unknown }).message);
    const known = new Set([
      "NOT_AUTHENTICATED",
      "PERMISSION_DENIED",
      "PROJECT_ACCESS_DENIED",
      "USER_NOT_FOUND",
      "MEMBER_NOT_FOUND",
      "ALREADY_MEMBER",
      "CANNOT_MODIFY_OWNER",
      "CANNOT_MODIFY_SELF",
      "INSUFFICIENT_RANK",
      "PERMISSION_ESCALATION",
      "UNKNOWN_PERMISSION",
      "LAST_PLATFORM_ADMIN",
      "OWNER_HAS_PROJECTS",
      "TASK_EDIT_FORBIDDEN",
      "TASK_STATUS_FORBIDDEN",
      "TASK_ASSIGN_FORBIDDEN",
      "ASSIGNEE_NOT_MEMBER",
      "DOCUMENT_FILE_MISSING",
      "ACTIVITY_LOG_IMMUTABLE",
      "INVALID_INPUT",
    ]);
    return { data: null as never, error: failure(known.has(message) ? message : "UNEXPECTED", message) };
  }
  return { data: null as never, error: failure("UNEXPECTED") };
}
function permissionArray(member: Row): PermissionKey[] {
  if (member.role === "owner") return [...PERMISSION_KEYS];
  if (Array.isArray(member.permissions)) return member.permissions.filter(isPermissionKey);
  return [...(ROLE_TEMPLATES[member.role as ProjectRole] ?? [])];
}
function makeAccess(projectId: string, project: Row, member: Row, userId: string): ProjectAccess {
  const role = member.role as ProjectRole;
  return {
    projectId,
    projectName: String(project.name ?? ""),
    projectStatus: project.status,
    userId,
    role,
    status: member.status,
    isOwner: role === "owner",
    permissions: new Set(permissionArray(member)),
  };
}
function canIn(access: ProjectAccess | null, permission: PermissionKey) {
  return Boolean(access && access.status === "active" && can(access, "project.view") && can(access, permission));
}
function fieldValue(row: Row, field: string): unknown {
  return field.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object" && part in value) return (value as Record<string, unknown>)[part];
    return undefined;
  }, row);
}
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? 1 : -1;
  return 0;
}
function patternMatches(value: unknown, pattern: unknown, insensitive: boolean) {
  if (typeof value !== "string" || typeof pattern !== "string") return false;
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, insensitive ? "i" : "").test(value);
}
function parseInList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  return value
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""));
}
function applyCondition(row: Row, condition: Condition): boolean {
  const actual = fieldValue(row, condition.field);
  const expected = condition.value;
  switch (condition.op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "is":
      return expected === null ? actual == null : actual === expected;
    case "in":
      return parseInList(expected).includes(actual);
    case "not_in":
      return !parseInList(expected).includes(actual);
    case "lt":
      return actual != null && compareValues(actual, expected) < 0;
    case "lte":
      return actual != null && compareValues(actual, expected) <= 0;
    case "gt":
      return actual != null && compareValues(actual, expected) > 0;
    case "gte":
      return actual != null && compareValues(actual, expected) >= 0;
    case "ilike":
      return patternMatches(actual, expected, true);
    case "like":
      return patternMatches(actual, expected, false);
    case "or": {
      const alternatives = String(expected)
        .split(",")
        .map((part) => part.trim());
      return alternatives.some((expression) => {
        const match = expression.match(/^([\w.]+)\.(eq|neq|ilike|like)\.(.*)$/);
        if (!match) return false;
        return applyCondition(row, {
          field: match[1]!,
          op: match[2]!,
          value: match[3]!.replace(/^%|%$/g, (token) => token),
        });
      });
    }
    default:
      return true;
  }
}

async function getProfile(userId: string): Promise<Row | null> {
  const snapshot = await firebaseAdminFirestore().collection("profiles").doc(userId).get();
  return snapshot.exists ? { ...(normalize(snapshot.data()) as Row), id: userId } : null;
}

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const snapshot = await firebaseAdminFirestore().collection("profiles").doc(userId).get();
  return snapshot.exists && snapshot.get("is_platform_admin") === true;
}

function publicProfile(profile: Row): Row {
  return Object.fromEntries(
    ["id", "full_name", "email", "avatar_url"].filter((key) => key in profile).map((key) => [key, profile[key]]),
  );
}

async function getProjectAccess(userId: string, projectId: string): Promise<ProjectAccess | null> {
  const db = firebaseAdminFirestore();
  const [memberSnapshot, projectSnapshot, profileSnapshot] = await Promise.all([
    db.collection("project_members").doc(`${projectId}_${userId}`).get(),
    db.collection("projects").doc(projectId).get(),
    db.collection("profiles").doc(userId).get(),
  ]);
  if (!projectSnapshot.exists) return null;
  const project = normalizeRow(projectSnapshot.data());
  if (profileSnapshot.get("is_platform_admin") === true) {
    return makeAccess(
      projectId,
      project,
      { role: "owner", status: "active", permissions: [...PERMISSION_KEYS] },
      userId,
    );
  }
  if (!memberSnapshot.exists) return null;
  return makeAccess(projectId, project, normalizeRow(memberSnapshot.data()), userId);
}

async function listAccess(userId: string): Promise<ProjectAccess[]> {
  const db = firebaseAdminFirestore();
  const profile = await db.collection("profiles").doc(userId).get();
  if (profile.get("is_platform_admin") === true) {
    const projects = await db.collection("projects").limit(2000).get();
    return projects.docs.map((snapshot) =>
      makeAccess(
        snapshot.id,
        normalizeRow(snapshot.data()),
        { role: "owner", status: "active", permissions: [...PERMISSION_KEYS] },
        userId,
      ),
    );
  }
  const members = await db.collection("project_members").where("user_id", "==", userId).limit(200).get();
  return (
    await Promise.all(
      members.docs.map(async (snapshot) => {
        const member = normalize(snapshot.data()) as Row;
        const projectId = String(member.project_id ?? "");
        if (!projectId) return null;
        const project = await db.collection("projects").doc(projectId).get();
        return project.exists ? makeAccess(projectId, normalizeRow(project.data()), member, userId) : null;
      }),
    )
  ).filter((item): item is ProjectAccess => item !== null);
}

function active(access: ProjectAccess | null) {
  return access?.status === "active" && can(access, "project.view");
}
async function taskVisible(task: Row, access: ProjectAccess | null, uid: string) {
  if (!active(access)) return false;
  if (task.assigned_to === uid) return true;
  if (typeof task.team_id === "string" && !access!.isOwner && !can(access!, "members.manage")) {
    const membership = await firebaseAdminFirestore().collection("team_members").doc(`${task.team_id}_${uid}`).get();
    if (!membership.exists || membership.get("status") !== "active") return false;
  }
  return (
    can(access!, "tasks.view") ||
    (can(access!, "tasks.review") && ["submitted", "review"].includes(String(task.status)))
  );
}
async function documentVisible(doc: Row, access: ProjectAccess | null, uid: string) {
  if (!active(access)) return false;
  if (typeof doc.task_id === "string") {
    const task = await firebaseAdminFirestore().collection("tasks").doc(doc.task_id).get();
    if (!task.exists || !(await taskVisible(normalizeRow(task.data()), access, uid))) return false;
    return doc.uploaded_by === uid || canIn(access, "tasks.review") || canIn(access, "tasks.view");
  }
  const allowed = doc.authorized_users;
  if (Array.isArray(allowed) && allowed.includes(uid)) return true;
  return (
    canIn(access, "documents.view") && (!Array.isArray(allowed) || allowed.length === 0 || can(access!, "team.view"))
  );
}

async function filterAsync<T>(items: T[], predicate: (item: T) => Promise<boolean>): Promise<T[]> {
  const accepted = await Promise.all(items.map(predicate));
  return items.filter((_, index) => accepted[index]);
}

function validDateString(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function queryForProject(
  collection: string,
  projectId: string,
  taskDateRange?: { from?: string; to?: string },
): Promise<Row[]> {
  let query = firebaseAdminFirestore().collection(collection).where("project_id", "==", projectId);
  if (collection === "tasks" && taskDateRange?.from) query = query.where("due_date", ">=", taskDateRange.from);
  if (collection === "tasks" && taskDateRange?.to) query = query.where("due_date", "<=", taskDateRange.to);
  const snapshot = await query.limit(2000).get();
  return snapshot.docs.map(rowFromSnapshot);
}

async function loadVisibleRows(table: string, uid: string, filters: Condition[]): Promise<Row[]> {
  const db = firebaseAdminFirestore();
  const explicitId = filters.find((filter) => filter.field === "id" && filter.op === "eq")?.value;
  const explicitProject = filters.find((filter) => filter.field === "project_id" && filter.op === "eq")?.value;
  const access = await listAccess(uid);
  const byProject = new Map(access.map((item) => [item.projectId, item]));
  const permittedAccess = (permission: PermissionKey) => access.filter((item) => canIn(item, permission));

  if (table === "permissions")
    return PERMISSION_KEYS.map((key) => ({ id: key, permission_key: key, category: key.split(".")[0] }));
  if (table === "role_permissions")
    return Object.entries(ROLE_TEMPLATES).flatMap(([role, permissions]) =>
      permissions.map((key) => ({ id: `${role}_${key}`, role, permission_key: key })),
    );
  if (table === "notifications") {
    if (typeof explicitId === "string") {
      const snapshot = await db.collection("notifications").doc(explicitId).get();
      return snapshot.exists && snapshot.get("user_id") === uid
        ? [{ ...(normalize(snapshot.data()) as Row), id: snapshot.id }]
        : [];
    }
    const snapshot = await db
      .collection("notifications")
      .where("user_id", "==", uid)
      .orderBy("created_at", "desc")
      .limit(100)
      .get();
    return snapshot.docs.map(rowFromSnapshot);
  }

  if (table === "profiles") {
    const platformAdmin = await isPlatformAdmin(uid);
    if (platformAdmin) {
      const docs = await db.collection("profiles").limit(2000).get();
      return docs.docs.map((doc) => ({
        id: doc.id,
        email: doc.get("email") ?? null,
        full_name: doc.get("full_name") ?? null,
        avatar_url: doc.get("avatar_url") ?? null,
        is_platform_admin: doc.get("is_platform_admin") === true,
        can_create_projects: doc.get("can_create_projects") === true,
        created_at: normalize(doc.get("created_at")),
        last_sign_in_at: normalize(doc.get("last_sign_in_at")),
      }));
    }
    const visibleIds = new Set([uid]);
    for (const memberAccess of [...permittedAccess("team.view"), ...permittedAccess("tasks.assign")]) {
      const members = await db
        .collection("project_members")
        .where("project_id", "==", memberAccess.projectId)
        .where("status", "==", "active")
        .limit(300)
        .get();
      members.docs.forEach((member) => visibleIds.add(String(member.get("user_id"))));
    }
    if (explicitId && typeof explicitId === "string") {
      if (!visibleIds.has(explicitId)) return [];
      const profile = await getProfile(explicitId);
      return profile ? [profile] : [];
    }
    const docs = await Promise.all([...visibleIds].map((id) => db.collection("profiles").doc(id).get()));
    return docs
      .filter((item) => item.exists)
      .map((item) => publicProfile({ ...(normalize(item.data()) as Row), id: item.id }));
  }

  if (table === "projects") {
    const rows = permittedAccess("project.view");
    const filtered = explicitId ? rows.filter((item) => item.projectId === explicitId) : rows;
    const docs = filtered.length
      ? await db.getAll(...filtered.map((item) => db.collection("projects").doc(item.projectId)))
      : [];
    return docs.filter((doc) => doc.exists).map((doc) => ({ ...(normalize(doc.data()) as Row), id: doc.id }));
  }

  if (table === "project_members" || table === "user_permissions") {
    let targetProjects = access.filter(active);
    if (typeof explicitProject === "string")
      targetProjects = targetProjects.filter((item) => item.projectId === explicitProject);
    const rows: Row[] = [];
    for (const project of targetProjects) {
      const selfOnly =
        table === "user_permissions"
          ? !canIn(project, "team.view")
          : !canIn(project, "team.view") && !canIn(project, "tasks.assign");
      if (selfOnly && table === "project_members") {
        const self = await db.collection(table).doc(`${project.projectId}_${uid}`).get();
        if (self.exists) rows.push({ ...normalizeRow(self.data()), id: self.id });
        continue;
      }
      if (selfOnly && table === "user_permissions") {
        const selfRows = await db
          .collection(table)
          .where("project_id", "==", project.projectId)
          .where("user_id", "==", uid)
          .limit(100)
          .get();
        rows.push(...selfRows.docs.map(rowFromSnapshot));
        continue;
      }
      const scopedRows = await queryForProject(table, project.projectId);
      if (table === "project_members" && !canIn(project, "team.view")) {
        rows.push(
          ...scopedRows.map((row) =>
            Object.fromEntries(
              ["id", "project_id", "user_id", "role", "status", "joined_at"]
                .filter((field) => field in row)
                .map((field) => [field, row[field]]),
            ),
          ),
        );
      } else {
        rows.push(...scopedRows);
      }
    }
    return explicitId ? rows.filter((row) => row.id === explicitId) : rows;
  }

  const tablePermission: Record<string, PermissionKey> = {
    tasks: "project.view",
    documents: "project.view",
    comments: "project.view",
    activity_logs: "activity.view",
  };
  if (!COLLECTIONS.has(table) || !tablePermission[table]) throw new Error(`Unsupported Firestore collection: ${table}`);

  // ID lookups are constrained by the same project authorization as collection queries.
  if (typeof explicitId === "string") {
    const snapshot = await db.collection(table).doc(explicitId).get();
    if (!snapshot.exists) return [];
    const row: Row = { ...(normalize(snapshot.data()) as Row), id: snapshot.id };
    const projectId = String(row.project_id ?? "");
    const projectAccess = byProject.get(projectId) ?? null;
    if (table === "tasks") return (await taskVisible(row, projectAccess, uid)) ? [row] : [];
    if (table === "documents") return (await documentVisible(row, projectAccess, uid)) ? [row] : [];
    if (table === "comments") {
      if (!active(projectAccess)) return [];
      if (row.task_id) {
        const task = await db.collection("tasks").doc(String(row.task_id)).get();
        return task.exists && (await taskVisible(normalizeRow(task.data()), projectAccess, uid)) ? [row] : [];
      }
      return canIn(projectAccess, "team.view") || row.author_id === uid ? [row] : [];
    }
    if (table === "activity_logs") {
      if (row.project_id == null) return row.actor_id === uid || (await isPlatformAdmin(uid)) ? [row] : [];
      return active(projectAccess) && (row.actor_id === uid || canIn(projectAccess, "activity.view")) ? [row] : [];
    }
  }

  let scopes: ProjectAccess[];
  if (typeof explicitProject === "string") {
    const item = byProject.get(explicitProject);
    scopes = item && active(item) ? [item] : [];
  } else if (table === "tasks") {
    scopes = access.filter(active);
  } else if (table === "documents") {
    scopes = access.filter(active);
  } else {
    const permission = tablePermission[table]!;
    scopes = permittedAccess(permission);
  }
  const dueFrom = filters.find((filter) => filter.field === "due_date" && filter.op === "gte")?.value;
  const dueTo = filters.find((filter) => filter.field === "due_date" && filter.op === "lte")?.value;
  const taskDateRange =
    table === "tasks"
      ? {
          from: typeof dueFrom === "string" && validDateString(dueFrom) ? dueFrom : undefined,
          to: typeof dueTo === "string" && validDateString(dueTo) ? dueTo : undefined,
        }
      : undefined;
  const rows: Row[] = [];
  for (const scope of scopes) {
    rows.push(...(await queryForProject(table, scope.projectId, taskDateRange)));
  }
  if (table === "activity_logs") {
    const ownLogs = await db.collection("activity_logs").where("actor_id", "==", uid).limit(1000).get();
    const seen = new Set(rows.map((row) => row.id));
    rows.push(...ownLogs.docs.map(rowFromSnapshot).filter((row) => !seen.has(row.id)));
  }
  if (table === "tasks")
    return filterAsync(rows, (row) => taskVisible(row, byProject.get(String(row.project_id)) ?? null, uid));
  if (table === "documents")
    return filterAsync(rows, (row) => documentVisible(row, byProject.get(String(row.project_id)) ?? null, uid));
  if (table === "comments") {
    const taskIds = [
      ...new Set(
        rows
          .map((row) => row.task_id)
          .filter(Boolean)
          .map(String),
      ),
    ];
    const taskSnapshots = taskIds.length ? await db.getAll(...taskIds.map((id) => db.collection("tasks").doc(id))) : [];
    const tasks = new Map(
      taskSnapshots.filter((doc) => doc.exists).map((doc) => [doc.id, normalize(doc.data()) as Row]),
    );
    return filterAsync(rows, async (row) =>
      !row.task_id
        ? canIn(byProject.get(String(row.project_id)) ?? null, "team.view") ||
          (active(byProject.get(String(row.project_id)) ?? null) && row.author_id === uid)
        : taskVisible(tasks.get(String(row.task_id)) ?? {}, byProject.get(String(row.project_id)) ?? null, uid),
    );
  }
  if (table === "activity_logs")
    return rows.filter((row) => {
      if (row.project_id == null) return row.actor_id === uid;
      const access = byProject.get(String(row.project_id)) ?? null;
      return active(access) && (row.actor_id === uid || canIn(access, "activity.view"));
    });
  return rows;
}

async function loadRelations(rows: Row[], table: string, select: string): Promise<Row[]> {
  const relations = [...select.matchAll(/(\w+):(profiles|projects)(?:![\w]+)?\(([^)]*)\)/g)];
  if (!relations.length || !rows.length) return rows;
  const db = firebaseAdminFirestore();
  const profiles = new Map<string, Row>();
  const projects = new Map<string, Row>();
  const profileIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const row of rows) {
    if (table === "tasks") {
      if (row.assigned_to) profileIds.add(String(row.assigned_to));
      if (row.created_by) profileIds.add(String(row.created_by));
    } else if (table === "documents" && row.uploaded_by) profileIds.add(String(row.uploaded_by));
    else if (table === "comments" && row.author_id) profileIds.add(String(row.author_id));
    else if (table === "project_members" && row.user_id) profileIds.add(String(row.user_id));
    else if (table === "projects" && row.created_by) profileIds.add(String(row.created_by));
    if (row.project_id) projectIds.add(String(row.project_id));
  }
  const profileDocs = profileIds.size
    ? await db.getAll(...[...profileIds].map((id) => db.collection("profiles").doc(id)))
    : [];
  profileDocs.forEach((doc) => {
    if (doc.exists) profiles.set(doc.id, publicProfile({ ...(normalize(doc.data()) as Row), id: doc.id }));
  });
  const projectDocs = projectIds.size
    ? await db.getAll(...[...projectIds].map((id) => db.collection("projects").doc(id)))
    : [];
  projectDocs.forEach((doc) => {
    if (doc.exists) projects.set(doc.id, { ...(normalize(doc.data()) as Row), id: doc.id });
  });
  return rows.map((row) => {
    const output = { ...row };
    for (const relation of relations) {
      const alias = relation[1]!;
      const target = relation[2]!;
      const requested = relation[3]!
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean);
      if (target === "projects") output[alias] = projects.get(String(row.project_id)) ?? null;
      else {
        const profileId =
          alias === "assignee"
            ? row.assigned_to
            : alias === "creator"
              ? row.created_by
              : alias === "uploader"
                ? row.uploaded_by
                : alias === "author"
                  ? row.author_id
                  : alias === "profile"
                    ? row.user_id
                    : row.created_by;
        const profile = profileId ? (profiles.get(String(profileId)) ?? null) : null;
        output[alias] = profile
          ? Object.fromEntries(
              [...new Set(requested.filter((field) => ["id", "full_name", "email", "avatar_url"].includes(field)))]
                .filter((field) => field in profile)
                .map((field) => [field, profile[field]]),
            )
          : null;
      }
    }
    return output;
  });
}

async function writeActivity(
  uid: string,
  projectId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  label: string | null,
  oldValues?: Row | null,
  newValues?: Row | null,
) {
  const profile = await getProfile(uid);
  const requestHeaders = await headers().catch(() => null);
  const ref = firebaseAdminFirestore().collection("activity_logs").doc(crypto.randomUUID());
  await ref.set({
    id: ref.id,
    project_id: projectId,
    actor_id: uid,
    actor_email: profile?.email ?? null,
    actor_name: profile?.full_name ?? profile?.email ?? null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    entity_label: label,
    old_values: oldValues ?? null,
    new_values: newValues ?? null,
    metadata: {},
    ip_address: requestHeaders?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: requestHeaders?.get("user-agent") ?? null,
    created_at: nowIso(),
  });
}

async function notifyUser(userId: string, projectId: string, task: Row, type: string) {
  const ref = firebaseAdminFirestore().collection("notifications").doc(crypto.randomUUID());
  await ref.create({
    id: ref.id,
    user_id: userId,
    project_id: projectId,
    task_id: String(task.id),
    task_title: String(task.title ?? ""),
    type,
    href: `/projects/${projectId}/tasks/${task.id}`,
    created_at: nowIso(),
    read_at: null,
  });
}

async function notifyTaskReviewers(projectId: string, task: Row) {
  const members = await firebaseAdminFirestore()
    .collection("project_members")
    .where("project_id", "==", projectId)
    .where("status", "==", "active")
    .limit(300)
    .get();
  const reviewers = members.docs.filter(
    (member) =>
      member.get("role") === "owner" ||
      (Array.isArray(member.get("permissions")) && member.get("permissions").includes("tasks.review")),
  );
  await Promise.all(
    reviewers.map((member) => notifyUser(String(member.get("user_id")), projectId, task, "task_submitted")),
  );
}

async function assertTaskMutation(uid: string, row: Row, values: Row) {
  const allowedFields = new Set([
    "title",
    "description",
    "expected_output",
    "required_deliverables",
    "priority",
    "due_date",
    "status",
    "assigned_to",
    "team_id",
    "progress",
    "work_notes",
  ]);
  if (Object.keys(values).some((key) => !allowedFields.has(key))) throw new AppError("INVALID_INPUT");
  if (
    (values.title !== undefined &&
      (typeof values.title !== "string" || values.title.length < 2 || values.title.length > 200)) ||
    (values.description !== undefined &&
      (typeof values.description !== "string" || values.description.length > 10000)) ||
    (values.expected_output !== undefined &&
      (typeof values.expected_output !== "string" || values.expected_output.length > 5000)) ||
    (values.required_deliverables !== undefined &&
      (typeof values.required_deliverables !== "string" || values.required_deliverables.length > 10000)) ||
    (values.priority !== undefined && !TASK_PRIORITIES.includes(values.priority)) ||
    (values.due_date !== undefined && !validDateString(values.due_date)) ||
    (values.status !== undefined && !TASK_STATUSES.includes(values.status)) ||
    (values.assigned_to !== undefined && values.assigned_to !== null && typeof values.assigned_to !== "string") ||
    (values.team_id !== undefined && values.team_id !== null && typeof values.team_id !== "string")
  )
    throw new AppError("INVALID_INPUT");

  const access = await getProjectAccess(uid, String(row.project_id));
  if (!active(access)) throw new AppError("PROJECT_ACCESS_DENIED");
  const contentKeys = ["title", "description", "expected_output", "required_deliverables", "priority", "due_date"];
  const changesContent = contentKeys.some((key) => values[key] !== undefined && values[key] !== row[key]);
  const canEdit = can(access!, "tasks.edit");
  if (changesContent && !canEdit) throw new AppError("TASK_EDIT_FORBIDDEN");
  if (
    values.progress !== undefined &&
    (row.assigned_to !== uid ||
      !can(access!, "tasks.update_progress") ||
      !Number.isFinite(values.progress) ||
      Number(values.progress) < 0 ||
      Number(values.progress) > 100)
  )
    throw new AppError("TASK_EDIT_FORBIDDEN");
  if (
    values.work_notes !== undefined &&
    (row.assigned_to !== uid ||
      !can(access!, "tasks.add_work_notes") ||
      typeof values.work_notes !== "string" ||
      values.work_notes.length > 10000)
  )
    throw new AppError("TASK_EDIT_FORBIDDEN");
  if (values.assigned_to !== undefined && !can(access!, "tasks.assign")) throw new AppError("TASK_ASSIGN_FORBIDDEN");
  if (values.team_id !== undefined && values.team_id !== row.team_id && !can(access!, "tasks.assign"))
    throw new AppError("TASK_ASSIGN_FORBIDDEN");
  if (values.status !== undefined && values.status !== row.status) {
    const cancelled = values.status === "cancelled" && canEdit;
    const accepted =
      values.status === "accepted" && row.status === "todo" && row.assigned_to === uid && can(access!, "tasks.submit");
    const progress =
      values.status === "in_progress" &&
      row.assigned_to === uid &&
      can(access!, "tasks.update_progress") &&
      ["todo", "accepted", "revision_required"].includes(String(row.status));
    if (!cancelled && !accepted && !progress) throw new AppError("TASK_STATUS_FORBIDDEN");
  }
  if (values.assigned_to) {
    const assignee = await getProjectAccess(uid, String(row.project_id));
    const member = await firebaseAdminFirestore()
      .collection("project_members")
      .doc(`${row.project_id}_${values.assigned_to}`)
      .get();
    if (!member.exists || member.get("status") !== "active" || !assignee) throw new AppError("ASSIGNEE_NOT_MEMBER");
  }
  const nextTeamId = values.team_id !== undefined ? values.team_id : row.team_id;
  const nextAssignee = values.assigned_to !== undefined ? values.assigned_to : row.assigned_to;
  if (nextTeamId !== null && nextTeamId !== undefined) {
    const db = firebaseAdminFirestore();
    const team = await db.collection("teams").doc(String(nextTeamId)).get();
    if (!team.exists || team.get("project_id") !== row.project_id || team.get("status") !== "active")
      throw new AppError("INVALID_INPUT");
    if (nextAssignee) {
      const membership = await db
        .collection("team_members")
        .doc(`${String(nextTeamId)}_${String(nextAssignee)}`)
        .get();
      if (!membership.exists || membership.get("status") !== "active") throw new AppError("ASSIGNEE_NOT_MEMBER");
    }
  }
}

async function mutateInsert(uid: string, table: string, item: Row): Promise<Row> {
  const db = firebaseAdminFirestore();
  const id = typeof item.id === "string" ? item.id : crypto.randomUUID();
  const ref = db.collection(table).doc(id);
  if ((await ref.get()).exists) throw Object.assign(new Error("Conflict"), { code: "23505" });
  const now = nowIso();
  let row: Row = { ...item, id, created_at: item.created_at ?? now, updated_at: item.updated_at ?? now };

  if (table === "tasks") {
    const allowedFields = new Set([
      "project_id",
      "title",
      "description",
      "expected_output",
      "required_deliverables",
      "status",
      "priority",
      "assigned_to",
      "team_id",
      "due_date",
    ]);
    if (Object.keys(item).some((key) => !allowedFields.has(key))) throw new AppError("INVALID_INPUT");
    const access = await getProjectAccess(uid, String(item.project_id));
    if (!canIn(access, "tasks.create")) throw new AppError("PERMISSION_DENIED");
    if (
      typeof item.title !== "string" ||
      item.title.length < 2 ||
      item.title.length > 200 ||
      typeof item.description !== "string" ||
      item.description.length > 10000 ||
      typeof item.expected_output !== "string" ||
      item.expected_output.length > 5000 ||
      typeof item.required_deliverables !== "string" ||
      item.required_deliverables.length > 10000 ||
      !TASK_PRIORITIES.includes(item.priority) ||
      item.status !== "todo" ||
      (item.due_date !== null && !validDateString(item.due_date))
    )
      throw new AppError("INVALID_INPUT");
    row = { ...row, created_by: uid, completed_at: null };
    if (row.assigned_to !== null && row.assigned_to !== uid && !can(access!, "tasks.assign"))
      throw new AppError("TASK_ASSIGN_FORBIDDEN");
    if (row.assigned_to) {
      const member = await db.collection("project_members").doc(`${row.project_id}_${row.assigned_to}`).get();
      if (!member.exists || member.get("status") !== "active") throw new AppError("ASSIGNEE_NOT_MEMBER");
    }
    if (row.team_id !== null && row.team_id !== undefined) {
      const team = await db.collection("teams").doc(String(row.team_id)).get();
      if (!team.exists || team.get("project_id") !== row.project_id || team.get("status") !== "active")
        throw new AppError("INVALID_INPUT");
      if (row.assigned_to) {
        const membership = await db
          .collection("team_members")
          .doc(`${String(row.team_id)}_${String(row.assigned_to)}`)
          .get();
        if (!membership.exists || membership.get("status") !== "active") throw new AppError("ASSIGNEE_NOT_MEMBER");
      }
    }
  } else if (table === "documents") {
    const allowedFields = new Set([
      "project_id",
      "title",
      "description",
      "file_name",
      "storage_path",
      "mime_type",
      "size_bytes",
      "authorized_users",
    ]);
    if (Object.keys(item).some((key) => !allowedFields.has(key))) throw new AppError("INVALID_INPUT");
    const access = await getProjectAccess(uid, String(item.project_id));
    if (!canIn(access, "documents.upload")) throw new AppError("PERMISSION_DENIED");
    const fileName = typeof item.file_name === "string" ? item.file_name : "";
    const fileType = resolveFileType(fileName);
    if (
      typeof item.storage_path !== "string" ||
      item.storage_path !== documentStoragePath(String(item.project_id), id, fileName) ||
      !isDocumentPathFor(String(item.project_id), id, item.storage_path) ||
      !fileType
    )
      throw new AppError("INVALID_INPUT");
    const file = firebaseAdminStorage().file(item.storage_path);
    const [exists] = await file.exists();
    if (!exists) throw new AppError("DOCUMENT_FILE_MISSING");
    const [metadata] = await file.getMetadata();
    const actualSize = Number(metadata.size ?? 0);
    const actualMimeType = String(metadata.contentType ?? "");
    if (actualSize <= 0 || actualSize > MAX_UPLOAD_BYTES || actualMimeType !== fileType.mimeType)
      throw new AppError("INVALID_INPUT");
    row = {
      ...row,
      uploaded_by: uid,
      size_bytes: actualSize,
      mime_type: actualMimeType,
      authorized_users: Array.isArray(item.authorized_users) ? item.authorized_users : [uid],
    };
  } else if (table === "comments") {
    const access = await getProjectAccess(uid, String(item.project_id));
    if (!canIn(access, "comments.create")) throw new AppError("PERMISSION_DENIED");
    if (item.task_id) {
      const taskSnapshot = await db.collection("tasks").doc(String(item.task_id)).get();
      if (
        !taskSnapshot.exists ||
        taskSnapshot.get("project_id") !== item.project_id ||
        !(await taskVisible(normalizeRow(taskSnapshot.data()), access, uid))
      )
        throw new AppError("NOT_FOUND");
    }
    row = { ...row, author_id: uid };
  } else {
    throw new AppError("PERMISSION_DENIED");
  }

  await ref.create(row);
  await writeActivity(
    uid,
    String(row.project_id),
    "created",
    table === "tasks" ? "task" : table === "documents" ? "document" : "comment",
    id,
    row.title ?? row.file_name ?? null,
    null,
    row,
  );
  if (table === "tasks" && row.assigned_to && row.assigned_to !== uid) {
    await notifyUser(String(row.assigned_to), String(row.project_id), row, "task_assigned");
  }
  return row;
}

async function mutateUpdate(uid: string, table: string, row: Row, values: Row): Promise<Row> {
  const db = firebaseAdminFirestore();
  const ref = db.collection(table).doc(String(row.id));
  const patch: Row = { ...values, updated_at: nowIso() };
  const projectId = String(row.project_id ?? "");
  if (table === "tasks") {
    await assertTaskMutation(uid, row, values);
    if (values.status === "completed") patch.completed_at = nowIso();
    if (values.status && values.status !== "completed") patch.completed_at = null;
    await ref.update(patch);
    await writeActivity(uid, projectId, "updated", "task", String(row.id), row.title ?? null, row, {
      ...row,
      ...patch,
    });
    const changedTask = { ...row, ...patch };
    if (values.status === "review" && row.status !== "review") await notifyTaskReviewers(projectId, changedTask);
    if (values.status === "revision_required" && row.assigned_to)
      await notifyUser(String(row.assigned_to), projectId, changedTask, "revision_requested");
    if (values.status === "completed" && row.assigned_to)
      await notifyUser(String(row.assigned_to), projectId, changedTask, "submission_approved");
    if (values.assigned_to && values.assigned_to !== row.assigned_to)
      await notifyUser(String(values.assigned_to), projectId, changedTask, "task_assigned");
  } else if (table === "projects") {
    const access = await getProjectAccess(uid, projectId);
    if (!canIn(access, "project.edit")) throw new AppError("PERMISSION_DENIED");
    const allowed = [
      "name",
      "description",
      "research_goal",
      "research_type",
      "research_objectives",
      "research_questions",
      "methodology",
      "status",
      "priority",
      "start_date",
      "deadline",
    ];
    if (Object.keys(values).some((key) => !allowed.includes(key))) throw new AppError("INVALID_INPUT");
    if (
      ["research_type", "research_objectives", "research_questions", "methodology"].some(
        (key) => values[key] !== undefined && (typeof values[key] !== "string" || values[key].length > 5000),
      )
    )
      throw new AppError("INVALID_INPUT");
    if (values.priority !== undefined && !TASK_PRIORITIES.includes(values.priority))
      throw new AppError("INVALID_INPUT");
    await ref.update(patch);
    await writeActivity(uid, projectId, "updated", "project", String(row.id), values.name ?? row.name ?? null, row, {
      ...row,
      ...patch,
    });
  } else if (table === "documents") {
    const access = await getProjectAccess(uid, projectId);
    if (!canIn(access, "documents.edit")) throw new AppError("PERMISSION_DENIED");
    if (Object.keys(values).some((key) => !["title", "description", "authorized_users"].includes(key)))
      throw new AppError("INVALID_INPUT");
    if (values.authorized_users !== undefined && !can(access!, "team.view")) throw new AppError("PERMISSION_DENIED");
    await ref.update(patch);
    await writeActivity(uid, projectId, "updated", "document", String(row.id), row.title ?? null, row, {
      ...row,
      ...patch,
    });
  } else if (table === "comments") {
    const access = await getProjectAccess(uid, projectId);
    if (!access || !canEditComment(access, row.author_id)) throw new AppError("PERMISSION_DENIED");
    if (Object.keys(values).some((key) => key !== "content")) throw new AppError("INVALID_INPUT");
    await ref.update(patch);
    await writeActivity(uid, projectId, "updated", "comment", String(row.id), null, row, { ...row, ...patch });
  } else if (table === "profiles") {
    if (row.id !== uid || Object.keys(values).some((key) => key !== "full_name"))
      throw new AppError("PERMISSION_DENIED");
    await ref.update({ full_name: values.full_name, updated_at: nowIso() });
    await writeActivity(uid, null, "updated", "profile", uid, values.full_name, row, { ...row, ...values });
  } else if (table === "notifications") {
    if (row.user_id !== uid || Object.keys(values).some((key) => key !== "read_at"))
      throw new AppError("PERMISSION_DENIED");
    await ref.update({ read_at: values.read_at ?? nowIso() });
  } else {
    throw new AppError("PERMISSION_DENIED");
  }
  return { ...row, ...patch };
}

async function deleteProjectCascade(projectId: string) {
  const db = firebaseAdminFirestore();
  for (const table of ["tasks", "documents", "comments", "project_members", "user_permissions"]) {
    const snapshots = await db.collection(table).where("project_id", "==", projectId).limit(5000).get();
    const batches: FirebaseFirestore.WriteBatch[] = [];
    let batch = db.batch();
    let count = 0;
    for (const doc of snapshots.docs) {
      batch.delete(doc.ref);
      if (++count % 400 === 0) {
        batches.push(batch);
        batch = db.batch();
      }
    }
    if (count % 400) batches.push(batch);
    await Promise.all(batches.map((item) => item.commit()));
  }
  await db.collection("projects").doc(projectId).delete();
}

async function mutateDelete(uid: string, table: string, row: Row): Promise<Row> {
  const db = firebaseAdminFirestore();
  const projectId = String(row.project_id ?? row.id ?? "");
  if (table === "projects") {
    const access = await getProjectAccess(uid, projectId);
    if (!canIn(access, "project.delete")) throw new AppError("PERMISSION_DENIED");
    await writeActivity(uid, projectId, "deleted", "project", projectId, row.name ?? null, row, null);
    await deleteProjectCascade(projectId);
  } else if (table === "tasks") {
    const access = await getProjectAccess(uid, projectId);
    if (!canIn(access, "tasks.delete")) throw new AppError("PERMISSION_DENIED");
    await db.collection("tasks").doc(String(row.id)).delete();
    await writeActivity(uid, projectId, "deleted", "task", String(row.id), row.title ?? null, row, null);
  } else if (table === "documents") {
    const access = await getProjectAccess(uid, projectId);
    if (!canIn(access, "documents.delete")) throw new AppError("PERMISSION_DENIED");
    await db.collection("documents").doc(String(row.id)).delete();
    await writeActivity(uid, projectId, "deleted", "document", String(row.id), row.title ?? null, row, null);
  } else if (table === "comments") {
    const access = await getProjectAccess(uid, projectId);
    if (!access || !canDeleteComment(access, row.author_id)) throw new AppError("PERMISSION_DENIED");
    await db.collection("comments").doc(String(row.id)).delete();
    await writeActivity(uid, projectId, "deleted", "comment", String(row.id), null, row, null);
  } else {
    throw new AppError("PERMISSION_DENIED");
  }
  return row;
}

class FirestoreQueryBuilder implements PromiseLike<CompatResponse<Row[]>> {
  private readonly filters: Condition[] = [];
  private readonly orders: Order[] = [];
  private queryMode: "select" | "insert" | "update" | "delete" = "select";
  private insertValues: Row | Row[] | null = null;
  private updateValues: Row | null = null;
  private selected = "*";
  private rowLimit: number | null = null;
  private rangeStart = 0;
  private rangeEnd: number | null = null;
  private countRequested = false;

  constructor(
    private readonly table: string,
    private readonly uid: string,
  ) {}
  select(fields = "*", options?: { count?: string }): this {
    this.selected = fields;
    if (options?.count) this.countRequested = true;
    return this;
  }
  eq(field: string, value: unknown): this {
    this.filters.push({ field, op: "eq", value });
    return this;
  }
  neq(field: string, value: unknown): this {
    this.filters.push({ field, op: "neq", value });
    return this;
  }
  is(field: string, value: unknown): this {
    this.filters.push({ field, op: "is", value });
    return this;
  }
  in(field: string, value: unknown[]): this {
    this.filters.push({ field, op: "in", value });
    return this;
  }
  not(field: string, operator: string, value: unknown): this {
    this.filters.push({ field, op: operator === "in" ? "not_in" : `not_${operator}`, value });
    return this;
  }
  lt(field: string, value: unknown): this {
    this.filters.push({ field, op: "lt", value });
    return this;
  }
  lte(field: string, value: unknown): this {
    this.filters.push({ field, op: "lte", value });
    return this;
  }
  gt(field: string, value: unknown): this {
    this.filters.push({ field, op: "gt", value });
    return this;
  }
  gte(field: string, value: unknown): this {
    this.filters.push({ field, op: "gte", value });
    return this;
  }
  ilike(field: string, value: unknown): this {
    this.filters.push({ field, op: "ilike", value });
    return this;
  }
  like(field: string, value: unknown): this {
    this.filters.push({ field, op: "like", value });
    return this;
  }
  or(value: string): this {
    this.filters.push({ field: "", op: "or", value });
    return this;
  }
  order(field: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orders.push({ field, ascending: options?.ascending ?? true, nullsFirst: options?.nullsFirst });
    return this;
  }
  limit(value: number): this {
    this.rowLimit = Math.max(0, Math.floor(value));
    return this;
  }
  range(from: number, to: number): this {
    this.rangeStart = Math.max(0, from);
    this.rangeEnd = Math.max(from - 1, to);
    return this;
  }
  insert(values: Row | Row[]): this {
    this.queryMode = "insert";
    this.insertValues = values;
    return this;
  }
  update(values: Row): this {
    this.queryMode = "update";
    this.updateValues = values;
    return this;
  }
  delete(): this {
    this.queryMode = "delete";
    return this;
  }

  async single(): Promise<CompatResponse<Row>> {
    const result = await this.execute();
    if (result.error) return { ...result, data: null as never };
    if (result.data.length !== 1) return { data: null as never, error: failure("PGRST116", "No row found") };
    return { data: result.data[0]!, error: null };
  }
  async maybeSingle(): Promise<CompatResponse<Row | null>> {
    const result = await this.execute();
    if (result.error) return { ...result, data: null };
    if (result.data.length > 1) return { data: null, error: failure("PGRST116", "Multiple rows found") };
    return { data: result.data[0] ?? null, error: null };
  }
  then<TResult1 = CompatResponse<Row[]>, TResult2 = never>(
    onfulfilled?: ((value: CompatResponse<Row[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private async execute(): Promise<CompatResponse<Row[]>> {
    try {
      if (!COLLECTIONS.has(this.table) && !["permissions", "role_permissions"].includes(this.table))
        throw new Error(`Unsupported Firestore collection: ${this.table}`);
      if (this.table === "activity_logs" && this.queryMode !== "select") throw new AppError("ACTIVITY_LOG_IMMUTABLE");
      if (["project_members", "user_permissions"].includes(this.table) && this.queryMode !== "select")
        throw new AppError("PERMISSION_DENIED");
      if (["permissions", "role_permissions"].includes(this.table) && this.queryMode !== "select")
        throw new AppError("PERMISSION_DENIED");

      if (this.queryMode === "insert") {
        const values = Array.isArray(this.insertValues) ? this.insertValues : [this.insertValues ?? {}];
        const data = await Promise.all(values.map((value) => mutateInsert(this.uid, this.table, value)));
        return { data: await loadRelations(data, this.table, this.selected), error: null, count: data.length };
      }

      let rows = await loadVisibleRows(this.table, this.uid, this.filters);
      rows = rows.filter((row) => this.filters.every((condition) => applyCondition(row, condition)));
      const total = rows.length;
      for (const order of [...this.orders].reverse()) {
        rows.sort((left, right) => {
          const a = fieldValue(left, order.field);
          const b = fieldValue(right, order.field);
          if (a == null || b == null) {
            const nullFirst = order.nullsFirst ?? order.ascending;
            return a == null && b == null ? 0 : a == null ? (nullFirst ? -1 : 1) : nullFirst ? 1 : -1;
          }
          const result = compareValues(a, b);
          return order.ascending ? result : -result;
        });
      }

      if (this.queryMode === "update") {
        const changed = await Promise.all(
          rows.map((row) => mutateUpdate(this.uid, this.table, row, this.updateValues ?? {})),
        );
        return { data: await loadRelations(changed, this.table, this.selected), error: null, count: changed.length };
      }
      if (this.queryMode === "delete") {
        const deleted = await Promise.all(rows.map((row) => mutateDelete(this.uid, this.table, row)));
        return { data: deleted, error: null, count: deleted.length };
      }
      const from = this.rangeEnd === null ? 0 : this.rangeStart;
      const to = this.rangeEnd === null ? (this.rowLimit === null ? rows.length : this.rowLimit) : this.rangeEnd + 1;
      rows = rows.slice(from, this.rowLimit === null ? to : Math.min(to, from + this.rowLimit));
      rows = await loadRelations(rows, this.table, this.selected);
      return { data: rows, error: null, count: this.countRequested ? total : null };
    } catch (error) {
      return responseError(error) as CompatResponse<Row[]>;
    }
  }
}

function updateRolePermissions(member: Row, role: ProjectRole, reset: boolean) {
  return reset || !Array.isArray(member.permissions)
    ? [...ROLE_TEMPLATES[role]]
    : member.permissions.filter(isPermissionKey);
}

async function addMember(uid: string, args: Row) {
  const projectId = String(args.p_project_id ?? "");
  const access = await getProjectAccess(uid, projectId);
  if (!canIn(access, "members.add")) throw new AppError("PERMISSION_DENIED");
  const email = String(args.p_email ?? "")
    .trim()
    .toLowerCase();
  const role = args.p_role as ProjectRole;
  if (!(role in ROLE_TEMPLATES) || role === "owner") throw new AppError("ROLE_NOT_ALLOWED");
  const profiles = await firebaseAdminFirestore()
    .collection("profiles")
    .where("email_lower", "==", email)
    .limit(2)
    .get();
  const profile = profiles.docs[0];
  if (!profile) throw new AppError("USER_NOT_FOUND");
  const id = `${projectId}_${profile.id}`;
  const ref = firebaseAdminFirestore().collection("project_members").doc(id);
  if ((await ref.get()).exists) throw new AppError("ALREADY_MEMBER");
  const permissions = [...ROLE_TEMPLATES[role]];
  await ref.create({
    id,
    project_id: projectId,
    user_id: profile.id,
    role,
    status: "active",
    permissions,
    joined_at: nowIso(),
    updated_at: nowIso(),
  });
  await writeActivity(uid, projectId, "member_added", "member", profile.id, profile.get("full_name") ?? email, null, {
    role,
    email,
  });
  return { status: "added", email };
}

async function updateMember(uid: string, args: Row) {
  const projectId = String(args.p_project_id ?? "");
  const targetId = String(args.p_user_id ?? "");
  const actor = await getProjectAccess(uid, projectId);
  if (!canIn(actor, "members.manage")) throw new AppError("PERMISSION_DENIED");
  const ref = firebaseAdminFirestore().collection("project_members").doc(`${projectId}_${targetId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError("MEMBER_NOT_FOUND");
  const member = snap.data() as Row;
  if (member.role === "owner") throw new AppError("CANNOT_MODIFY_OWNER");
  if (targetId === uid) throw new AppError("CANNOT_MODIFY_SELF");
  const nextRole = (args.p_role ?? member.role) as ProjectRole;
  if (nextRole === "owner" || !(nextRole in ROLE_TEMPLATES)) throw new AppError("ROLE_NOT_ALLOWED");
  const permissions = updateRolePermissions(member, nextRole, args.p_reset_permissions !== false);
  await ref.update({ role: nextRole, status: args.p_status ?? member.status, permissions, updated_at: nowIso() });
  await writeActivity(
    uid,
    projectId,
    "member_updated",
    "member",
    targetId,
    null,
    { role: member.role, status: member.status },
    { role: nextRole, status: args.p_status ?? member.status },
  );
  return { user_id: targetId };
}

async function setMemberPermissions(uid: string, args: Row) {
  const projectId = String(args.p_project_id ?? "");
  const targetId = String(args.p_user_id ?? "");
  const actor = await getProjectAccess(uid, projectId);
  if (!canIn(actor, "permissions.manage")) throw new AppError("PERMISSION_DENIED");
  const ref = firebaseAdminFirestore().collection("project_members").doc(`${projectId}_${targetId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError("MEMBER_NOT_FOUND");
  const member = snap.data() as Row;
  if (member.role === "owner") throw new AppError("CANNOT_MODIFY_OWNER");
  const keys = Array.isArray(args.p_permissions) ? args.p_permissions : [];
  if (keys.some((key: unknown) => !isPermissionKey(key))) throw new AppError("UNKNOWN_PERMISSION");
  const next = [...new Set(keys as PermissionKey[])];
  if (actor?.role !== "owner" && next.some((key) => !can(actor!, key))) throw new AppError("PERMISSION_ESCALATION");
  const old = permissionArray(member);
  await ref.update({ permissions: next, updated_at: nowIso() });
  const permissionsRef = firebaseAdminFirestore().collection("user_permissions");
  const oldDocs = await permissionsRef.where("project_id", "==", projectId).where("user_id", "==", targetId).get();
  const batch = firebaseAdminFirestore().batch();
  oldDocs.docs.forEach((doc) => batch.delete(doc.ref));
  next.forEach((key) =>
    batch.set(permissionsRef.doc(`${projectId}_${targetId}_${key}`), {
      id: `${projectId}_${targetId}_${key}`,
      project_id: projectId,
      user_id: targetId,
      permission_key: key,
    }),
  );
  await batch.commit();
  await writeActivity(
    uid,
    projectId,
    "permissions_updated",
    "permissions",
    targetId,
    null,
    { permissions: old },
    { permissions: next },
  );
  return next;
}

async function rpcCall(uid: string, name: string, args: Row): Promise<unknown> {
  const db = firebaseAdminFirestore();
  switch (name) {
    case "get_my_project_access": {
      const items = await listAccess(uid);
      return items
        .filter((item) => item.status === "active" && can(item, "project.view"))
        .map((item) => ({
          project_id: item.projectId,
          project_name: item.projectName,
          project_status: item.projectStatus,
          role: item.role,
          member_status: item.status,
          permissions: [...item.permissions],
        }));
    }
    case "create_project": {
      const profile = await getProfile(uid);
      if (!profile?.is_platform_admin && !profile?.can_create_projects) throw new AppError("PROJECT_CREATE_FORBIDDEN");
      const projectId = crypto.randomUUID();
      const now = nowIso();
      const project = {
        id: projectId,
        name: args.p_name,
        description: args.p_description ?? "",
        research_goal: args.p_research_goal ?? "",
        research_type: args.p_research_type ?? "",
        research_objectives: args.p_research_objectives ?? "",
        research_questions: args.p_research_questions ?? "",
        methodology: args.p_methodology ?? "",
        status: args.p_status ?? "planning",
        priority: TASK_PRIORITIES.includes(args.p_priority) ? args.p_priority : "medium",
        start_date: args.p_start_date ?? null,
        deadline: args.p_deadline ?? null,
        created_by: uid,
        created_at: now,
        updated_at: now,
      };
      const member = {
        id: `${projectId}_${uid}`,
        project_id: projectId,
        user_id: uid,
        role: "owner",
        status: "active",
        permissions: [...PERMISSION_KEYS],
        joined_at: now,
        updated_at: now,
      };
      const batch = db.batch();
      batch.create(db.collection("projects").doc(projectId), project);
      batch.create(db.collection("project_members").doc(member.id), member);
      await batch.commit();
      await writeActivity(uid, projectId, "created", "project", projectId, String(args.p_name), null, project);
      return projectId;
    }
    case "add_project_member":
      return addMember(uid, args);
    case "update_project_member":
      return updateMember(uid, args);
    case "remove_project_member": {
      const projectId = String(args.p_project_id ?? "");
      const targetId = String(args.p_user_id ?? "");
      const access = await getProjectAccess(uid, projectId);
      if (!canIn(access, "members.remove")) throw new AppError("PERMISSION_DENIED");
      const ref = db.collection("project_members").doc(`${projectId}_${targetId}`);
      const target = await ref.get();
      if (!target.exists) throw new AppError("MEMBER_NOT_FOUND");
      if (target.get("role") === "owner") throw new AppError("CANNOT_MODIFY_OWNER");
      if (targetId === uid) throw new AppError("CANNOT_MODIFY_SELF");
      const batch = db.batch();
      batch.delete(ref);
      const grants = await db
        .collection("user_permissions")
        .where("project_id", "==", projectId)
        .where("user_id", "==", targetId)
        .get();
      grants.docs.forEach((doc) => batch.delete(doc.ref));
      const tasks = await db
        .collection("tasks")
        .where("project_id", "==", projectId)
        .where("assigned_to", "==", targetId)
        .get();
      tasks.docs.forEach((doc) => batch.update(doc.ref, { assigned_to: null, updated_at: nowIso() }));
      await batch.commit();
      await writeActivity(
        uid,
        projectId,
        "member_removed",
        "member",
        targetId,
        null,
        { role: target.get("role") },
        null,
      );
      return { user_id: targetId };
    }
    case "set_member_permissions":
      return setMemberPermissions(uid, args);
    case "transfer_project_ownership": {
      const projectId = String(args.p_project_id ?? "");
      const newOwnerId = String(args.p_new_owner_id ?? "");
      const access = await getProjectAccess(uid, projectId);
      if (!access?.isOwner) throw new AppError("PERMISSION_DENIED");
      const oldRef = db.collection("project_members").doc(`${projectId}_${uid}`);
      const newRef = db.collection("project_members").doc(`${projectId}_${newOwnerId}`);
      const newSnap = await newRef.get();
      if (!newSnap.exists || newSnap.get("status") !== "active") throw new AppError("MEMBER_NOT_FOUND");
      const batch = db.batch();
      batch.update(oldRef, { role: "manager", permissions: [...ROLE_TEMPLATES.manager], updated_at: nowIso() });
      batch.update(newRef, { role: "owner", permissions: [...PERMISSION_KEYS], updated_at: nowIso() });
      await batch.commit();
      await writeActivity(
        uid,
        projectId,
        "ownership_transferred",
        "project",
        projectId,
        null,
        { owner_id: uid },
        { owner_id: newOwnerId },
      );
      return null;
    }
    case "get_project_team": {
      const projectId = String(args.p_project_id ?? "");
      const access = await getProjectAccess(uid, projectId);
      if (!canIn(access, "team.view")) throw new AppError("PERMISSION_DENIED");
      const members = await db.collection("project_members").where("project_id", "==", projectId).limit(300).get();
      const data = await Promise.all(
        members.docs.map(async (doc) => {
          const member = normalize(doc.data()) as Row;
          const [profile, tasks, activities] = await Promise.all([
            getProfile(String(member.user_id)),
            db
              .collection("tasks")
              .where("project_id", "==", projectId)
              .where("assigned_to", "==", member.user_id)
              .limit(1000)
              .get(),
            db
              .collection("activity_logs")
              .where("project_id", "==", projectId)
              .where("actor_id", "==", member.user_id)
              .limit(100)
              .get(),
          ]);
          const taskRows = tasks.docs.map(rowFromSnapshot);
          const activityRows = activities.docs.map((item) => item.data());
          const permissions = permissionArray(member);
          return {
            user_id: member.user_id,
            full_name: profile?.full_name ?? "",
            email: profile?.email ?? null,
            role: member.role,
            status: member.status,
            joined_at: member.joined_at,
            last_sign_in_at: profile?.last_sign_in_at ?? null,
            permissions,
            assigned_open_tasks: taskRows.filter((task) => !["completed", "rejected"].includes(String(task.status)))
              .length,
            assigned_total_tasks: taskRows.length,
            last_activity_at:
              activityRows
                .map((item) => String(item.created_at ?? ""))
                .sort()
                .at(-1) ?? null,
          };
        }),
      );
      return data;
    }
    case "get_dashboard_stats": {
      const accesses = (await listAccess(uid)).filter((item) => item.status === "active" && can(item, "project.view"));
      const projects = accesses.map((item) => ({
        id: item.projectId,
        name: item.projectName,
        status: item.projectStatus,
      }));
      const visibleTasks: Row[] = [];
      for (const access of accesses) {
        const items = await queryForProject("tasks", access.projectId);
        visibleTasks.push(...(await filterAsync(items, (task) => taskVisible(task, access, uid))));
      }
      const statusCounts: Row = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0]));
      const byProject = new Map<string, Row>();
      const byMember = new Map<string, Row>();
      const accessByProject = new Map(accesses.map((item) => [item.projectId, item]));
      for (const task of visibleTasks) {
        const status = String(task.status);
        if (status in statusCounts) statusCounts[status]++;
        const project = projects.find((item) => item.id === task.project_id);
        if (project) {
          const progress = byProject.get(project.id) ?? {
            project_id: project.id,
            name: project.name,
            status: project.status,
            total: 0,
            completed: 0,
          };
          progress.total++;
          if (status === "completed") progress.completed++;
          byProject.set(project.id, progress);
        }
        const projectAccess = accessByProject.get(String(task.project_id));
        if (task.assigned_to != null && task.assigned_to !== uid && !canIn(projectAccess ?? null, "team.view"))
          continue;
        const memberId = String(task.assigned_to ?? uid);
        const member = byMember.get(memberId) ?? { user_id: memberId, name: "", total: 0, open: 0, completed: 0 };
        member.total++;
        if (status === "completed") member.completed++;
        else if (!["rejected"].includes(status)) member.open++;
        byMember.set(memberId, member);
      }
      for (const [memberId, row] of byMember) {
        const profile = await getProfile(memberId);
        row.name = profile?.full_name ?? profile?.email ?? "";
      }
      const visibleTeamAccess = accesses.some((item) => can(item, "team.view"));
      let teamMembers = 0;
      if (visibleTeamAccess) {
        const ids = new Set<string>();
        for (const access of accesses.filter((item) => can(item, "team.view"))) {
          const members = await db
            .collection("project_members")
            .where("project_id", "==", access.projectId)
            .where("status", "==", "active")
            .limit(300)
            .get();
          members.docs.forEach((doc) => ids.add(String(doc.get("user_id"))));
        }
        teamMembers = ids.size;
      }
      const today = String(args.p_today ?? nowIso().slice(0, 10));
      const activeTasks = visibleTasks.filter((task) => !["completed", "rejected"].includes(String(task.status)));
      return {
        total_projects: projects.length,
        active_projects: projects.filter((item) => item.status === "active").length,
        total_tasks: visibleTasks.length,
        active_tasks: activeTasks.length,
        completed_tasks: visibleTasks.filter((task) => task.status === "completed").length,
        overdue_tasks: activeTasks.filter((task) => typeof task.due_date === "string" && task.due_date < today).length,
        can_view_team: visibleTeamAccess,
        team_members: teamMembers,
        tasks_by_status: statusCounts,
        tasks_by_member: [...byMember.values()],
        project_progress: [...byProject.values()],
      };
    }
    case "admin_update_user_flags": {
      const profile = await getProfile(uid);
      if (!profile?.is_platform_admin) throw new AppError("PERMISSION_DENIED");
      const targetId = String(args.p_user_id ?? "");
      const targetRef = db.collection("profiles").doc(targetId);
      const target = await targetRef.get();
      if (!target.exists) throw new AppError("USER_NOT_FOUND");
      if (targetId === uid && profile.is_platform_admin && args.p_is_platform_admin === false) {
        const admins = await db.collection("profiles").where("is_platform_admin", "==", true).get();
        if (admins.size < 2) throw new AppError("LAST_PLATFORM_ADMIN");
      }
      const nextIsPlatformAdmin = args.p_is_platform_admin === true;
      const claimChanged = await syncPlatformAdminClaim(targetId, nextIsPlatformAdmin);
      await targetRef.update({
        is_platform_admin: nextIsPlatformAdmin,
        can_create_projects: args.p_can_create_projects === true,
        updated_at: nowIso(),
      });
      if (claimChanged) await firebaseAdminAuth().revokeRefreshTokens(targetId);
      await writeActivity(
        uid,
        null,
        "platform_flags_updated",
        "platform_user",
        targetId,
        target.get("email") ?? null,
        {
          is_platform_admin: target.get("is_platform_admin"),
          can_create_projects: target.get("can_create_projects"),
        },
        {
          is_platform_admin: nextIsPlatformAdmin,
          can_create_projects: args.p_can_create_projects === true,
        },
      );
      return null;
    }
    case "record_project_export": {
      const projectId = String(args.p_project_id ?? "");
      const access = await getProjectAccess(uid, projectId);
      if (!canIn(access, "data.export")) throw new AppError("PERMISSION_DENIED");
      await writeActivity(uid, projectId, "exported", "project", projectId, null, null, {
        format: args.p_format,
        scope: args.p_scope,
      });
      return null;
    }
    default:
      throw new Error(`Unsupported Firebase operation: ${name}`);
  }
}

class FirebaseCompatClient {
  constructor(private readonly user: SessionUser | null) {}
  from(table: string) {
    if (!this.user) throw new AppError("NOT_AUTHENTICATED");
    return new FirestoreQueryBuilder(table, this.user.id);
  }
  async rpc(name: string, args: Row = {}): Promise<CompatResponse<RowValue>> {
    if (!this.user) return { data: null, error: failure("NOT_AUTHENTICATED", "NOT_AUTHENTICATED") };
    try {
      return { data: await rpcCall(this.user.id, name, args), error: null };
    } catch (error) {
      return responseError(error);
    }
  }
  storage = {
    from: (bucket: string) => {
      const actualBucket = firebaseAdminStorage();
      if (bucket !== "default" && bucket !== actualBucket.name) throw new Error("Unknown Firebase Storage bucket.");
      return {
        createSignedUploadUrl: async (path: string, options?: { contentType?: string; maxBytes?: number }) => {
          try {
            if (!this.user) throw new AppError("NOT_AUTHENTICATED");
            const segments = path.split("/");
            const access = segments[0] ? await getProjectAccess(this.user.id, segments[0]) : null;
            if (!canIn(access, "documents.upload")) throw new AppError("PERMISSION_DENIED");
            const file = actualBucket.file(path);
            const [policy] = await file.generateSignedPostPolicyV4({
              expires: Date.now() + 5 * 60 * 1000,
              fields: {
                "Content-Type": options?.contentType ?? "application/octet-stream",
                success_action_status: "201",
              },
              conditions: [
                ["content-length-range", 1, options?.maxBytes ?? 50 * 1024 * 1024],
                ["eq", "$Content-Type", options?.contentType ?? "application/octet-stream"],
              ],
            });
            return { data: { signedUrl: policy.url, signedFields: policy.fields, path }, error: null };
          } catch (error) {
            return responseError(error);
          }
        },
        createSignedUrl: async (path: string, expiresIn: number, options?: { download?: string | boolean }) => {
          try {
            if (!this.user) throw new AppError("NOT_AUTHENTICATED");
            const [projectId, documentId] = path.split("/");
            const access = projectId ? await getProjectAccess(this.user.id, projectId) : null;
            const document = documentId
              ? await firebaseAdminFirestore().collection("documents").doc(documentId).get()
              : null;
            if (
              !document?.exists ||
              !(await documentVisible(normalizeRow(document.data()), access, this.user.id)) ||
              document.get("storage_path") !== path
            ) {
              throw new AppError("NOT_FOUND");
            }
            const responseDisposition =
              typeof options?.download === "string"
                ? `attachment; filename*=UTF-8''${encodeURIComponent(options.download)}`
                : options?.download
                  ? "attachment"
                  : "inline";
            const [signedUrl] = await actualBucket.file(path).getSignedUrl({
              version: "v4",
              action: "read",
              expires: Date.now() + Math.min(Math.max(expiresIn, 30), 300) * 1000,
              responseDisposition,
            });
            return { data: { signedUrl }, error: null };
          } catch (error) {
            return responseError(error);
          }
        },
        remove: async (paths: string[]) => {
          try {
            if (!this.user) throw new AppError("NOT_AUTHENTICATED");
            for (const path of paths) {
              const [projectId, documentId] = path.split("/");
              const access = projectId ? await getProjectAccess(this.user.id, projectId) : null;
              if (path.split("/").length !== 3 || !projectId || !documentId) throw new AppError("INVALID_INPUT");
              const doc = await firebaseAdminFirestore().collection("documents").doc(documentId).get();
              const mayDelete = canIn(access, "documents.delete") && (!doc.exists || doc.get("storage_path") === path);
              const mayDiscardOwnUpload = canIn(access, "documents.upload") && !doc.exists;
              if (!mayDelete && !mayDiscardOwnUpload) throw new AppError("PERMISSION_DENIED");
              await actualBucket.file(path).delete({ ignoreNotFound: true });
            }
            return { data: null, error: null };
          } catch (error) {
            return responseError(error);
          }
        },
        list: async (prefix: string, options?: { limit?: number }) => {
          try {
            if (!this.user) throw new AppError("NOT_AUTHENTICATED");
            const projectId = prefix.split("/")[0];
            const access = projectId ? await getProjectAccess(this.user.id, projectId) : null;
            if (!canIn(access, "documents.delete")) throw new AppError("PERMISSION_DENIED");
            const [files] = await actualBucket.getFiles({
              prefix: `${prefix.replace(/\/$/, "")}/`,
              maxResults: options?.limit ?? 1000,
            });
            return { data: files.map((file) => ({ name: file.name.split("/").at(-1) ?? file.name })), error: null };
          } catch (error) {
            return responseError(error);
          }
        },
      };
    },
  };
}

export async function createFirebaseServerClient() {
  return new FirebaseCompatClient(await getSessionUser());
}

export function createFirebaseAdminClient() {
  return {
    auth: firebaseAdminAuth(),
    firestore: firebaseAdminFirestore(),
    storage: firebaseAdminStorage(),
  };
}
