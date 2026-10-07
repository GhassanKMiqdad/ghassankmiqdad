import "server-only";

import { AppError } from "@/lib/errors";
import { FieldValue, firebaseAdminAuth, firebaseAdminFirestore } from "@/lib/firebase/admin";
import { can } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";

export async function requireProjectManager(userId: string, projectId: string) {
  const access = await getProjectAccess(projectId);
  if (!access || access.userId !== userId || access.status !== "active" || !can(access, "project.view")) {
    throw new AppError("PROJECT_ACCESS_DENIED");
  }
  if (!access.isOwner && !can(access, "members.manage")) throw new AppError("PERMISSION_DENIED");
  return access;
}

export async function requireProjectPermission(
  userId: string,
  projectId: string,
  permission: Parameters<typeof can>[1],
) {
  const access = await getProjectAccess(projectId);
  if (!access || access.userId !== userId || access.status !== "active" || !can(access, "project.view")) {
    throw new AppError("PROJECT_ACCESS_DENIED");
  }
  if (!can(access, permission)) throw new AppError("PERMISSION_DENIED");
  return access;
}

export async function canReadTeam(userId: string, team: FirebaseFirestore.DocumentData): Promise<boolean> {
  const projectId = typeof team.project_id === "string" ? team.project_id : "";
  if (!projectId) return false;
  const access = await getProjectAccess(projectId);
  if (!access || access.userId !== userId || access.status !== "active" || !can(access, "project.view")) return false;
  if (access.isOwner || can(access, "members.manage")) return true;
  const membership = await firebaseAdminFirestore()
    .collection("team_members")
    .doc(`${String(team.id)}_${userId}`)
    .get();
  return membership.exists && membership.get("status") === "active";
}

export async function requireTaskAccess(userId: string, taskId: string) {
  const db = firebaseAdminFirestore();
  const snapshot = await db.collection("tasks").doc(taskId).get();
  if (!snapshot.exists) throw new AppError("NOT_FOUND");
  const task = snapshot.data()!;
  const projectId = String(task.project_id ?? "");
  const access = await getProjectAccess(projectId);
  if (!access || access.userId !== userId || access.status !== "active" || !can(access, "project.view")) {
    throw new AppError("NOT_FOUND");
  }
  const assigned = task.assigned_to === userId;
  let teamVisible = true;
  if (typeof task.team_id === "string" && !access.isOwner && !can(access, "members.manage")) {
    const membership = await db.collection("team_members").doc(`${task.team_id}_${userId}`).get();
    teamVisible = membership.exists && membership.get("status") === "active";
  }
  const canViewAllTasks = access.isOwner || can(access, "tasks.view");
  const canReviewCurrentTask = can(access, "tasks.review") && ["submitted", "review"].includes(String(task.status));
  if (!assigned && (!teamVisible || (!canViewAllTasks && !canReviewCurrentTask))) {
    throw new AppError("NOT_FOUND");
  }
  return { db, taskRef: snapshot.ref, task, access, projectId };
}

export async function writeResearchAudit(input: {
  userId: string;
  projectId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  label?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}) {
  const db = firebaseAdminFirestore();
  const profile = await db.collection("profiles").doc(input.userId).get();
  const id = crypto.randomUUID();
  await db
    .collection("activity_logs")
    .doc(id)
    .create({
      id,
      project_id: input.projectId,
      actor_id: input.userId,
      actor_email: profile.get("email") ?? null,
      actor_name: profile.get("full_name") ?? profile.get("email") ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      entity_label: input.label ?? null,
      old_values: input.oldValues ?? null,
      new_values: input.newValues ?? null,
      metadata: { source: "research-domain" },
      created_at: FieldValue.serverTimestamp(),
    });
}

export async function createResearchNotification(input: {
  userId: string;
  projectId: string;
  type: string;
  title: string;
  href: string;
  entityId?: string | null;
  dedupeId?: string;
}) {
  const db = firebaseAdminFirestore();
  const id = input.dedupeId ?? crypto.randomUUID();
  await db
    .collection("notifications")
    .doc(id)
    .create({
      id,
      user_id: input.userId,
      project_id: input.projectId,
      type: input.type,
      task_id: input.entityId ?? null,
      task_title: input.title,
      href: input.href,
      read_at: null,
      created_at: FieldValue.serverTimestamp(),
    });
}

export async function revokeResearcherSessions(userId: string) {
  await firebaseAdminAuth().revokeRefreshTokens(userId);
}
