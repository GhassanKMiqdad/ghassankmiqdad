import "server-only";

import { AppError } from "@/lib/errors";
import { firebaseAdminFirestore } from "@/lib/firebase/admin";
import { can } from "@/lib/permissions/policy";
import { canSeeMilestone, canSeeTeam } from "@/lib/domain/research-associations";
import { getProjectAccess } from "@/server/access";
import type { ProjectMilestone, ProjectResearcher, ProjectTeam } from "@/types/research";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asDateString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return "";
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function assertTeamView(projectId: string) {
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) throw new AppError("PROJECT_ACCESS_DENIED");
  if (!can(access, "team.view")) throw new AppError("PERMISSION_DENIED");
  return access;
}

async function assertResearchDirectoryAccess(projectId: string) {
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) throw new AppError("PROJECT_ACCESS_DENIED");
  if (!can(access, "team.view") && !can(access, "project.edit")) throw new AppError("PERMISSION_DENIED");
  return access;
}

function canViewAllTeams(access: NonNullable<Awaited<ReturnType<typeof getProjectAccess>>>) {
  return can(access, "project.edit");
}

export async function getProjectTeams(projectId: string): Promise<ProjectTeam[]> {
  const access = await assertTeamView(projectId);
  const db = firebaseAdminFirestore();
  let query = db.collection("teams").where("projectId", "==", projectId);
  if (!canViewAllTeams(access)) query = query.where("memberIds", "array-contains", access.userId);
  const snapshot = await query.get();
  return snapshot.docs
    .map((doc) => {
      const row = doc.data();
      return {
        id: doc.id,
        projectId,
        name: asString(row.name),
        description: asString(row.description),
        status: row.status === "archived" ? ("archived" as const) : ("active" as const),
        memberIds: stringIds(row.memberIds),
        leadId: typeof row.leadId === "string" ? row.leadId : null,
        createdAt: asDateString(row.createdAt),
        updatedAt: asDateString(row.updatedAt),
      };
    })
    .filter((team) => canSeeTeam(access.userId, team.memberIds, canViewAllTeams(access)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getActiveProjectResearchers(projectId: string): Promise<ProjectResearcher[]> {
  const access = await assertResearchDirectoryAccess(projectId);
  const db = firebaseAdminFirestore();
  let userIds: string[];
  if (canViewAllTeams(access)) {
    const memberships = await db.collection("project_members").where("project_id", "==", projectId).get();
    userIds = memberships.docs
      .filter((doc) => doc.get("status") === "active" && doc.get("project_id") === projectId)
      .map((doc) => asString(doc.get("user_id")))
      .filter(Boolean);
  } else {
    const teams = await db
      .collection("teams")
      .where("projectId", "==", projectId)
      .where("memberIds", "array-contains", access.userId)
      .get();
    const assignedIds = new Set(
      teams.docs.filter((doc) => doc.get("status") === "active").flatMap((doc) => stringIds(doc.get("memberIds"))),
    );
    if (!assignedIds.size) return [];
    const memberships = await db.getAll(
      ...[...assignedIds].map((id) => db.collection("project_members").doc(`${projectId}_${id}`)),
    );
    userIds = memberships
      .filter((doc) => doc.exists && doc.get("project_id") === projectId && doc.get("status") === "active")
      .map((doc) => asString(doc.get("user_id")))
      .filter(Boolean);
  }
  const uniqueIds = [...new Set(userIds)];
  if (!uniqueIds.length) return [];
  const profiles = await db.getAll(...uniqueIds.map((id) => db.collection("profiles").doc(id)));
  return profiles
    .map((profile) => {
      const row = profile.exists ? profile.data()! : {};
      const email = typeof row.email === "string" ? row.email : null;
      const name = asString(row.full_name).trim() || asString(row.display_name).trim() || email || "—";
      return { id: profile.id, name, email };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProjectMilestones(projectId: string): Promise<ProjectMilestone[]> {
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) throw new AppError("PROJECT_ACCESS_DENIED");
  const db = firebaseAdminFirestore();
  const mayViewAll = can(access, "project.edit");
  let snapshots: FirebaseFirestore.QueryDocumentSnapshot[];
  if (mayViewAll) {
    snapshots = (await db.collection("milestones").where("projectId", "==", projectId).get()).docs;
  } else {
    const teams = await db
      .collection("teams")
      .where("projectId", "==", projectId)
      .where("memberIds", "array-contains", access.userId)
      .get();
    const visibleTeamIds = new Set(teams.docs.filter((doc) => doc.get("status") === "active").map((doc) => doc.id));
    const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [
      db
        .collection("milestones")
        .where("projectId", "==", projectId)
        .where("researcherIds", "array-contains", access.userId)
        .get(),
    ];
    const teamIds = [...visibleTeamIds];
    for (let index = 0; index < teamIds.length; index += 30) {
      const chunk = teamIds.slice(index, index + 30);
      if (chunk.length)
        queries.push(
          db.collection("milestones").where("projectId", "==", projectId).where("teamId", "in", chunk).get(),
        );
    }
    const results = await Promise.all(queries);
    snapshots = [...new Map(results.flatMap((result) => result.docs).map((doc) => [doc.id, doc])).values()];
    snapshots = snapshots.filter((doc) => {
      const row = doc.data();
      return canSeeMilestone(
        access.userId,
        stringIds(row.researcherIds),
        typeof row.teamId === "string" ? row.teamId : null,
        visibleTeamIds,
        false,
      );
    });
  }
  return snapshots
    .map((doc) => {
      const row = doc.data();
      return {
        id: doc.id,
        projectId,
        title: asString(row.title),
        description: asString(row.description),
        dueDate: typeof row.dueDate === "string" ? row.dueDate : null,
        status: row.status === "completed" || row.status === "archived" ? row.status : "open",
        teamId: typeof row.teamId === "string" ? row.teamId : null,
        researcherIds: stringIds(row.researcherIds),
        createdAt: asDateString(row.createdAt),
        updatedAt: asDateString(row.updatedAt),
      };
    })
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title));
}
