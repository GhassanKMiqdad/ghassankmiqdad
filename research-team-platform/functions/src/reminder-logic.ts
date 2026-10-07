export type ReminderTask = {
  id: string;
  assigned_to?: unknown;
  status?: unknown;
  due_date?: unknown;
};

const REMINDABLE_STATUSES = new Set(["todo", "accepted", "in_progress", "revision_required"]);

export type ReminderKind = "task_due_soon" | "task_overdue";

export function classifyTaskReminders(task: ReminderTask, today: string, tomorrow: string): ReminderKind[] {
  if (typeof task.assigned_to !== "string" || task.assigned_to.length === 0) return [];
  if (typeof task.due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(task.due_date)) return [];
  if (!REMINDABLE_STATUSES.has(String(task.status))) return [];
  if (task.due_date < today) return ["task_overdue"];
  if (task.due_date === tomorrow) return ["task_due_soon"];
  return [];
}

export function reminderNotificationId(kind: ReminderKind, taskId: string, userId: string, runDate: string): string {
  return `reminder_${kind}_${taskId}_${userId}_${runDate}`;
}

export function utcDateParts(now: Date): { today: string; tomorrow: string } {
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
    .toISOString()
    .slice(0, 10);
  return { today, tomorrow };
}
