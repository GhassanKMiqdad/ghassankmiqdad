import "server-only";

import { can } from "@/lib/permissions/policy";
import { createFirebaseServerClient } from "@/lib/firebase/compat";
import { unwrap, unwrapMaybe } from "@/server/action";
import { getMyProjectsAccess } from "@/server/access";
import { getDashboardStats } from "@/server/queries/dashboard";
import { PROFILE_FIELDS, toUserRef } from "@/server/queries/shared";
import type { ProjectDetails, ProjectListItem } from "@/types/app";

export async function listMyProjects(): Promise<ProjectListItem[]> {
  const access = (await getMyProjectsAccess()).filter((item) => can(item, "project.view"));
  if (access.length === 0) return [];

  const firebase = await createFirebaseServerClient();
  const ids = access.map((item) => item.projectId);
  // Member counts are only shown where the user may see the team.
  const teamVisible = access.filter((item) => can(item, "team.view")).map((item) => item.projectId);

  const [projects, memberRows, stats] = await Promise.all([
    firebase
      .from("projects")
      .select("id, name, description, status, start_date, deadline, updated_at")
      .in("id", ids)
      .order("updated_at", { ascending: false }),
    teamVisible.length > 0
      ? firebase.from("project_members").select("project_id").in("project_id", teamVisible).eq("status", "active")
      : Promise.resolve({ data: [] as { project_id: string }[], error: null }),
    getDashboardStats(),
  ]);

  const memberCounts = new Map<string, number>();
  for (const row of unwrap(memberRows)) {
    memberCounts.set(row.project_id, (memberCounts.get(row.project_id) ?? 0) + 1);
  }
  const progress = new Map(stats.projectProgress.map((item) => [item.projectId, item]));
  const roles = new Map(access.map((item) => [item.projectId, item.role]));

  return unwrap(projects).map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    startDate: project.start_date,
    deadline: project.deadline,
    updatedAt: project.updated_at,
    role: roles.get(project.id) ?? "member",
    memberCount: memberCounts.get(project.id) ?? null,
    taskTotal: progress.get(project.id)?.total ?? 0,
    taskCompleted: progress.get(project.id)?.completed ?? 0,
  }));
}

export async function getProjectDetails(projectId: string): Promise<ProjectDetails | null> {
  const firebase = await createFirebaseServerClient();
  const project = unwrapMaybe(
    await firebase
      .from("projects")
      .select(
        `id, name, description, research_goal, status, start_date, deadline, created_at, updated_at,
         creator:profiles!projects_created_by_fkey(${PROFILE_FIELDS})`,
      )
      .eq("id", projectId)
      .maybeSingle(),
  );
  if (!project) return null;

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    researchGoal: project.research_goal,
    status: project.status,
    startDate: project.start_date,
    deadline: project.deadline,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    createdBy: toUserRef(project.creator),
  };
}
