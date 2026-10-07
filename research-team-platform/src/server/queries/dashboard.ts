import "server-only";

import { cache } from "react";
import { z } from "zod";

import { PROJECT_STATUSES, TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/permissions/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { unwrap } from "@/server/action";
import { appToday } from "@/server/queries/shared";
import type { DashboardStats } from "@/types/app";

const count = z.coerce.number().int().nonnegative().catch(0);

/** The RPC returns JSON: validate it instead of trusting its shape. */
const statsSchema = z.object({
  total_projects: count,
  active_projects: count,
  total_tasks: count,
  active_tasks: count,
  completed_tasks: count,
  overdue_tasks: count,
  due_soon_tasks: count,
  awaiting_review: count,
  awaiting_completion: count,
  can_view_team: z.boolean().catch(false),
  team_members: count,
  tasks_by_status: z.record(z.string(), count).catch({}),
  tasks_by_priority: z.record(z.string(), count).catch({}),
  tasks_by_member: z
    .array(
      z.object({
        user_id: z.string(),
        name: z.string().catch(""),
        total: count,
        open: count,
        completed: count,
        overdue: count,
      }),
    )
    .catch([]),
  project_progress: z
    .array(
      z.object({
        project_id: z.string(),
        name: z.string(),
        status: z.enum(PROJECT_STATUSES).catch("active"),
        total: count,
        completed: count,
      }),
    )
    .catch([]),
});

export const getDashboardStats = cache(async (): Promise<DashboardStats> => {
  const supabase = await createSupabaseServerClient();
  const raw = unwrap(await supabase.rpc("get_dashboard_stats", { p_today: appToday() }));
  const stats = statsSchema.parse(raw ?? {});

  const tasksByStatus = Object.fromEntries(
    TASK_STATUSES.map((status) => [status, stats.tasks_by_status[status] ?? 0]),
  ) as Record<TaskStatus, number>;
  const tasksByPriority = Object.fromEntries(
    TASK_PRIORITIES.map((priority) => [priority, stats.tasks_by_priority[priority] ?? 0]),
  ) as Record<TaskPriority, number>;

  return {
    totalProjects: stats.total_projects,
    activeProjects: stats.active_projects,
    totalTasks: stats.total_tasks,
    activeTasks: stats.active_tasks,
    completedTasks: stats.completed_tasks,
    overdueTasks: stats.overdue_tasks,
    dueSoonTasks: stats.due_soon_tasks,
    awaitingReview: stats.awaiting_review,
    awaitingCompletion: stats.awaiting_completion,
    canViewTeam: stats.can_view_team,
    teamMembers: stats.team_members,
    tasksByStatus,
    tasksByPriority,
    tasksByMember: stats.tasks_by_member.map((item) => ({
      userId: item.user_id,
      name: item.name,
      total: item.total,
      open: item.open,
      completed: item.completed,
      overdue: item.overdue,
    })),
    projectProgress: stats.project_progress.map((item) => ({
      projectId: item.project_id,
      name: item.name,
      status: item.status,
      total: item.total,
      completed: item.completed,
    })),
  };
});
