import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { unwrap } from "@/server/action";
import { asRecord } from "@/server/queries/shared";
import type { NotificationItem } from "@/types/app";

/** The caller's notifications (RLS: own rows only). */
export async function listNotifications(limit = 50): Promise<NotificationItem[]> {
  const supabase = await createSupabaseServerClient();
  const rows = unwrap(
    await supabase
      .from("notifications")
      .select("id, type, project_id, task_id, data, actor_name, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    projectId: row.project_id,
    taskId: row.task_id,
    data: asRecord(row.data) ?? {},
    actorName: row.actor_name,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

export const countUnreadNotifications = cache(async (): Promise<number> => {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  return count ?? 0;
});
