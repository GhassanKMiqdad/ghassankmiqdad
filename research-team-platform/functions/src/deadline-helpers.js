export const DEADLINE_ACTIVE_STATUSES = Object.freeze([
  "todo",
  "accepted",
  "in_progress",
  "revision_required",
  "review",
]);

export function dateKeyInTimeZone(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid date");

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addCalendarDays(dateKey, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isInteger(days)) {
    throw new TypeError("Expected an ISO calendar date and an integer day offset");
  }
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid calendar date");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function deadlineNotificationId(kind, taskId, userId, dueDate) {
  for (const value of [kind, taskId, userId, dueDate]) {
    if (typeof value !== "string" || value.length === 0)
      throw new TypeError("Notification ID fields must be non-empty strings");
  }
  return `deadline_${[kind, taskId, userId, dueDate].map(encodeURIComponent).join("__")}`;
}
