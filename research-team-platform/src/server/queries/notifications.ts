import "server-only";

import { createFirebaseServerClient } from "@/lib/firebase/compat";
import type { NotificationItem } from "@/types/app";

export async function listNotifications(): Promise<NotificationItem[]> {
  const firebase = await createFirebaseServerClient();
  const { data, error } = await firebase
    .from("notifications")
    .select("id, type, task_id, task_title, href, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    type: row.type as NotificationItem["type"],
    taskId: String(row.task_id),
    taskTitle: String(row.task_title ?? ""),
    href: String(row.href),
    createdAt: String(row.created_at),
    readAt: typeof row.read_at === "string" ? row.read_at : null,
  }));
}
