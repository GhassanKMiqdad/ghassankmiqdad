import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMyProjectsAccess } from "@/server/access";
import { asRecord, pageRange } from "@/server/queries/shared";
import type { ActivityItem, Paginated } from "@/types/app";

export type ActivityFilters = {
  projectId?: string;
  entityType?: string;
  actorId?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
};

export const ACTIVITY_ENTITY_TYPES = [
  "project",
  "task",
  "document",
  "comment",
  "member",
  "permissions",
  "platform_user",
  "team",
] as const;

/**
 * Reads the audit trail. RLS returns the full log of projects where the user
 * holds activity.view, the user's own actions everywhere, and (for platform
 * admins) platform-level entries.
 */
export async function listActivity(filters: ActivityFilters): Promise<Paginated<ActivityItem>> {
  const pageSize = filters.pageSize ?? 30;
  const { page, from, to } = pageRange(filters.page ?? 1, pageSize);
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("activity_logs")
    .select(
      "id, project_id, actor_id, actor_name, action, entity_type, entity_id, entity_label, old_values, new_values, metadata, ip_address, user_agent, created_at",
      { count: "exact" },
    );

  if (filters.projectId) query = query.eq("project_id", filters.projectId);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.entityId) query = query.eq("entity_id", filters.entityId);

  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);
  if (error) throw error;

  const projectNames = new Map((await getMyProjectsAccess()).map((access) => [access.projectId, access.projectName]));

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_id ? (projectNames.get(row.project_id) ?? null) : null,
      actorId: row.actor_id,
      actorName: row.actor_name,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      entityLabel: row.entity_label,
      oldValues: asRecord(row.old_values),
      newValues: asRecord(row.new_values),
      metadata: asRecord(row.metadata) ?? {},
      ipAddress: typeof row.ip_address === "string" ? row.ip_address : null,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    })),
    total: count ?? 0,
    page,
    pageSize,
  };
}
