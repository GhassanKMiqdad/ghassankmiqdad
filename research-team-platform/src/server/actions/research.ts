"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { FieldValue, firebaseAdminAuth, firebaseAdminFirestore } from "@/lib/firebase/admin";
import { can } from "@/lib/permissions/policy";
import {
  milestoneFormSchema,
  researcherProfileSchema,
  taskReviewSchema,
  taskSubmissionSchema,
  teamFormSchema,
  teamLeadSchema,
  teamMemberSchema,
} from "@/lib/validation/research";
import { uuidField } from "@/lib/validation/common";
import { getProjectAccess } from "@/server/access";
import { parseInput, runAction } from "@/server/action";
import {
  createResearchNotification,
  requireProjectManager,
  requireTaskAccess,
  writeResearchAudit,
} from "@/server/research-domain";

function refreshProject(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
  revalidatePath(`/projects/${projectId}/teams`);
  revalidatePath(`/projects/${projectId}/milestones`);
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  revalidatePath("/reports");
}

async function requireTeamManager(userId: string, teamId: string) {
  const db = firebaseAdminFirestore();
  const teamRef = db.collection("teams").doc(teamId);
  const snapshot = await teamRef.get();
  if (!snapshot.exists) throw new AppError("NOT_FOUND");
  const team = snapshot.data()!;
  const projectId = String(team.project_id ?? "");
  await requireProjectManager(userId, projectId);
  return { db, teamRef, team, projectId };
}

export async function createResearchTeamAction(
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ teamId: string }>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, projectId);
    const values = parseInput(teamFormSchema, input);
    await requireProjectManager(user.id, id);
    const db = firebaseAdminFirestore();
    const teamId = crypto.randomUUID();
    const now = FieldValue.serverTimestamp();
    await db.collection("teams").doc(teamId).create({
      id: teamId,
      project_id: id,
      name: values.name,
      description: values.description,
      status: "active",
      lead_id: null,
      created_by: user.id,
      created_at: now,
      updated_at: now,
    });
    await writeResearchAudit({
      userId: user.id,
      projectId: id,
      action: "team_created",
      entityType: "team",
      entityId: teamId,
      label: values.name,
    });
    refreshProject(id);
    return { teamId };
  });
}

export async function updateResearchTeamAction(teamId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, teamId);
    const values = parseInput(teamFormSchema, input);
    const { teamRef, team, projectId } = await requireTeamManager(user.id, id);
    await teamRef.update({
      name: values.name,
      description: values.description,
      updated_at: FieldValue.serverTimestamp(),
    });
    await writeResearchAudit({
      userId: user.id,
      projectId,
      action: "team_updated",
      entityType: "team",
      entityId: id,
      label: values.name,
      oldValues: { name: team.name },
      newValues: values,
    });
    refreshProject(projectId);
    return null;
  });
}

export async function archiveResearchTeamAction(teamId: string): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, teamId);
    const { teamRef, team, projectId } = await requireTeamManager(user.id, id);
    await teamRef.update({ status: "archived", updated_at: FieldValue.serverTimestamp() });
    await writeResearchAudit({
      userId: user.id,
      projectId,
      action: "team_archived",
      entityType: "team",
      entityId: id,
      label: String(team.name ?? ""),
    });
    refreshProject(projectId);
    return null;
  });
}

export async function addResearchTeamMemberAction(teamId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, teamId);
    const { db, team, projectId } = await requireTeamManager(user.id, id);
    const { userId } = parseInput(teamMemberSchema, input);
    const projectMember = await db.collection("project_members").doc(`${projectId}_${userId}`).get();
    if (!projectMember.exists || projectMember.get("status") !== "active") throw new AppError("ASSIGNEE_NOT_MEMBER");
    const ref = db.collection("team_members").doc(`${id}_${userId}`);
    await ref.set(
      {
        id: ref.id,
        team_id: id,
        project_id: projectId,
        user_id: userId,
        role: team.lead_id === userId ? "lead" : "member",
        status: "active",
        added_by: user.id,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await writeResearchAudit({
      userId: user.id,
      projectId,
      action: "team_member_added",
      entityType: "team_member",
      entityId: ref.id,
      newValues: { team_id: id, user_id: userId },
    });
    await createResearchNotification({
      userId,
      projectId,
      type: "team_assigned",
      title: String(team.name ?? ""),
      href: `/projects/${projectId}/teams/${id}`,
      entityId: id,
    });
    refreshProject(projectId);
    return null;
  });
}

export async function removeResearchTeamMemberAction(teamId: string, memberId: string): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, teamId);
    const userId = parseInput(uuidField, memberId);
    const { db, teamRef, team, projectId } = await requireTeamManager(user.id, id);
    const ref = db.collection("team_members").doc(`${id}_${userId}`);
    const membership = await ref.get();
    if (!membership.exists) throw new AppError("NOT_FOUND");
    const batch = db.batch();
    batch.delete(ref);
    if (team.lead_id === userId) batch.update(teamRef, { lead_id: null, updated_at: FieldValue.serverTimestamp() });
    await batch.commit();
    await writeResearchAudit({
      userId: user.id,
      projectId,
      action: "team_member_removed",
      entityType: "team_member",
      entityId: ref.id,
      oldValues: { team_id: id, user_id: userId },
    });
    refreshProject(projectId);
    return null;
  });
}

export async function setResearchTeamLeadAction(teamId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, teamId);
    const { db, teamRef, team, projectId } = await requireTeamManager(user.id, id);
    const { userId: leadId } = parseInput(teamLeadSchema, input);
    if (leadId) {
      const member = await db.collection("team_members").doc(`${id}_${leadId}`).get();
      if (!member.exists || member.get("status") !== "active") throw new AppError("ASSIGNEE_NOT_MEMBER");
      await member.ref.update({ role: "lead", updated_at: FieldValue.serverTimestamp() });
    }
    if (team.lead_id && team.lead_id !== leadId) {
      const previous = db.collection("team_members").doc(`${id}_${String(team.lead_id)}`);
      const oldMember = await previous.get();
      if (oldMember.exists) await previous.update({ role: "member", updated_at: FieldValue.serverTimestamp() });
    }
    await teamRef.update({ lead_id: leadId, updated_at: FieldValue.serverTimestamp() });
    await writeResearchAudit({
      userId: user.id,
      projectId,
      action: "team_lead_changed",
      entityType: "team",
      entityId: id,
      oldValues: { lead_id: team.lead_id ?? null },
      newValues: { lead_id: leadId },
    });
    refreshProject(projectId);
    return null;
  });
}

export async function createMilestoneAction(
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ milestoneId: string }>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, projectId);
    const values = parseInput(milestoneFormSchema, input);
    await requireProjectManager(user.id, id);
    const db = firebaseAdminFirestore();
    if (values.responsibleResearcherId) {
      const member = await db.collection("project_members").doc(`${id}_${values.responsibleResearcherId}`).get();
      if (!member.exists || member.get("status") !== "active") throw new AppError("ASSIGNEE_NOT_MEMBER");
    }
    if (values.responsibleTeamId) {
      const team = await db.collection("teams").doc(values.responsibleTeamId).get();
      if (!team.exists || team.get("project_id") !== id || team.get("status") === "archived")
        throw new AppError("INVALID_INPUT");
    }
    const milestoneId = crypto.randomUUID();
    await db
      .collection("milestones")
      .doc(milestoneId)
      .create({
        id: milestoneId,
        project_id: id,
        name: values.name,
        description: values.description,
        deadline: values.deadline,
        responsible_team_id: values.responsibleTeamId,
        responsible_researcher_id: values.responsibleResearcherId,
        status: values.status,
        completed_at: values.status === "completed" ? FieldValue.serverTimestamp() : null,
        created_by: user.id,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    await writeResearchAudit({
      userId: user.id,
      projectId: id,
      action: "milestone_created",
      entityType: "milestone",
      entityId: milestoneId,
      label: values.name,
      newValues: values,
    });
    const targets = values.responsibleResearcherId
      ? [values.responsibleResearcherId]
      : values.responsibleTeamId
        ? (
            await db
              .collection("team_members")
              .where("team_id", "==", values.responsibleTeamId)
              .where("status", "==", "active")
              .limit(300)
              .get()
          ).docs.map((doc) => String(doc.get("user_id")))
        : [];
    await Promise.all(
      targets.map((target) =>
        createResearchNotification({
          userId: target,
          projectId: id,
          type: "milestone_assigned",
          title: values.name,
          href: `/projects/${id}/milestones`,
          entityId: milestoneId,
        }),
      ),
    );
    refreshProject(id);
    return { milestoneId };
  });
}

export async function updateMilestoneAction(milestoneId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, milestoneId);
    const values = parseInput(milestoneFormSchema, input);
    const db = firebaseAdminFirestore();
    const ref = db.collection("milestones").doc(id);
    const current = await ref.get();
    if (!current.exists) throw new AppError("NOT_FOUND");
    const row = current.data()!;
    const projectId = String(row.project_id ?? "");
    const access = await getProjectAccess(projectId);
    if (!access || access.userId !== user.id || access.status !== "active" || !can(access, "project.view"))
      throw new AppError("PROJECT_ACCESS_DENIED");
    const manager = access.isOwner || can(access, "members.manage");
    let responsible = row.responsible_researcher_id === user.id;
    if (!responsible && typeof row.responsible_team_id === "string") {
      const membership = await db.collection("team_members").doc(`${row.responsible_team_id}_${user.id}`).get();
      responsible = membership.exists && membership.get("status") === "active";
    }
    if (
      !manager &&
      !(
        responsible &&
        row.status !== "completed" &&
        values.status === "completed" &&
        values.name === row.name &&
        values.description === row.description &&
        values.deadline === (row.deadline ?? null) &&
        values.responsibleTeamId === (row.responsible_team_id ?? null) &&
        values.responsibleResearcherId === (row.responsible_researcher_id ?? null)
      )
    )
      throw new AppError("PERMISSION_DENIED");
    if (manager) {
      if (values.responsibleResearcherId) {
        const member = await db
          .collection("project_members")
          .doc(`${projectId}_${values.responsibleResearcherId}`)
          .get();
        if (!member.exists || member.get("status") !== "active") throw new AppError("ASSIGNEE_NOT_MEMBER");
      }
      if (values.responsibleTeamId) {
        const team = await db.collection("teams").doc(values.responsibleTeamId).get();
        if (!team.exists || team.get("project_id") !== projectId || team.get("status") === "archived")
          throw new AppError("INVALID_INPUT");
      }
      await ref.update({
        name: values.name,
        description: values.description,
        deadline: values.deadline,
        responsible_team_id: values.responsibleTeamId,
        responsible_researcher_id: values.responsibleResearcherId,
        status: values.status,
        completed_at: values.status === "completed" ? FieldValue.serverTimestamp() : null,
        updated_at: FieldValue.serverTimestamp(),
      });
    } else {
      await ref.update({
        status: "completed",
        completed_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    await writeResearchAudit({
      userId: user.id,
      projectId,
      action: "milestone_updated",
      entityType: "milestone",
      entityId: id,
      label: String(row.name ?? ""),
      oldValues: { status: row.status },
      newValues: { ...values },
    });
    refreshProject(projectId);
    if (row.status !== "completed" && values.status === "completed") {
      const managers = await db
        .collection("project_members")
        .where("project_id", "==", projectId)
        .where("status", "==", "active")
        .limit(300)
        .get();
      const recipients = managers.docs
        .filter(
          (member) =>
            member.get("user_id") !== user.id &&
            (member.get("role") === "owner" ||
              (Array.isArray(member.get("permissions")) && member.get("permissions").includes("members.manage"))),
        )
        .map((member) => String(member.get("user_id")));
      await Promise.all(
        recipients.map((recipient) =>
          createResearchNotification({
            userId: recipient,
            projectId,
            type: "milestone_completed",
            title: String(row.name ?? ""),
            href: `/projects/${projectId}/milestones`,
            entityId: id,
            dedupeId: `${id}_completed_${recipient}`,
          }),
        ),
      );
    }
    return null;
  });
}

export async function submitTaskWorkAction(
  input: unknown,
): Promise<ActionResult<{ submissionId: string; version: number }>> {
  return runAction(async (user) => {
    const values = parseInput(taskSubmissionSchema, input);
    const { db, taskRef, task, access, projectId } = await requireTaskAccess(user.id, values.taskId);
    if (task.assigned_to !== user.id || !can(access, "tasks.submit")) throw new AppError("PERMISSION_DENIED");
    if (!["accepted", "in_progress", "revision_required"].includes(String(task.status)))
      throw new AppError("TASK_STATUS_FORBIDDEN");
    const documentRefs = values.documentIds.map((docId) => db.collection("documents").doc(docId));
    const submissionId = crypto.randomUUID();
    let version = 0;
    await db.runTransaction(async (transaction) => {
      const freshTask = await transaction.get(taskRef);
      if (
        !freshTask.exists ||
        freshTask.get("assigned_to") !== user.id ||
        !["accepted", "in_progress", "revision_required"].includes(String(freshTask.get("status")))
      )
        throw new AppError("TASK_STATUS_FORBIDDEN");
      const documentSnapshots = await Promise.all(documentRefs.map((ref) => transaction.get(ref)));
      for (const doc of documentSnapshots) {
        if (
          !doc.exists ||
          doc.get("project_id") !== projectId ||
          doc.get("task_id") !== values.taskId ||
          doc.get("uploaded_by") !== user.id ||
          doc.get("submission_version_id")
        )
          throw new AppError("INVALID_INPUT");
      }
      version = Number(freshTask.get("submission_version") ?? 0) + 1;
      const createdAt = FieldValue.serverTimestamp();
      transaction.create(db.collection("task_submissions").doc(submissionId), {
        id: submissionId,
        project_id: projectId,
        task_id: values.taskId,
        version,
        submitted_by: user.id,
        notes: values.notes,
        document_ids: values.documentIds,
        created_at: createdAt,
      });
      transaction.update(taskRef, {
        status: "submitted",
        progress: 100,
        submission_version: version,
        latest_submission_id: submissionId,
        submitted_at: createdAt,
        updated_at: createdAt,
      });
      for (const doc of documentSnapshots)
        transaction.update(doc.ref, { submission_version_id: submissionId, authorized_users: [user.id] });
    });
    await writeResearchAudit({
      userId: user.id,
      projectId,
      action: "task_submitted",
      entityType: "task_submission",
      entityId: submissionId,
      label: String(task.title ?? ""),
      newValues: { task_id: values.taskId, version, document_ids: values.documentIds },
    });
    const reviewers = await db
      .collection("project_members")
      .where("project_id", "==", projectId)
      .where("status", "==", "active")
      .limit(300)
      .get();
    const recipients = reviewers.docs
      .filter(
        (member) =>
          member.get("user_id") !== user.id &&
          (member.get("role") === "owner" ||
            (Array.isArray(member.get("permissions")) && member.get("permissions").includes("tasks.review"))),
      )
      .map((member) => String(member.get("user_id")));
    await Promise.all(
      recipients.map((recipient) =>
        createResearchNotification({
          userId: recipient,
          projectId,
          type: "task_submitted",
          title: String(task.title ?? ""),
          href: `/projects/${projectId}/tasks/${values.taskId}`,
          entityId: values.taskId,
          dedupeId: `${submissionId}_${recipient}`,
        }),
      ),
    );
    revalidatePath(`/projects/${projectId}/tasks/${values.taskId}`);
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    return { submissionId, version };
  });
}

export async function startTaskReviewAction(taskId: string): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, taskId);
    const { db, taskRef, task, access, projectId } = await requireTaskAccess(user.id, id);
    if (!can(access, "tasks.review") || task.assigned_to === user.id) throw new AppError("PERMISSION_DENIED");
    if (task.status !== "submitted" || !task.latest_submission_id) throw new AppError("TASK_STATUS_FORBIDDEN");
    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(taskRef);
      if (fresh.get("status") !== "submitted" || fresh.get("latest_submission_id") !== task.latest_submission_id)
        throw new AppError("TASK_STATUS_FORBIDDEN");
      transaction.update(taskRef, {
        status: "review",
        review_started_by: user.id,
        review_started_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    });
    await writeResearchAudit({
      userId: user.id,
      projectId,
      action: "review_started",
      entityType: "task",
      entityId: id,
      label: String(task.title ?? ""),
      oldValues: { status: "submitted" },
      newValues: { status: "review", submission_id: task.latest_submission_id },
    });
    revalidatePath(`/projects/${projectId}/tasks/${id}`);
    return null;
  });
}

export async function reviewTaskSubmissionAction(input: unknown): Promise<ActionResult<{ reviewId: string }>> {
  return runAction(async (user) => {
    const values = parseInput(taskReviewSchema, input);
    const { db, taskRef, task, access, projectId } = await requireTaskAccess(user.id, values.taskId);
    if (!can(access, "tasks.review") || task.assigned_to === user.id) throw new AppError("PERMISSION_DENIED");
    const reviewId = crypto.randomUUID();
    const reviewRef = db.collection("task_reviews").doc(reviewId);
    await db.runTransaction(async (transaction) => {
      const freshTask = await transaction.get(taskRef);
      const submissionRef = db.collection("task_submissions").doc(values.submissionId);
      const submission = await transaction.get(submissionRef);
      if (
        !submission.exists ||
        submission.get("task_id") !== values.taskId ||
        freshTask.get("latest_submission_id") !== values.submissionId ||
        !["submitted", "review"].includes(String(freshTask.get("status")))
      )
        throw new AppError("TASK_STATUS_FORBIDDEN");
      transaction.create(reviewRef, {
        id: reviewId,
        project_id: projectId,
        task_id: values.taskId,
        submission_id: values.submissionId,
        reviewer_id: user.id,
        decision: values.decision,
        feedback: values.feedback,
        created_at: FieldValue.serverTimestamp(),
      });
      transaction.update(taskRef, {
        status: values.decision,
        latest_review_id: reviewId,
        completed_at: null,
        updated_at: FieldValue.serverTimestamp(),
      });
    });
    await writeResearchAudit({
      userId: user.id,
      projectId,
      action: `task_${values.decision}`,
      entityType: "task_review",
      entityId: reviewId,
      label: String(task.title ?? ""),
      newValues: { task_id: values.taskId, submission_id: values.submissionId, decision: values.decision },
    });
    if (task.assigned_to) {
      const type =
        values.decision === "approved"
          ? "submission_approved"
          : values.decision === "revision_required"
            ? "revision_requested"
            : "submission_rejected";
      await createResearchNotification({
        userId: String(task.assigned_to),
        projectId,
        type,
        title: String(task.title ?? ""),
        href: `/projects/${projectId}/tasks/${values.taskId}`,
        entityId: values.taskId,
        dedupeId: `${reviewId}_${task.assigned_to}`,
      });
    }
    revalidatePath(`/projects/${projectId}/tasks/${values.taskId}`);
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    return { reviewId };
  });
}

export async function completeApprovedTaskAction(taskId: string): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, taskId);
    const { db, taskRef, task, access, projectId } = await requireTaskAccess(user.id, id);
    if (!can(access, "tasks.review") || task.assigned_to === user.id) throw new AppError("PERMISSION_DENIED");
    if (task.status !== "approved" || typeof task.latest_review_id !== "string")
      throw new AppError("TASK_STATUS_FORBIDDEN");
    await db.runTransaction(async (transaction) => {
      const freshTask = await transaction.get(taskRef);
      const reviewRef = db.collection("task_reviews").doc(String(task.latest_review_id));
      const review = await transaction.get(reviewRef);
      if (
        !freshTask.exists ||
        freshTask.get("status") !== "approved" ||
        freshTask.get("latest_review_id") !== task.latest_review_id ||
        !review.exists ||
        review.get("task_id") !== id ||
        review.get("decision") !== "approved"
      )
        throw new AppError("TASK_STATUS_FORBIDDEN");
      transaction.update(taskRef, {
        status: "completed",
        completed_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    });
    await writeResearchAudit({
      userId: user.id,
      projectId,
      action: "task_completed",
      entityType: "task",
      entityId: id,
      label: String(task.title ?? ""),
      oldValues: { status: "approved" },
      newValues: { status: "completed", review_id: task.latest_review_id },
    });
    if (task.assigned_to)
      await createResearchNotification({
        userId: String(task.assigned_to),
        projectId,
        type: "task_completed",
        title: String(task.title ?? ""),
        href: `/projects/${projectId}/tasks/${id}`,
        entityId: id,
        dedupeId: `${task.latest_review_id}_${task.assigned_to}_completed`,
      });
    revalidatePath(`/projects/${projectId}/tasks/${id}`);
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    return null;
  });
}

export async function updateResearcherProfileAction(userId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async (actor) => {
    const id = parseInput(uuidField, userId);
    const values = parseInput(researcherProfileSchema, input);
    const db = firebaseAdminFirestore();
    const [actorProfile, targetRef] = await Promise.all([
      db.collection("profiles").doc(actor.id).get(),
      Promise.resolve(db.collection("profiles").doc(id)),
    ]);
    if (actorProfile.get("is_platform_admin") !== true) throw new AppError("PERMISSION_DENIED");
    const target = await targetRef.get();
    if (!target.exists) throw new AppError("USER_NOT_FOUND");
    if (target.get("is_platform_admin") === true && values.status !== "active") throw new AppError("PERMISSION_DENIED");
    const before = { status: target.get("status") ?? "active", full_name: target.get("full_name") ?? "" };
    await targetRef.update({
      full_name: values.fullName,
      phone: values.phone?.trim() || null,
      avatar_url: values.avatarUrl || null,
      specialization: values.specialization ?? "",
      skills: values.skills ?? [],
      academic_background: values.academicBackground ?? "",
      status: values.status,
      researcher_notes: values.notes ?? "",
      updated_at: FieldValue.serverTimestamp(),
    });
    const authUser = await firebaseAdminAuth().getUser(id);
    await firebaseAdminAuth().updateUser(id, { disabled: values.status !== "active" });
    if (authUser.disabled !== (values.status !== "active")) await firebaseAdminAuth().revokeRefreshTokens(id);
    await writeResearchAudit({
      userId: actor.id,
      projectId: null,
      action: "researcher_profile_updated",
      entityType: "researcher",
      entityId: id,
      label: values.fullName,
      oldValues: before,
      newValues: { full_name: values.fullName, status: values.status },
    });
    revalidatePath("/researchers");
    revalidatePath(`/researchers/${id}`);
    return null;
  });
}
