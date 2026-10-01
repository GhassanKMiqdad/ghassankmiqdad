import type { Dictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/format";
import { isPermissionKey } from "@/lib/permissions/catalog";
import { formatBytes } from "@/lib/utils";
import type { ActivityItem } from "@/types/app";

export type ActivityChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

type Formatters = {
  t: Dictionary;
  date: (value: string) => string;
  locale: string;
};

/**
 * Wraps user-provided text in Unicode isolates (FSI … PDI) so a Latin name
 * inside an Arabic sentence (or the reverse) cannot reorder the surrounding
 * words and quotation marks.
 */
export function isolate(value: string): string {
  return `\u2068${value}\u2069`;
}

/** "Ghassan edited task “Literature Review”" */
export function describeActivity(item: ActivityItem, t: Dictionary): string {
  const actor = item.actorName?.trim() ? isolate(item.actorName.trim()) : t.common.system;
  const entity = item.entityLabel?.trim() ? isolate(item.entityLabel.trim()) : "—";
  const taskTitle = typeof item.metadata.task_title === "string" ? isolate(item.metadata.task_title) : null;
  const target = taskTitle ? fmt(t.activity.targetTask, { title: taskTitle }) : t.activity.targetProject;
  const template = (t.activity.actions as Record<string, string>)[item.action] ?? t.activity.fallbackAction;
  return fmt(template, { actor, entity, target, action: item.action });
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function formatValue(
  item: ActivityItem,
  field: string,
  value: unknown,
  side: Record<string, unknown> | null,
  f: Formatters,
): string | null {
  const { t } = f;
  if (value === null || value === undefined) return null;

  if (item.action === "permissions.changed" || item.entityType === "platform_user") {
    if (typeof value === "boolean") {
      if (item.entityType === "platform_user") return value ? t.activity.enabled : t.activity.disabled;
      return value ? t.activity.granted : t.activity.revoked;
    }
  }

  switch (field) {
    case "status": {
      const raw = String(value);
      if (item.entityType === "task" && raw in t.taskStatus) return t.taskStatus[raw as keyof Dictionary["taskStatus"]];
      if (item.entityType === "project" && raw in t.projectStatus) {
        return t.projectStatus[raw as keyof Dictionary["projectStatus"]];
      }
      if (item.entityType === "member" && raw in t.memberStatus) {
        return t.memberStatus[raw as keyof Dictionary["memberStatus"]];
      }
      return raw;
    }
    case "priority": {
      const raw = String(value);
      return raw in t.taskPriority ? t.taskPriority[raw as keyof Dictionary["taskPriority"]] : raw;
    }
    case "role": {
      const raw = String(value);
      return raw in t.roles ? t.roles[raw as keyof Dictionary["roles"]] : raw;
    }
    case "assigned_to":
    case "owner_id": {
      const name = side?.assignee_name ?? side?.owner_name;
      return typeof name === "string" && name ? name : t.common.unknownUser;
    }
    case "due_date":
    case "start_date":
    case "deadline":
      return typeof value === "string" ? f.date(value) : asString(value);
    case "size_bytes":
      return typeof value === "number" ? formatBytes(value, f.locale) : asString(value);
    case "permissions":
      return Array.isArray(value)
        ? value
            .map((key) => (isPermissionKey(key) ? t.permissions.items[key].label : String(key)))
            .join(f.locale === "ar" ? "، " : ", ")
        : asString(value);
    default:
      return asString(value);
  }
}

const HIDDEN_FIELDS = new Set(["assignee_name", "owner_name"]);

/** Field-level changes (old -> new) of an audit entry, ready for display. */
export function activityChanges(item: ActivityItem, f: Formatters): ActivityChange[] {
  const { t } = f;
  const before = item.oldValues;
  const after = item.newValues;
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  const changes: ActivityChange[] = [];
  for (const key of keys) {
    if (HIDDEN_FIELDS.has(key)) continue;
    const label = isPermissionKey(key)
      ? t.permissions.items[key].label
      : ((t.activity.fields as Record<string, string>)[key] ?? (key === "owner_id" ? t.activity.fields.owner : key));
    changes.push({
      field: key,
      label,
      before: formatValue(item, key, before?.[key], before, f),
      after: formatValue(item, key, after?.[key], after, f),
    });
  }
  return changes;
}

export function activityReason(item: ActivityItem, t: Dictionary): string | null {
  const reason = item.metadata.reason;
  if (typeof reason !== "string") return null;
  return (t.activity.reasons as Record<string, string>)[reason] ?? null;
}
