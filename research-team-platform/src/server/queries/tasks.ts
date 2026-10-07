import "server-only";

import { getAppTimeZone } from "@/lib/env.server";
import {
  OPEN_TASK_STATUSES,
  SCHEDULE_STATUSES,
  type DurationUnit,
  type ReviewDecision,
  type ScheduleStatus,
  type SubmissionStatus,
  type TaskPriority,
  type TaskStatus,
  type TaskVisibility,
} from "@/lib/permissions/catalog";
import { addDays, zonedDayRange } from "@/lib/schedule";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { unwrap, unwrapMaybe } from "@/server/action";
import { pageRange, PROFILE_FIELDS, sanitizeSearch, toUserRef } from "@/server/queries/shared";
import { getRosterIndex, listPendingRoster } from "@/server/queries/teams";
import type {
  DependencyItem,
  MemberOption,
  Paginated,
  ReviewItem,
  SubmissionItem,
  TaskDetails,
  TaskListItem,
  TaskOption,
} from "@/types/app";

export type TaskScheduleFilter = "overdue" | "due_soon" | "unscheduled";

export type TaskFilters = {
  projectId?: string;
  teamId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  /** "me", "unassigned" or a user id */
  assignee?: string;
  q?: string;
  month?: number;
  week?: number;
  /** Calendar dates (YYYY-MM-DD, application time zone): start or deadline inside the range. */
  from?: string;
  to?: string;
  schedule?: TaskScheduleFilter;
  page?: number;
  pageSize?: number;
};

const TASK_LIST_SELECT = `id, project_id, team_id, task_code, title, status, priority, planning_month, planning_week,
  planned_start_at, planned_duration, duration_unit, due_at, due_at_overridden, actual_start_at, submitted_at,
  approved_at, completed_at, progress, visibility, created_at, updated_at, created_by, assigned_to,
  schedule_status, is_blocked, responsible_member_id,
  responsible:team_members!tasks_responsible_member_id_fkey(display_name, member_code, job_title),
  project:projects(id, name),
  assignee:profiles!tasks_assigned_to_fkey(${PROFILE_FIELDS})`;

type TaskListRow = {
  id: string;
  project_id: string;
  team_id: string | null;
  task_code: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  planning_month: number;
  planning_week: number | null;
  planned_start_at: string | null;
  planned_duration: number | null;
  duration_unit: DurationUnit | null;
  due_at: string | null;
  due_at_overridden: boolean;
  actual_start_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  completed_at: string | null;
  progress: number;
  visibility: TaskVisibility;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  assigned_to: string | null;
  schedule_status: string | null;
  is_blocked: boolean | null;
  responsible_member_id: string | null;
  responsible: { display_name: string; member_code: string; job_title: string } | null;
  project: { id: string; name: string } | null;
  assignee: { id: string; full_name: string; email: string | null } | null;
};

function toScheduleStatus(value: string | null): ScheduleStatus {
  return (SCHEDULE_STATUSES as readonly string[]).includes(value ?? "") ? (value as ScheduleStatus) : "unscheduled";
}

/** Job titles of responsible members, from the rosters the caller can read. */
async function loadRosterTitles(rows: { team_id: string | null; assigned_to: string | null }[]) {
  const teamIds = [...new Set(rows.map((row) => row.team_id).filter((id): id is string => !!id))];
  const titles = new Map<string, string>();
  if (teamIds.length === 0) return titles;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("team_members")
    .select("team_id, user_id, job_title")
    .in("team_id", teamIds)
    .not("user_id", "is", null);
  for (const member of data ?? []) {
    if (member.user_id && member.job_title) titles.set(`${member.team_id}:${member.user_id}`, member.job_title);
  }
  return titles;
}

function toTaskListItem(row: TaskListRow, titles: Map<string, string>): TaskListItem {
  const scheduleStatus = toScheduleStatus(row.schedule_status);
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project?.name ?? "",
    teamId: row.team_id,
    code: row.task_code,
    title: row.title,
    status: row.status,
    priority: row.priority,
    planningMonth: row.planning_month,
    planningWeek: row.planning_week,
    plannedStartAt: row.planned_start_at,
    plannedDuration: row.planned_duration === null ? null : Number(row.planned_duration),
    durationUnit: row.duration_unit,
    dueAt: row.due_at,
    dueAtOverridden: row.due_at_overridden,
    actualStartAt: row.actual_start_at,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
    completedAt: row.completed_at,
    progress: row.progress,
    visibility: row.visibility,
    scheduleStatus,
    isBlocked: row.is_blocked === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdById: row.created_by,
    assignedToId: row.assigned_to,
    assignee: toUserRef(row.assignee),
    assigneeTitle:
      (row.team_id && row.assigned_to ? titles.get(`${row.team_id}:${row.assigned_to}`) : undefined) ??
      (row.responsible?.job_title || null),
    responsibleMemberId: row.responsible_member_id,
    responsibleName: toUserRef(row.assignee)?.name ?? row.responsible?.display_name ?? null,
    responsiblePending: !row.assigned_to && !!row.responsible,
    isOverdue: scheduleStatus === "overdue",
  };
}

async function toTaskListItems(rows: TaskListRow[]): Promise<TaskListItem[]> {
  const titles = await loadRosterTitles(rows);
  return rows.map((row) => toTaskListItem(row, titles));
}

/**
 * Lists the tasks the current user can see. Visibility is decided by RLS:
 * supervisors (tasks.view) see every task, members only their own — other
 * members' work stays private until it is published.
 */
export async function listTasks(userId: string, filters: TaskFilters): Promise<Paginated<TaskListItem>> {
  const pageSize = filters.pageSize ?? 25;
  const { page, from, to } = pageRange(filters.page ?? 1, pageSize);
  const supabase = await createSupabaseServerClient();

  let query = supabase.from("tasks").select(TASK_LIST_SELECT, { count: "exact" });

  if (filters.projectId) query = query.eq("project_id", filters.projectId);
  if (filters.teamId) query = query.eq("team_id", filters.teamId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.month) query = query.eq("planning_month", filters.month);
  if (filters.week) query = query.eq("planning_week", filters.week);
  if (filters.assignee === "me") query = query.eq("assigned_to", userId);
  else if (filters.assignee === "unassigned") query = query.is("assigned_to", null);
  else if (filters.assignee) query = query.eq("assigned_to", filters.assignee);

  const search = sanitizeSearch(filters.q);
  if (search) query = query.or(`task_code.ilike.%${search}%,title.ilike.%${search}%`);

  if (filters.from || filters.to) {
    const timeZone = getAppTimeZone();
    const range = zonedDayRange(filters.from ?? "1970-01-01", addDays(filters.to ?? "2999-12-30", 1), timeZone);
    if (range.from && range.to) {
      query = query.or(
        `and(due_at.gte.${range.from},due_at.lt.${range.to}),and(planned_start_at.gte.${range.from},planned_start_at.lt.${range.to})`,
      );
    }
  }

  if (filters.schedule) query = query.eq("schedule_status", filters.schedule);

  const { data, count, error } = await query
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: true })
    .order("task_code", { ascending: true })
    .range(from, to);
  if (error) throw error;

  return {
    items: await toTaskListItems((data ?? []) as TaskListRow[]),
    total: count ?? 0,
    page,
    pageSize,
  };
}

/** Tasks starting or due inside [from, to) (instants), for the schedule views. */
export async function listTasksInRange(
  userId: string,
  range: { from: string; to: string },
  filters: Pick<TaskFilters, "projectId" | "teamId" | "assignee">,
): Promise<TaskListItem[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("tasks")
    .select(TASK_LIST_SELECT)
    .neq("status", "cancelled")
    .or(
      `and(due_at.gte.${range.from},due_at.lt.${range.to}),and(planned_start_at.gte.${range.from},planned_start_at.lt.${range.to})`,
    );
  if (filters.projectId) query = query.eq("project_id", filters.projectId);
  if (filters.teamId) query = query.eq("team_id", filters.teamId);
  if (filters.assignee === "me") query = query.eq("assigned_to", userId);
  else if (filters.assignee) query = query.eq("assigned_to", filters.assignee);
  const rows = unwrap(await query.order("due_at", { ascending: true, nullsFirst: false }).limit(1000));
  return toTaskListItems(rows as TaskListRow[]);
}

/** Open tasks that have neither a start nor a deadline ("SCHEDULE NOT YET DEFINED"). */
export async function countUnscheduledTasks(filters: Pick<TaskFilters, "projectId" | "teamId">): Promise<number> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .is("planned_start_at", null)
    .is("due_at", null)
    .in("status", [...OPEN_TASK_STATUSES]);
  if (filters.projectId) query = query.eq("project_id", filters.projectId);
  if (filters.teamId) query = query.eq("team_id", filters.teamId);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Every unfinished task the caller can see (dashboards). */
export async function listOpenTasks(options: { assignedTo?: string; limit?: number } = {}): Promise<TaskListItem[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("tasks")
    .select(TASK_LIST_SELECT)
    .in("status", [...OPEN_TASK_STATUSES]);
  if (options.assignedTo) query = query.eq("assigned_to", options.assignedTo);
  const rows = unwrap(
    await query
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: true })
      .limit(options.limit ?? 500),
  );
  return toTaskListItems(rows as TaskListRow[]);
}

/** Tasks assigned to a user (any status), for personal progress. */
export async function listAssignedTasks(userId: string, limit = 500): Promise<TaskListItem[]> {
  const supabase = await createSupabaseServerClient();
  const rows = unwrap(
    await supabase
      .from("tasks")
      .select(TASK_LIST_SELECT)
      .eq("assigned_to", userId)
      .neq("status", "cancelled")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(limit),
  );
  return toTaskListItems(rows as TaskListRow[]);
}

/** Open tasks assigned to the current user, soonest due first. */
export async function listMyOpenTasks(userId: string, limit = 6): Promise<TaskListItem[]> {
  return listOpenTasks({ assignedTo: userId, limit });
}

export async function getTask(taskId: string): Promise<TaskDetails | null> {
  const supabase = await createSupabaseServerClient();
  const row = unwrapMaybe(
    await supabase
      .from("tasks")
      .select(
        `${TASK_LIST_SELECT}, description, original_instructions, expected_output, completion_criteria, work_notes,
         team:teams(id, name),
         creator:profiles!tasks_created_by_fkey(${PROFILE_FIELDS})`,
      )
      .eq("id", taskId)
      .maybeSingle(),
  );
  if (!row) return null;

  const [item] = await toTaskListItems([row as TaskListRow]);
  return {
    ...item,
    description: row.description,
    originalInstructions: row.original_instructions,
    expectedOutput: row.expected_output,
    completionCriteria: row.completion_criteria,
    workNotes: row.work_notes,
    createdBy: toUserRef(row.creator),
    teamName: row.team?.name ?? null,
  };
}

/** Versioned submissions with their reviews (RLS: supervisors and the responsible member only). */
export async function listSubmissions(taskId: string): Promise<SubmissionItem[]> {
  const supabase = await createSupabaseServerClient();
  const [submissions, reviews] = await Promise.all([
    supabase
      .from("task_submissions")
      .select(
        `id, version, summary, deliverable_links, notes, status, is_final, submitted_at,
         submitter:profiles!task_submissions_submitted_by_fkey(${PROFILE_FIELDS})`,
      )
      .eq("task_id", taskId)
      .order("version", { ascending: false }),
    supabase
      .from("task_reviews")
      .select(
        `id, submission_id, decision, comment, required_changes, additional_instructions, previous_due_at, new_due_at, created_at,
         reviewer:profiles!task_reviews_reviewer_id_fkey(${PROFILE_FIELDS})`,
      )
      .eq("task_id", taskId)
      .order("created_at", { ascending: true }),
  ]);

  const reviewItems: ReviewItem[] = unwrap(reviews).map((review) => ({
    id: review.id,
    submissionId: review.submission_id,
    decision: review.decision as ReviewDecision,
    comment: review.comment,
    requiredChanges: review.required_changes,
    additionalInstructions: review.additional_instructions,
    previousDueAt: review.previous_due_at,
    newDueAt: review.new_due_at,
    reviewer: toUserRef(review.reviewer),
    createdAt: review.created_at,
  }));

  return unwrap(submissions).map((submission) => ({
    id: submission.id,
    version: submission.version,
    summary: submission.summary,
    links: submission.deliverable_links ?? [],
    notes: submission.notes,
    status: submission.status as SubmissionStatus,
    isFinal: submission.is_final,
    submittedBy: toUserRef(submission.submitter),
    submittedAt: submission.submitted_at,
    reviews: reviewItems.filter((review) => review.submissionId === submission.id),
  }));
}

export async function listDependencies(taskId: string): Promise<DependencyItem[]> {
  const supabase = await createSupabaseServerClient();
  const rows = unwrap(
    await supabase
      .from("task_dependencies")
      .select("depends_on_task_id, predecessor:tasks!task_dependencies_predecessor_fkey(id, task_code, title, status)")
      .eq("task_id", taskId),
  );
  return rows
    .filter((row) => row.predecessor)
    .map((row) => ({
      taskId: row.depends_on_task_id,
      code: row.predecessor!.task_code,
      title: row.predecessor!.title,
      status: row.predecessor!.status,
      done: row.predecessor!.status === "approved" || row.predecessor!.status === "completed",
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Tasks of the same project that can become predecessors (supervisors). */
export async function listTaskOptions(projectId: string, excludeIds: string[]): Promise<TaskOption[]> {
  const supabase = await createSupabaseServerClient();
  const rows = unwrap(
    await supabase
      .from("tasks")
      .select("id, task_code, title")
      .eq("project_id", projectId)
      .neq("status", "cancelled")
      .order("task_code")
      .limit(500),
  );
  const excluded = new Set(excludeIds);
  return rows
    .filter((row) => !excluded.has(row.id))
    .map((row) => ({ id: row.id, code: row.task_code, title: row.title }));
}

/**
 * Active members a task can be assigned to. Readable only with team.view or
 * tasks.assign (RLS); returns an empty list otherwise.
 */
export async function listAssignableMembers(projectId: string): Promise<MemberOption[]> {
  const supabase = await createSupabaseServerClient();
  const rows = unwrap(
    await supabase
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

/**
 * Assignable members enriched with their member code and job title from the
 * project's team roster, plus roster members who have no account yet (work
 * can be planned for them; it is assigned when their account is linked).
 */
export async function listAssignableMembersWithRoster(
  projectId: string,
  teamId: string | null,
): Promise<MemberOption[]> {
  const [members, roster, pending] = await Promise.all([
    listAssignableMembers(projectId),
    getRosterIndex(teamId),
    listPendingRoster(teamId),
  ]);
  return [
    ...members.map((member) => ({
      ...member,
      code: roster.get(member.id)?.code ?? null,
      jobTitle: roster.get(member.id)?.jobTitle ?? null,
    })),
    ...pending.map((entry) => ({
      id: entry.id,
      name: entry.name,
      role: "member" as const,
      code: entry.code,
      jobTitle: entry.jobTitle,
      pending: true,
    })),
  ].sort((a, b) => (a.code ?? "~").localeCompare(b.code ?? "~") || a.name.localeCompare(b.name));
}
