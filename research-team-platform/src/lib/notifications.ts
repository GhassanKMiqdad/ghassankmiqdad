import type { Dictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/format";

type NotificationLike = { type: string; data: Record<string, unknown>; actorName: string | null };

const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");

/** Human sentence for a notification; unknown types fall back to "code · title". */
export function describeNotification(t: Dictionary, notification: NotificationLike, unknownActor: string): string {
  const values = {
    actor: notification.actorName ?? unknownActor,
    code: text(notification.data.task_code),
    title: text(notification.data.task_title),
    version: text(notification.data.version),
  };
  const template = (t.notifications.types as Record<string, string>)[notification.type] ?? t.notifications.fallback;
  return fmt(template, values);
}
