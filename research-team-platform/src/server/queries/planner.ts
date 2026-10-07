import "server-only";

import { getAppTimeZone } from "@/lib/env.server";
import { REVIEW_QUEUE_STATUSES } from "@/lib/permissions/catalog";
import { addDays, startOfWeek, zonedDayRange } from "@/lib/schedule";
import { appToday } from "@/server/queries/shared";
import type { TaskListItem } from "@/types/app";

const within = (value: string | null, range: { from: string | null; to: string | null }) =>
  !!value && !!range.from && !!range.to && value >= range.from && value < range.to;

const instant = (value: string | null) => (value ? new Date(value).toISOString() : null);

/**
 * Groups open tasks for the dashboards using the application time zone for
 * "today" and "this week" (Monday–Sunday). Schedule signals (overdue, due
 * soon) come from the database clock.
 */
export function bucketTasks(tasks: TaskListItem[]) {
  const timeZone = getAppTimeZone();
  const today = appToday();
  const weekStart = startOfWeek(today);
  const todayRange = zonedDayRange(today, addDays(today, 1), timeZone);
  const weekRange = zonedDayRange(weekStart, addDays(weekStart, 7), timeZone);

  return {
    startingToday: tasks.filter(
      (task) => ["not_started", "scheduled"].includes(task.status) && within(instant(task.plannedStartAt), todayRange),
    ),
    dueToday: tasks.filter((task) => within(instant(task.dueAt), todayRange)),
    dueThisWeek: tasks.filter((task) => within(instant(task.dueAt), weekRange)),
    thisWeek: tasks.filter((task) => within(instant(task.dueAt), weekRange) || within(instant(task.plannedStartAt), weekRange)),
    overdue: tasks.filter((task) => task.scheduleStatus === "overdue"),
    dueSoon: tasks.filter((task) => task.scheduleStatus === "due_soon"),
    awaitingReview: tasks.filter((task) => REVIEW_QUEUE_STATUSES.includes(task.status)),
    readyToPublish: tasks.filter((task) => task.status === "approved"),
  };
}

/** Personal progress over the member's (non-cancelled) tasks. */
export function personalProgress(tasks: TaskListItem[]) {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const delivered = tasks.filter((task) => ["approved", "completed"].includes(task.status) && task.dueAt);
  const onTime = delivered.filter(
    (task) => task.submittedAt && task.dueAt && new Date(task.submittedAt) <= new Date(task.dueAt),
  ).length;
  return {
    total,
    completed,
    onTimeRate: delivered.length > 0 ? Math.round((onTime / delivered.length) * 100) : null,
  };
}
