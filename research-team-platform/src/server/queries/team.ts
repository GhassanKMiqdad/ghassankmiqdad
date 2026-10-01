import "server-only";

import { isPermissionKey, sortPermissionKeys } from "@/lib/permissions/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { unwrap } from "@/server/action";
import type { TeamMember } from "@/types/app";

/** Team overview (requires team.view; enforced by the get_project_team RPC). */
export async function getProjectTeam(projectId: string): Promise<TeamMember[]> {
  const supabase = await createSupabaseServerClient();
  const rows = unwrap(await supabase.rpc("get_project_team", { p_project_id: projectId }));
  return (rows ?? []).map((row) => ({
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    displayName: row.full_name?.trim() || row.email || "—",
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    lastSignInAt: row.last_sign_in_at ?? null,
    permissions: sortPermissionKeys((row.permissions ?? []).filter(isPermissionKey)),
    assignedOpenTasks: Number(row.assigned_open_tasks ?? 0),
    assignedTotalTasks: Number(row.assigned_total_tasks ?? 0),
    lastActivityAt: row.last_activity_at ?? null,
  }));
}

export async function getTeamMember(projectId: string, userId: string): Promise<TeamMember | null> {
  const team = await getProjectTeam(projectId);
  return team.find((member) => member.userId === userId) ?? null;
}
