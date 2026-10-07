import "server-only";

import type { TeamMemberStatus, TeamRole } from "@/lib/permissions/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { unwrap } from "@/server/action";
import type { PublicationItem, TeamRosterMember, TeamSummary } from "@/types/app";

/** Teams the caller can see (RLS: Directors all, members their teams, project members the project's team). */
export async function listTeams(): Promise<TeamSummary[]> {
  const supabase = await createSupabaseServerClient();
  const [teams, members, projects] = await Promise.all([
    supabase.from("teams").select("id, name, description").order("name"),
    supabase.from("team_members").select("team_id, status"),
    supabase.from("projects").select("id, name, team_id").not("team_id", "is", null).order("name"),
  ]);
  const memberRows = unwrap(members);
  const projectRows = unwrap(projects);
  return unwrap(teams).map((team) => ({
    id: team.id,
    name: team.name,
    description: team.description,
    memberCount: memberRows.filter((member) => member.team_id === team.id && member.status !== "inactive").length,
    projects: projectRows.filter((project) => project.team_id === team.id).map((project) => ({ id: project.id, name: project.name })),
  }));
}

/** Roster of a team. Invitation e-mails are returned to Directors only (separate RPC). */
export async function getTeamRoster(teamId: string, includeInvites: boolean): Promise<TeamRosterMember[]> {
  const supabase = await createSupabaseServerClient();
  const [rows, invites] = await Promise.all([
    supabase
      .from("team_members")
      .select("id, team_id, user_id, display_name, member_code, job_title, role, status, account:profiles!team_members_user_id_fkey(email)")
      .eq("team_id", teamId),
    includeInvites ? supabase.rpc("get_team_invites", { p_team_id: teamId }) : Promise.resolve({ data: [], error: null }),
  ]);
  const inviteMap = new Map<string, string>(
    (unwrap(invites) as { team_member_id: string; email: string }[]).map((invite) => [invite.team_member_id, invite.email]),
  );
  const order: Record<TeamRole, number> = { team_lead: 0, team_member: 1 };
  return unwrap(rows)
    .map((row) => ({
      id: row.id,
      teamId: row.team_id,
      userId: row.user_id,
      displayName: row.display_name,
      memberCode: row.member_code,
      jobTitle: row.job_title,
      role: row.role as TeamRole,
      status: row.status as TeamMemberStatus,
      inviteEmail: inviteMap.get(row.id) ?? null,
      accountEmail: row.account?.email ?? null,
    }))
    .sort((a, b) => order[a.role] - order[b.role] || a.memberCode.localeCompare(b.memberCode));
}

/** The caller's roster entries (for the role badge and member codes). */
export async function listMyTeamMemberships(userId: string) {
  const supabase = await createSupabaseServerClient();
  const rows = unwrap(
    await supabase
      .from("team_members")
      .select("team_id, role, status, member_code, job_title, team:teams(name)")
      .eq("user_id", userId)
      .eq("status", "active"),
  );
  return rows.map((row) => ({
    teamId: row.team_id,
    teamName: row.team?.name ?? "",
    role: row.role as TeamRole,
    memberCode: row.member_code,
    jobTitle: row.job_title,
  }));
}

/** Member code and title per user in a team (assignment form). */
export async function getRosterIndex(teamId: string | null) {
  const index = new Map<string, { code: string; jobTitle: string }>();
  if (!teamId) return index;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("team_members")
    .select("user_id, member_code, job_title")
    .eq("team_id", teamId)
    .not("user_id", "is", null);
  for (const row of data ?? []) {
    if (row.user_id) index.set(row.user_id, { code: row.member_code, jobTitle: row.job_title });
  }
  return index;
}

/**
 * Published final results (RLS: the task's team, supervisors and Directors).
 * The publication is a sanitized copy: no drafts, earlier versions or review notes.
 */
export async function listPublications(options: { teamId?: string; projectId?: string; limit?: number } = {}): Promise<PublicationItem[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("task_publications")
    .select(
      `task_id, project_id, team_id, task_code, title, responsible_name, responsible_title, final_result,
       deliverable_links, team_comment, final_submission_version, completed_at,
       team:teams(name), project:projects(name)`,
    );
  if (options.teamId) query = query.eq("team_id", options.teamId);
  if (options.projectId) query = query.eq("project_id", options.projectId);
  const rows = unwrap(await query.order("completed_at", { ascending: false }).limit(options.limit ?? 100));
  return rows.map((row) => ({
    taskId: row.task_id,
    projectId: row.project_id,
    projectName: row.project?.name ?? null,
    teamId: row.team_id,
    teamName: row.team?.name ?? null,
    code: row.task_code,
    title: row.title,
    responsibleName: row.responsible_name,
    responsibleTitle: row.responsible_title,
    finalResult: row.final_result,
    links: row.deliverable_links ?? [],
    teamComment: row.team_comment,
    version: row.final_submission_version,
    completedAt: row.completed_at,
  }));
}

/** Platform users with their Director flag (Directors / platform admins). */
export async function listDirectorCandidates() {
  const supabase = await createSupabaseServerClient();
  const rows = unwrap(
    await supabase.from("profiles").select("id, full_name, email, is_director").order("full_name"),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.full_name.trim() || row.email || "—",
    email: row.email,
    isDirector: row.is_director,
  }));
}

/** The team a project belongs to (name visible to its members). */
export async function getProjectTeam(projectId: string): Promise<{ id: string; name: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("projects").select("team_id, team:teams(id, name)").eq("id", projectId).maybeSingle();
  if (!data?.team_id) return null;
  return { id: data.team_id, name: data.team?.name ?? "" };
}
