import { createHash } from "node:crypto";

export const SOURCE_TABLES = [
  "profiles",
  "projects",
  "project_members",
  "permissions",
  "role_permissions",
  "user_permissions",
  "tasks",
  "documents",
  "comments",
  "activity_logs",
];
const COLLECTIONS = [
  "profiles",
  "projects",
  "project_members",
  "user_permissions",
  "tasks",
  "documents",
  "comments",
  "activity_logs",
];
const PERMISSIONS = [
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
  "tasks.update_progress",
  "tasks.add_work_notes",
  "tasks.submit",
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
];
const PERMISSION_SET = new Set(PERMISSIONS);
const ROLES = new Set(["owner", "manager", "member", "reviewer"]);
const ROLE_DEFAULTS = {
  owner: PERMISSIONS,
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
  member: [
    "project.view",
    "tasks.view",
    "tasks.create",
    "tasks.edit_own",
    "tasks.edit_assigned",
    "documents.view",
    "documents.upload",
    "comments.create",
    "team.view",
  ],
  reviewer: ["project.view", "tasks.review", "comments.create"],
};
const ENUMS = {
  projectStatus: new Set(["planning", "active", "on_hold", "completed", "archived"]),
  memberStatus: new Set(["active", "suspended"]),
  taskStatus: new Set([
    "assigned",
    "accepted",
    "in_progress",
    "submitted",
    "under_review",
    "revision_required",
    "approved",
    "completed",
    "cancelled",
  ]),
  taskPriority: new Set(["low", "medium", "high", "urgent"]),
  entityType: new Set(["project", "task", "document", "comment", "member", "permissions", "platform_user"]),
};
const FIELDS = {
  profiles: ["id", "email", "full_name", "avatar_url", "last_sign_in_at", "created_at", "updated_at"],
  projects: [
    "id",
    "name",
    "description",
    "research_goal",
    "status",
    "start_date",
    "deadline",
    "created_by",
    "created_at",
    "updated_at",
  ],
  project_members: ["project_id", "user_id", "role", "status", "added_by", "created_at", "updated_at"],
  permissions: ["key", "category", "sort_order", "description"],
  role_permissions: ["role", "permission_key"],
  user_permissions: ["project_id", "user_id", "permission_key", "granted_by", "created_at"],
  tasks: [
    "id",
    "project_id",
    "title",
    "description",
    "status",
    "priority",
    "assigned_to",
    "created_by",
    "due_date",
    "completed_at",
    "created_at",
    "updated_at",
  ],
  documents: [
    "id",
    "project_id",
    "title",
    "description",
    "file_name",
    "storage_path",
    "mime_type",
    "size_bytes",
    "uploaded_by",
    "created_at",
    "updated_at",
  ],
  comments: ["id", "project_id", "task_id", "author_id", "content", "created_at", "updated_at"],
  activity_logs: [
    "id",
    "project_id",
    "actor_id",
    "actor_name",
    "actor_email",
    "action",
    "entity_type",
    "entity_id",
    "entity_label",
    "old_values",
    "new_values",
    "metadata",
    "created_at",
  ],
};
const REQUIRED = {
  profiles: ["id"],
  projects: ["id", "name", "status"],
  project_members: ["project_id", "user_id", "role", "status"],
  permissions: ["key", "category"],
  role_permissions: ["role", "permission_key"],
  user_permissions: ["project_id", "user_id", "permission_key"],
  tasks: ["id", "project_id", "title", "status", "priority"],
  documents: ["id", "project_id", "title", "file_name", "storage_path"],
  comments: ["id", "project_id", "content"],
  activity_logs: ["id", "action", "entity_type"],
};
const TIMESTAMPS = new Set(["created_at", "updated_at", "last_sign_in_at", "completed_at"]);
const TEXT_FIELDS = new Set([
  "email",
  "full_name",
  "avatar_url",
  "name",
  "description",
  "research_goal",
  "status",
  "role",
  "key",
  "category",
  "permission_key",
  "title",
  "priority",
  "file_name",
  "storage_path",
  "mime_type",
  "content",
  "actor_name",
  "actor_email",
  "action",
  "entity_type",
  "entity_label",
  "id",
  "project_id",
  "user_id",
  "created_by",
  "added_by",
  "assigned_to",
  "uploaded_by",
  "author_id",
  "task_id",
  "granted_by",
  "actor_id",
  "entity_id",
]);
const SENSITIVE_AUTH_FIELDS = new Set([
  "password",
  "password_hash",
  "encrypted_password",
  "confirmation_token",
  "recovery_token",
  "email_change_token_new",
]);

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
function issue(issues, code, table, row, field, message) {
  issues.push({ severity: "error", code, table, row: row ?? null, ...(field ? { field } : {}), message });
}

export function parseExport(text, format = "auto") {
  const issues = [];
  const trimmed = text.trim();
  if (!trimmed)
    return {
      tables: {},
      issues: [
        { severity: "error", code: "EMPTY_INPUT", table: "<input>", row: null, message: "Input file is empty." },
      ],
    };
  const jsonl = format === "jsonl" || (format === "auto" && !trimmed.startsWith("{") && !trimmed.startsWith("["));
  if (jsonl) {
    const tables = {};
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (!item || Array.isArray(item) || typeof item !== "object" || typeof item.table !== "string") {
          issue(
            issues,
            "INVALID_JSONL_RECORD",
            "<input>",
            index + 1,
            null,
            "JSONL rows require a string table property.",
          );
          continue;
        }
        const { table, row, ...flat } = item;
        if (row !== undefined && Object.keys(flat).length > 1) {
          issue(issues, "AMBIGUOUS_JSONL_RECORD", table, index + 1, null, "Use either row:{...} or flat row fields.");
          continue;
        }
        (tables[table] ??= []).push(row === undefined ? flat : row);
      } catch {
        issue(issues, "INVALID_JSON", "<input>", index + 1, null, "Line is not valid JSON.");
      }
    }
    return { tables, issues };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      tables: {},
      issues: [
        { severity: "error", code: "INVALID_JSON", table: "<input>", row: null, message: "Input is not valid JSON." },
      ],
    };
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return {
      tables: {},
      issues: [
        {
          severity: "error",
          code: "INVALID_EXPORT",
          table: "<input>",
          row: null,
          message: "JSON export must be an object keyed by table, optionally nested under tables.",
        },
      ],
    };
  }
  return {
    tables:
      parsed.tables && !Array.isArray(parsed.tables) && typeof parsed.tables === "object" ? parsed.tables : parsed,
    issues,
  };
}

function dateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function isSafeStoragePath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[a-z][a-z\d+.-]*:/i.test(path)
  )
    return false;
  const segments = path.split("/");
  if (segments.some((part) => !part || part === "." || part === "..")) return false;
  return segments.every((part) => {
    try {
      const decoded = decodeURIComponent(part);
      return decoded !== "." && decoded !== ".." && !decoded.includes("/") && !decoded.includes("\\");
    } catch {
      return false;
    }
  });
}

function normalizeRow(table, input, rowNumber, issues, warnings) {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    issue(issues, "ROW_NOT_OBJECT", table, rowNumber, null, "Each source row must be an object.");
    return null;
  }
  const row = {};
  for (const field of FIELDS[table]) {
    if (!Object.hasOwn(input, field)) continue;
    let value = input[field];
    if (value !== null && TEXT_FIELDS.has(field) && typeof value === "string") value = value.trim();
    if (field === "email" && typeof value === "string") value = value.toLowerCase();
    if (TIMESTAMPS.has(field) && typeof value === "string") {
      const parsed = new Date(value);
      if (!Number.isFinite(parsed.getTime()))
        issue(
          issues,
          "INVALID_TIMESTAMP",
          table,
          rowNumber,
          field,
          "Timestamp must be a valid ISO-compatible date-time.",
        );
      else value = parsed.toISOString();
    }
    if ((field === "size_bytes" || field === "sort_order") && typeof value === "string" && /^\d+$/.test(value))
      value = Number(value);
    if (["metadata", "old_values", "new_values"].includes(field) && value && typeof value === "object")
      value = JSON.parse(stableJson(value));
    row[field] = value;
  }
  const defaults =
    {
      profiles: { full_name: "", is_platform_admin: false, can_create_projects: false },
      projects: { description: "", research_goal: "", status: "planning" },
      tasks: { description: "", status: "assigned", priority: "medium" },
      documents: { description: "", mime_type: "application/octet-stream", size_bytes: 0 },
      activity_logs: { metadata: {} },
    }[table] ?? {};
  for (const [field, value] of Object.entries(defaults)) if (!Object.hasOwn(row, field)) row[field] = value;
  if (table === "tasks") {
    const legacyStatuses = { todo: "assigned", review: "under_review", rejected: "cancelled" };
    if (Object.hasOwn(legacyStatuses, row.status)) {
      const previous = row.status;
      row.status = legacyStatuses[previous];
      warnings.push({
        code: "LEGACY_TASK_STATUS_NORMALIZED",
        table,
        row: rowNumber,
        message: `Legacy task status '${previous}' was normalized to '${row.status}'.`,
      });
    }
    if (row.priority === "critical") {
      row.priority = "urgent";
      warnings.push({
        code: "LEGACY_TASK_PRIORITY_NORMALIZED",
        table,
        row: rowNumber,
        message: "Legacy critical priority was normalized to urgent.",
      });
    }
  }
  if (table === "profiles") {
    if (Object.keys(input).some((key) => SENSITIVE_AUTH_FIELDS.has(key.toLowerCase()))) {
      warnings.push({
        code: "AUTH_SECRET_FIELDS_OMITTED",
        table,
        row: rowNumber,
        message: "Credential and token columns are excluded; reset/re-invite is the only supported Auth strategy.",
      });
    }
    // Never import source privilege flags. They must be reviewed and re-granted separately.
    row.is_platform_admin = false;
    row.can_create_projects = false;
  }
  if (table === "project_members") row.id = `${row.project_id ?? ""}_${row.user_id ?? ""}`;
  if (table === "user_permissions") row.id = `${row.project_id ?? ""}_${row.user_id ?? ""}_${row.permission_key ?? ""}`;
  return row;
}
function uniqueKeys(table) {
  return (
    {
      profiles: [["email"]],
      project_members: [["project_id", "user_id"]],
      permissions: [["key"]],
      role_permissions: [["role", "permission_key"]],
      user_permissions: [["project_id", "user_id", "permission_key"]],
      documents: [["storage_path"]],
    }[table] ?? []
  );
}
function checkRowDuplicates(table, records, issues) {
  const ids = new Map();
  const keys = new Map();
  for (const [i, row] of records.entries()) {
    const identity =
      row.id ??
      (table === "permissions" ? row.key : table === "role_permissions" ? `${row.role}/${row.permission_key}` : null);
    if (identity != null) {
      const prior = ids.get(String(identity));
      if (prior)
        issue(
          issues,
          stableJson(prior) === stableJson(row) ? "DUPLICATE_RECORD" : "CONFLICTING_RECORD",
          table,
          i + 1,
          "id",
          stableJson(prior) === stableJson(row) ? "Duplicate row identity." : "Different rows share the same identity.",
        );
      else ids.set(String(identity), row);
    }
    for (const fields of uniqueKeys(table)) {
      if (fields.some((field) => row[field] == null || row[field] === "")) continue;
      const key = fields.map((field) => String(row[field])).join("\u0000");
      if (keys.has(key))
        issue(issues, "DUPLICATE_KEY", table, i + 1, fields.join(","), "Two rows share a source unique key.");
      else keys.set(key, true);
    }
  }
}

function checkRelationships(rows, issues) {
  const profileIds = new Set(rows.profiles.map((row) => row.id));
  const projectIds = new Set(rows.projects.map((row) => row.id));
  const memberKeys = new Set(rows.project_members.map((row) => `${row.project_id}\u0000${row.user_id}`));
  const taskMap = new Map(rows.tasks.map((row) => [row.id, row]));
  const permissionKeys = new Set(rows.permissions.map((row) => row.key));
  const requireRef = (table, field, predicate, message, nullable = true) =>
    rows[table].forEach((row, i) => {
      if (row[field] == null && nullable) return;
      if (!predicate(row[field], row)) issue(issues, "MISSING_RELATIONSHIP", table, i + 1, field, message);
    });
  requireRef("projects", "created_by", (id) => profileIds.has(id), "Project creator is absent from profiles.");
  requireRef("project_members", "project_id", (id) => projectIds.has(id), "Membership project is missing.", false);
  requireRef("project_members", "user_id", (id) => profileIds.has(id), "Membership profile is missing.", false);
  requireRef("project_members", "added_by", (id) => profileIds.has(id), "Membership added_by profile is missing.");
  const owners = new Map();
  rows.project_members.forEach((row, i) => {
    if (!ROLES.has(row.role)) issue(issues, "INVALID_ROLE", "project_members", i + 1, "role", "Role is unsupported.");
    if (!ENUMS.memberStatus.has(row.status))
      issue(issues, "INVALID_STATUS", "project_members", i + 1, "status", "Member status is unsupported.");
    if (row.role === "owner") owners.set(row.project_id, (owners.get(row.project_id) ?? 0) + 1);
  });
  rows.projects.forEach((row, i) => {
    if (!ENUMS.projectStatus.has(row.status))
      issue(issues, "INVALID_STATUS", "projects", i + 1, "status", "Project status is unsupported.");
    if (row.start_date != null && !dateOnly(row.start_date))
      issue(issues, "INVALID_DATE", "projects", i + 1, "start_date", "Expected a real YYYY-MM-DD date.");
    if (row.deadline != null && !dateOnly(row.deadline))
      issue(issues, "INVALID_DATE", "projects", i + 1, "deadline", "Expected a real YYYY-MM-DD date.");
    if (row.start_date && row.deadline && row.deadline < row.start_date)
      issue(issues, "INVALID_DATE_ORDER", "projects", i + 1, "deadline", "Deadline precedes start date.");
    if (!owners.get(row.id))
      issue(
        issues,
        "MISSING_PROJECT_OWNER",
        "projects",
        i + 1,
        "id",
        "Project must have an owner membership before import.",
      );
    if (owners.get(row.id) > 1)
      issue(issues, "CONFLICTING_PROJECT_OWNERS", "projects", i + 1, "id", "Project has multiple owner memberships.");
  });
  rows.permissions.forEach((row, i) => {
    if (!PERMISSION_SET.has(row.key))
      issue(
        issues,
        "UNSUPPORTED_PERMISSION",
        "permissions",
        i + 1,
        "key",
        "Permission key is unsupported by the target app.",
      );
  });
  rows.role_permissions.forEach((row, i) => {
    if (!ROLES.has(row.role)) issue(issues, "INVALID_ROLE", "role_permissions", i + 1, "role", "Role is unsupported.");
    if (!permissionKeys.has(row.permission_key) || !PERMISSION_SET.has(row.permission_key))
      issue(
        issues,
        "MISSING_RELATIONSHIP",
        "role_permissions",
        i + 1,
        "permission_key",
        "Role permission is absent from the source catalog or unsupported by the target.",
      );
  });
  requireRef(
    "user_permissions",
    "project_id",
    (id) => projectIds.has(id),
    "Permission grant project is missing.",
    false,
  );
  requireRef(
    "user_permissions",
    "user_id",
    (id, row) => profileIds.has(id) && memberKeys.has(`${row.project_id}\u0000${id}`),
    "Permission grant user must exist and belong to the same project.",
    false,
  );
  requireRef("user_permissions", "granted_by", (id) => profileIds.has(id), "Permission grant actor is missing.");
  requireRef(
    "user_permissions",
    "permission_key",
    (key) => permissionKeys.has(key) && PERMISSION_SET.has(key),
    "Permission grant is absent from the catalog or unsupported.",
    false,
  );
  requireRef("tasks", "project_id", (id) => projectIds.has(id), "Task project is missing.", false);
  requireRef("tasks", "created_by", (id) => profileIds.has(id), "Task creator profile is missing.");
  requireRef(
    "tasks",
    "assigned_to",
    (id, row) => profileIds.has(id) && memberKeys.has(`${row.project_id}\u0000${id}`),
    "Task assignee must be a profile and member of the same project.",
  );
  requireRef("documents", "project_id", (id) => projectIds.has(id), "Document project is missing.", false);
  requireRef("documents", "uploaded_by", (id) => profileIds.has(id), "Document uploader profile is missing.");
  requireRef("comments", "project_id", (id) => projectIds.has(id), "Comment project is missing.", false);
  requireRef("comments", "author_id", (id) => profileIds.has(id), "Comment author profile is missing.");
  const docs = rows.documents;
  docs.forEach((row, i) => {
    if (!Number.isSafeInteger(row.size_bytes) || row.size_bytes < 0)
      issue(
        issues,
        "INVALID_SIZE",
        "documents",
        i + 1,
        "size_bytes",
        "size_bytes must be a non-negative safe integer.",
      );
    if (!isSafeStoragePath(row.storage_path))
      issue(
        issues,
        "UNSAFE_STORAGE_PATH",
        "documents",
        i + 1,
        "storage_path",
        "Path must be relative, traversal-free, and use forward slashes only.",
      );
    if (
      !row.storage_path?.startsWith(`${row.project_id}/${row.id}/`) ||
      row.storage_path.length <= `${row.project_id}/${row.id}/`.length
    )
      issue(
        issues,
        "INVALID_STORAGE_SCOPE",
        "documents",
        i + 1,
        "storage_path",
        "Path must be below <project_id>/<document_id>/.",
      );
  });
  rows.tasks.forEach((row, i) => {
    if (!ENUMS.taskStatus.has(row.status))
      issue(issues, "INVALID_STATUS", "tasks", i + 1, "status", "Task status is unsupported.");
    if (!ENUMS.taskPriority.has(row.priority))
      issue(issues, "INVALID_PRIORITY", "tasks", i + 1, "priority", "Task priority is unsupported.");
    if (row.due_date != null && !dateOnly(row.due_date))
      issue(issues, "INVALID_DATE", "tasks", i + 1, "due_date", "Expected a real YYYY-MM-DD date.");
  });
  rows.comments.forEach((row, i) => {
    if (row.task_id != null) {
      const task = taskMap.get(row.task_id);
      if (!task || task.project_id !== row.project_id)
        issue(
          issues,
          "MISSING_RELATIONSHIP",
          "comments",
          i + 1,
          "task_id",
          "Task comment must reference a task in the same project.",
        );
    }
  });
  rows.activity_logs.forEach((row, i) => {
    if (row.project_id != null && !projectIds.has(row.project_id))
      issue(issues, "MISSING_RELATIONSHIP", "activity_logs", i + 1, "project_id", "Audit project is missing.");
    if (!/^[a-z_]+\.[a-z_]+$/.test(row.action))
      issue(issues, "INVALID_ACTION", "activity_logs", i + 1, "action", "Action does not match the source format.");
    if (!ENUMS.entityType.has(row.entity_type))
      issue(issues, "INVALID_ENTITY_TYPE", "activity_logs", i + 1, "entity_type", "Entity type is unsupported.");
  });
  rows.profiles.forEach((row, i) => {
    if (row.email != null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
      issue(issues, "INVALID_EMAIL", "profiles", i + 1, "email", "Email is invalid.");
    if (row.full_name.length > 120)
      issue(issues, "FIELD_TOO_LONG", "profiles", i + 1, "full_name", "Name exceeds 120 characters.");
    if (typeof row.avatar_url === "string" && row.avatar_url.length > 2048)
      issue(issues, "FIELD_TOO_LONG", "profiles", i + 1, "avatar_url", "Avatar URL exceeds 2048 characters.");
  });
  rows.projects.forEach((row, i) => {
    checkLength(issues, "projects", i + 1, row.name, "name", 2, 160);
    checkLength(issues, "projects", i + 1, row.description, "description", 0, 5000);
    checkLength(issues, "projects", i + 1, row.research_goal, "research_goal", 0, 5000);
  });
  rows.tasks.forEach((row, i) => {
    checkLength(issues, "tasks", i + 1, row.title, "title", 2, 200);
    checkLength(issues, "tasks", i + 1, row.description, "description", 0, 10000);
  });
  rows.documents.forEach((row, i) => {
    checkLength(issues, "documents", i + 1, row.title, "title", 1, 200);
    checkLength(issues, "documents", i + 1, row.description, "description", 0, 2000);
    checkLength(issues, "documents", i + 1, row.file_name, "file_name", 1, 255);
  });
  rows.comments.forEach((row, i) => {
    checkLength(issues, "comments", i + 1, row.content, "content", 1, 5000);
  });
}

function checkLength(issues, table, row, value, field, min, max) {
  if (typeof value === "string" && (value.length < min || value.length > max))
    issue(issues, "FIELD_LENGTH", table, row, field, `${field} must be ${min}-${max} characters long.`);
}

function mapRecords(rows) {
  const mapped = Object.fromEntries(COLLECTIONS.map((collection) => [collection, []]));
  const grants = new Map();
  for (const grant of rows.user_permissions) {
    const key = `${grant.project_id}\u0000${grant.user_id}`;
    if (!grants.has(key)) grants.set(key, new Set());
    grants.get(key).add(grant.permission_key);
  }
  const roles = new Map();
  for (const grant of rows.role_permissions) {
    if (!roles.has(grant.role)) roles.set(grant.role, new Set());
    roles.get(grant.role).add(grant.permission_key);
  }
  for (const table of ["profiles", "projects"]) mapped[table].push(...rows[table]);
  for (const member of rows.project_members) {
    const key = `${member.project_id}\u0000${member.user_id}`;
    const permissions =
      member.role === "owner"
        ? new Set(
            rows.permissions.map((permission) => permission.key).filter((permission) => PERMISSION_SET.has(permission)),
          )
        : new Set(roles.get(member.role) ?? ROLE_DEFAULTS[member.role] ?? []);
    for (const permission of grants.get(key) ?? []) permissions.add(permission);
    mapped.project_members.push({
      ...member,
      permissions: PERMISSIONS.filter((permission) => permissions.has(permission)),
    });
  }
  for (const table of ["user_permissions", "tasks", "documents", "comments", "activity_logs"])
    mapped[table].push(...rows[table]);
  for (const collection of COLLECTIONS) mapped[collection].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return mapped;
}

export function validateAndMap(parsed, inputSha256 = null) {
  const issues = [...(parsed.issues ?? [])];
  const warnings = [];
  const rows = {};
  for (const table of Object.keys(parsed.tables ?? {})) {
    if (!SOURCE_TABLES.includes(table)) {
      issue(issues, "UNKNOWN_TABLE", table, null, null, "Unsupported source table.");
      continue;
    }
    if (!Array.isArray(parsed.tables[table])) {
      issue(issues, "TABLE_NOT_ARRAY", table, null, null, "Table value must be an array.");
      continue;
    }
    rows[table] = parsed.tables[table]
      .map((row, index) => normalizeRow(table, row, index + 1, issues, warnings))
      .filter(Boolean);
  }
  for (const table of SOURCE_TABLES) rows[table] ??= [];
  for (const table of SOURCE_TABLES) {
    for (const [index, row] of rows[table].entries()) {
      for (const field of REQUIRED[table]) {
        if (typeof row[field] !== "string" || !row[field].trim())
          issue(issues, "REQUIRED_FIELD", table, index + 1, field, `Required ${field} is missing or empty.`);
      }
      if (row.id != null && (typeof row.id !== "string" || row.id.includes("/")))
        issue(
          issues,
          "UNSAFE_DOCUMENT_ID",
          table,
          index + 1,
          "id",
          "Document ID must be a single Firestore path segment.",
        );
      for (const [field, value] of Object.entries(row)) {
        if (value != null && TEXT_FIELDS.has(field) && typeof value !== "string")
          issue(issues, "INVALID_FIELD_TYPE", table, index + 1, field, `${field} must be text or null.`);
      }
    }
    checkRowDuplicates(table, rows[table], issues);
  }
  checkRelationships(rows, issues);
  const records = mapRecords(rows);
  const sourceCounts = Object.fromEntries(SOURCE_TABLES.map((table) => [table, rows[table].length]));
  const targetCounts = Object.fromEntries(COLLECTIONS.map((collection) => [collection, records[collection].length]));
  const expected = Object.values(targetCounts).reduce((sum, count) => sum + count, 0);
  return {
    records,
    report: {
      schemaVersion: 1,
      mode: "dry-run",
      inputSha256,
      valid: !issues.some((entry) => entry.severity === "error"),
      sourceCounts,
      targetCounts,
      warnings,
      issues,
      authentication: { strategy: "reset-and-re-invite", passwordsMigrated: false, credentialFieldsIncluded: false },
      storage: {
        binaryObjectsCopied: false,
        metadataRowsMapped: targetCounts.documents,
        adapter: "not configured; see migration runbook",
      },
      reconciliation: {
        expectedTargetRows: expected,
        plannedTargetRows: expected,
        completedTargetRows: 0,
        remainingTargetRows: expected,
      },
    },
  };
}

export function reconcile(plan, checkpoint = null) {
  const expected = Object.values(plan.report.targetCounts).reduce((sum, count) => sum + count, 0);
  const completed = Object.keys(checkpoint?.completed ?? {}).length;
  return { expected, completed, remaining: Math.max(0, expected - completed), matches: completed === expected };
}

export function assertSafeEmulatorTarget(targetProject, emulatorHost) {
  if (typeof targetProject !== "string" || !/^demo-[a-z0-9][a-z0-9-]*$/.test(targetProject)) {
    throw new Error(
      "Apply is allowed only for an explicit demo-* Firebase project; production and named projects are refused.",
    );
  }
  if (typeof emulatorHost !== "string" || !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(emulatorHost)) {
    throw new Error(
      "Apply requires FIRESTORE_EMULATOR_HOST on localhost. No production Firestore target is supported.",
    );
  }
}
async function writeCheckpoint(fs, path, checkpoint) {
  const temporary = `${path}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, path);
}
export async function applyToFirestoreEmulator(records, { targetProject, checkpointPath, inputSha256 }) {
  assertSafeEmulatorTarget(targetProject, process.env.FIRESTORE_EMULATOR_HOST);
  const fs = await import("node:fs/promises");
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const appName = `migration-${targetProject}`;
  const app =
    getApps().find((candidate) => candidate.name === appName) ?? initializeApp({ projectId: targetProject }, appName);
  const db = getFirestore(app);
  let checkpoint = { schemaVersion: 1, inputSha256, targetProject, completed: {}, updatedAt: null };
  try {
    const prior = JSON.parse(await fs.readFile(checkpointPath, "utf8"));
    if (prior.inputSha256 !== inputSha256 || prior.targetProject !== targetProject)
      throw new Error("Checkpoint source hash or target differs; refusing resume.");
    checkpoint = prior;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const stats = { imported: 0, alreadyPresent: 0, completed: Object.keys(checkpoint.completed).length, expected: 0 };
  for (const [collection, documents] of Object.entries(records)) {
    for (let start = 0; start < documents.length; start += 400) {
      const chunk = documents.slice(start, start + 400);
      const refs = chunk.map((record) => db.collection(collection).doc(String(record.id)));
      const snapshots = refs.length ? await db.getAll(...refs) : [];
      const batch = db.batch();
      const pending = [];
      let writes = 0;
      for (let index = 0; index < chunk.length; index += 1) {
        const record = chunk[index];
        const key = `${collection}/${record.id}`;
        if (checkpoint.completed[key]) continue;
        stats.expected += 1;
        if (snapshots[index].exists) {
          if (stableJson(snapshots[index].data()) !== stableJson(record))
            throw new Error(`Existing document conflicts with migration input: ${key}`);
          checkpoint.completed[key] = "already-present-identical";
          stats.alreadyPresent += 1;
        } else {
          batch.create(refs[index], record);
          writes += 1;
        }
        pending.push(key);
      }
      if (writes) await batch.commit();
      for (const key of pending) {
        if (!checkpoint.completed[key]) {
          checkpoint.completed[key] = "written";
          stats.imported += 1;
        }
      }
      checkpoint.updatedAt = new Date().toISOString();
      await writeCheckpoint(fs, checkpointPath, checkpoint);
    }
  }
  stats.completed = Object.keys(checkpoint.completed).length;
  return { ...stats, checkpoint };
}
export const targetCollections = COLLECTIONS;
