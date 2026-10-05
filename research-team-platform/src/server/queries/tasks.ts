import "server-only";

import { normalizeTaskStatus, type TaskPriority, type TaskStatus } from "@/lib/permissions/catalog";
import { createFirebaseServerClient } from "@/lib/firebase/compat";
import { unwrap, unwrapMaybe } from "@/server/action";
import { getProjectAccess, hasTeamAccess } from "@/server/access";
import { appToday, isOverdue, pageRange, PROFILE_FIELDS, sanitizeSearch, toUserRef } from "@/server/queries/shared";
import type { MemberOption, Paginated, TaskDetails, TaskListItem } from "@/types/app";

export type TaskFilters = {
  projectId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  /** "me", "unassigned" or a user id */
  assignee?: string;
  q?: string;
  overdue?: boolean;
  page?: number;
  pageSize?: number;
};

const TASK_LIST_SELECT = `id, project_id, team_id, title, status, priority, start_date, due_date, created_at, updated_at, created_by, assigned_to,
  project:projects(id, name),
  assignee:profiles!tasks_assigned_to_fkey(${PROFILE_FIELDS})`;

type TaskListRow = {
  id: string;
  project_id: string;
  team_id: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  start_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  assigned_to: string | null;
  project: { id: string; name: string } | null;
  assignee: { id: string; full_name: string; email: string | null } | null;
};

function toTaskListItem(row: TaskListRow, today: string): TaskListItem {
  const status = normalizeTaskStatus(row.status);
  if (!status) throw new Error(`Unsupported task status for task ${row.id}`);
  return {
    id: row.id,
    projectId: row.project_id,
    teamId: row.team_id ?? null,
    projectName: row.project?.name ?? "",
    title: row.title,
    status,
    priority: row.priority === "critical" ? "urgent" : row.priority,
    startDate: row.start_date ?? null,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdById: row.created_by,
    assignedToId: row.assigned_to,
    assignee: toUserRef(row.assignee),
    isOverdue: isOverdue(row.due_date, status, today),
  };
}

/**
 * Lists the tasks the current user can see. Visibility is decided by RLS:
 * every task with tasks.view, plus own / assigned tasks.
 */
export async function listTasks(userId: string, filters: TaskFilters): Promise<Paginated<TaskListItem>> {
  const pageSize = filters.pageSize ?? 25;
  const { page, from, to } = pageRange(filters.page ?? 1, pageSize);
  const today = appToday();
  const firebase = await createFirebaseServerClient();

  let query = firebase.from("tasks").select(TASK_LIST_SELECT, { count: "exact" });

  if (filters.projectId) query = query.eq("project_id", filters.projectId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.assignee === "me") query = query.eq("assigned_to", userId);
  else if (filters.assignee === "unassigned") query = query.is("assigned_to", null);
  else if (filters.assignee) query = query.eq("assigned_to", filters.assignee);
  const search = sanitizeSearch(filters.q);
  if (search) query = query.ilike("title", `%${search}%`);
  if (filters.overdue) query = query.lt("due_date", today).not("status", "in", "(completed,cancelled,rejected)");

  const { data, count, error } = await query
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw error;

  return {
    items: (data ?? []).map((row) => toTaskListItem(row as unknown as TaskListRow, today)),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getTask(taskId: string): Promise<TaskDetails | null> {
  const firebase = await createFirebaseServerClient();
  const row = unwrapMaybe(
    await firebase
      .from("tasks")
      .select(
        `${TASK_LIST_SELECT}, description, original_instructions, expected_output, required_deliverables, completed_at, progress, work_notes,
         creator:profiles!tasks_created_by_fkey(${PROFILE_FIELDS})`,
      )
      .eq("id", taskId)
      .maybeSingle(),
  );
  if (!row) return null;
  const access = await getProjectAccess(row.project_id);
  if (!access || !(await hasTeamAccess(access, row.team_id))) return null;

  return {
    ...toTaskListItem(row as unknown as TaskListRow, appToday()),
    description: row.description,
    originalInstructions: String(row.original_instructions ?? ""),
    expectedOutput: String(row.expected_output ?? ""),
    requiredDeliverables: String(row.required_deliverables ?? ""),
    completedAt: row.completed_at,
    progress: Number(row.progress ?? 0),
    workNotes: String(row.work_notes ?? ""),
    createdBy: toUserRef(row.creator),
  };
}

/** Open tasks assigned to the current user, soonest due first. */
export async function listMyOpenTasks(userId: string, limit = 6): Promise<TaskListItem[]> {
  const firebase = await createFirebaseServerClient();
  const today = appToday();
  const rows = unwrap(
    await firebase
      .from("tasks")
      .select(TASK_LIST_SELECT)
      .eq("assigned_to", userId)
      .in("status", [
        "assigned",
        "accepted",
        "in_progress",
        "submitted",
        "under_review",
        "revision_required",
        "todo",
        "review",
      ])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(limit),
  );
  return rows.map((row) => toTaskListItem(row as unknown as TaskListRow, today));
}

/**
 * Active members a task can be assigned to. Readable only with team.view or
 * tasks.assign (RLS); returns an empty list otherwise.
 */
export async function listAssignableMembers(projectId: string): Promise<MemberOption[]> {
  const firebase = await createFirebaseServerClient();
  const rows = unwrap(
    await firebase
      .from("project_members")
      .select(`user_id, role, profile:profiles!project_members_user_id_fkey(${PROFILE_FIELDS})`)
      .eq("project_id", projectId)
      .eq("status", "active"),
  );
  return rows
    .map((row) => ({
      id: row.user_id,
      name: toUserRef(row.profile)?.name ?? "—",
      role: row.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
