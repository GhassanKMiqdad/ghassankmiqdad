"use server";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { firebaseAdminFirestore } from "@/lib/firebase/admin";
import { normalizeTaskStatus } from "@/lib/permissions/catalog";
import { can } from "@/lib/permissions/policy";
import { canSubmitTask, nextSubmissionVersion, taskStatusForReview } from "@/lib/research-workflow";
import { getProjectAccess } from "@/server/access";
import { parseInput, runAction } from "@/server/action";
import { createSubmissionSchema, reviewSubmissionSchema } from "@/lib/validation/submission";
import { uuidField } from "@/lib/validation/common";

const now = () => new Date().toISOString();

function hasPermission(member: FirebaseFirestore.DocumentData, permission: string) {
  return member.role === "owner" || (Array.isArray(member.permissions) && member.permissions.includes(permission));
}

export async function createSubmissionAction(taskId: string, input: unknown) {
  return runAction(async (user) => {
    const id = parseInput(uuidField, taskId);
    const values = parseInput(createSubmissionSchema, input);
    const db = firebaseAdminFirestore();
    const taskRef = db.collection("tasks").doc(id);
    const taskSnapshot = await taskRef.get();
    if (!taskSnapshot.exists) throw new AppError("NOT_FOUND");
    const task = taskSnapshot.data()!;
    const projectId = String(task.project_id ?? "");
    const access = await getProjectAccess(projectId);
    if (!access || !can(access, "project.view")) throw new AppError("NOT_FOUND");
    if (!can(access, "tasks.submit")) throw new AppError("PERMISSION_DENIED");
    const taskStatus = normalizeTaskStatus(task.status);
    if (
      !taskStatus ||
      !canSubmitTask(taskStatus, typeof task.assigned_to === "string" ? task.assigned_to : null, user.id)
    ) {
      throw new AppError("TASK_STATUS_FORBIDDEN");
    }

    const teamId = typeof task.team_id === "string" ? task.team_id : null;
    const [ownersAndManagers, reviewersWithGrant, teamMembers, availableDeliverables] = await Promise.all([
      db
        .collection("project_members")
        .where("project_id", "==", projectId)
        .where("status", "==", "active")
        .where("role", "in", ["owner", "manager"])
        .get(),
      db
        .collection("project_members")
        .where("project_id", "==", projectId)
        .where("status", "==", "active")
        .where("permissions", "array-contains", "tasks.review")
        .get(),
      teamId
        ? db
            .collection("team_members")
            .where("projectId", "==", projectId)
            .where("teamId", "==", teamId)
            .where("status", "==", "active")
            .get()
        : Promise.resolve(null),
      db.collection("deliverables").where("project_id", "==", projectId).where("task_id", "==", id).get(),
    ]);
    const candidateRefs = [
      ...new Map([...ownersAndManagers.docs, ...reviewersWithGrant.docs].map((doc) => [doc.id, doc.ref])).values(),
    ];
    const teamMemberRefs = teamMembers?.docs.map((doc) => doc.ref) ?? [];
    let attachments = values.attachments;
    if (!attachments.length && values.documentIds.length) {
      const eligible = availableDeliverables.docs.filter((doc) => doc.get("status") !== "approved");
      if (eligible.length !== 1) throw new AppError("INVALID_INPUT");
      attachments = values.documentIds.map((documentId: string) => ({ documentId, deliverableId: eligible[0].id }));
    }
    const deliverableIds = [
      ...new Set(attachments.map((attachment: { deliverableId: string }) => attachment.deliverableId)),
    ];
    const actorMemberRef = db.collection("project_members").doc(`${projectId}_${user.id}`);
    const actorTeamMemberRef = teamId ? db.collection("team_members").doc(`${teamId}_${user.id}`) : null;
    const actorProfile = await db.collection("profiles").doc(user.id).get();
    const actorName = String(actorProfile.get("full_name") ?? user.email ?? "Researcher");
    const docRefs = attachments.map((attachment: { documentId: string; deliverableId: string }) =>
      db.collection("documents").doc(attachment.documentId),
    );
    const deliverableRefs = deliverableIds.map((deliverableId) => db.collection("deliverables").doc(deliverableId));
    const submissionRef = db.collection("submissions").doc(crypto.randomUUID());
    const activityRef = db.collection("activity_logs").doc(crypto.randomUUID());

    await db.runTransaction(async (transaction) => {
      const [
        currentTaskSnapshot,
        actorMember,
        actorTeamMember,
        currentMemberships,
        currentTeamMembers,
        documents,
        deliverables,
      ] = await Promise.all([
        transaction.get(taskRef),
        transaction.get(actorMemberRef),
        actorTeamMemberRef ? transaction.get(actorTeamMemberRef) : Promise.resolve(null),
        Promise.all(candidateRefs.map((ref) => transaction.get(ref))),
        Promise.all(teamMemberRefs.map((ref) => transaction.get(ref))),
        Promise.all(docRefs.map((ref) => transaction.get(ref))),
        Promise.all(deliverableRefs.map((ref) => transaction.get(ref))),
      ]);
      if (!currentTaskSnapshot.exists) throw new AppError("NOT_FOUND");
      if (
        !actorMember.exists ||
        actorMember.get("status") !== "active" ||
        !hasPermission(actorMember.data()!, "tasks.submit")
      ) {
        throw new AppError("PERMISSION_DENIED");
      }
      const currentTask = currentTaskSnapshot.data()!;
      const currentTeamId = typeof currentTask.team_id === "string" ? currentTask.team_id : null;
      if (
        currentTask.project_id !== projectId ||
        currentTeamId !== teamId ||
        !canSubmitTask(
          String(currentTask.status) as typeof task.status,
          typeof currentTask.assigned_to === "string" ? currentTask.assigned_to : null,
          user.id,
        )
      ) {
        throw new AppError("TASK_STATUS_FORBIDDEN");
      }
      if (
        teamId &&
        !can(access, "project.edit") &&
        (!actorTeamMember?.exists ||
          actorTeamMember.get("status") !== "active" ||
          actorTeamMember.get("projectId") !== projectId)
      ) {
        throw new AppError("PERMISSION_DENIED");
      }
      const teamReviewerIds = new Set(
        currentTeamMembers
          .filter(
            (member) => member.exists && member.get("status") === "active" && member.get("projectId") === projectId,
          )
          .map((member) => String(member.get("userId"))),
      );
      const reviewers = currentMemberships
        .filter((member) => {
          if (!member.exists || member.get("status") !== "active" || !hasPermission(member.data()!, "tasks.review"))
            return false;
          const data = member.data()!;
          const projectWide =
            data.role === "owner" || (Array.isArray(data.permissions) && data.permissions.includes("project.edit"));
          return !teamId || projectWide || teamReviewerIds.has(String(data.user_id));
        })
        .map((member) => String(member.get("user_id")));
      for (const [index, document] of documents.entries()) {
        const attachment = attachments[index];
        if (
          !document.exists ||
          document.get("project_id") !== projectId ||
          document.get("uploaded_by") !== user.id ||
          document.get("submission_id") ||
          document.get("task_id") ||
          (document.get("team_id") && document.get("team_id") !== teamId) ||
          !attachment
        ) {
          throw new AppError("PERMISSION_DENIED");
        }
      }

      const deliverablesById = new Map(deliverables.filter((item) => item.exists).map((item) => [item.id, item]));
      const attachmentIdsByDeliverable = new Map<string, string[]>();
      for (const attachment of attachments) {
        const deliverable = deliverablesById.get(attachment.deliverableId);
        if (
          !deliverable ||
          deliverable.get("project_id") !== projectId ||
          deliverable.get("task_id") !== id ||
          deliverable.get("status") === "approved" ||
          (deliverable.get("team_id") && deliverable.get("team_id") !== teamId)
        ) {
          throw new AppError("INVALID_INPUT");
        }
        attachmentIdsByDeliverable.set(attachment.deliverableId, [
          ...(attachmentIdsByDeliverable.get(attachment.deliverableId) ?? []),
          attachment.documentId,
        ]);
      }
      const requiredDeliverables = deliverables.filter(
        (item) => item.exists && item.get("required") === true && item.get("status") !== "approved",
      );
      if (requiredDeliverables.some((item) => !attachmentIdsByDeliverable.has(item.id)))
        throw new AppError("INVALID_INPUT");

      const version = nextSubmissionVersion(
        typeof currentTask.latest_submission_id === "string" && Number.isInteger(currentTask.latest_submission_version)
          ? { id: currentTask.latest_submission_id, versionNumber: Number(currentTask.latest_submission_version) }
          : null,
      );
      const createdAt = now();
      const submission = {
        id: submissionRef.id,
        project_id: projectId,
        team_id: typeof currentTask.team_id === "string" ? currentTask.team_id : null,
        task_id: id,
        researcher_id: user.id,
        researcher_name: actorName,
        version_number: version.versionNumber,
        previous_version_id: version.previousVersionId,
        notes: values.notes,
        status: "submitted",
        file_ids: attachments.map((attachment) => attachment.documentId),
        deliverable_ids: [...attachmentIdsByDeliverable.keys()],
        created_at: createdAt,
        submitted_at: createdAt,
      };
      transaction.create(submissionRef, submission);
      transaction.update(taskRef, {
        status: "submitted",
        latest_submission_id: submissionRef.id,
        latest_submission_version: version.versionNumber,
        submitted_at: createdAt,
        updated_at: createdAt,
      });
      for (const document of documents) {
        const attachment = attachments.find((item) => item.documentId === document.id);
        transaction.update(document.ref, {
          task_id: id,
          submission_id: submissionRef.id,
          team_id: submission.team_id,
          deliverable_id: attachment?.deliverableId ?? null,
          authorized_users: [...new Set([user.id, ...reviewers])],
          updated_at: createdAt,
        });
      }
      for (const [deliverableId, fileIds] of attachmentIdsByDeliverable) {
        const deliverable = deliverablesById.get(deliverableId)!;
        transaction.update(deliverable.ref, {
          status: "submitted",
          submitted_file_ids: fileIds,
          submission_id: submissionRef.id,
          updated_at: createdAt,
        });
      }
      transaction.create(activityRef, {
        id: activityRef.id,
        project_id: projectId,
        actor_id: user.id,
        actor_email: user.email,
        actor_name: actorName,
        action: "submission.created",
        entity_type: "task",
        entity_id: id,
        entity_label: String(currentTask.title ?? ""),
        old_values: null,
        new_values: { task_id: id, version_number: version.versionNumber, file_count: values.documentIds.length },
        metadata: { task_title: String(currentTask.title ?? "") },
        ip_address: null,
        user_agent: null,
        created_at: createdAt,
      });
      for (const reviewerId of reviewers) {
        const notificationRef = db.collection("notifications").doc(crypto.randomUUID());
        transaction.create(notificationRef, {
          id: notificationRef.id,
          user_id: reviewerId,
          project_id: projectId,
          task_id: id,
          task_title: String(currentTask.title ?? ""),
          type: "task_submitted",
          href: `/projects/${projectId}/tasks/${id}/submissions`,
          created_at: createdAt,
          read_at: null,
        });
      }
    });

    revalidatePath(`/projects/${projectId}/tasks/${id}`);
    revalidatePath(`/projects/${projectId}/tasks/${id}/submissions`);
    revalidatePath("/dashboard");
    return { submissionId: submissionRef.id };
  });
}

export async function startSubmissionReviewAction(submissionId: string) {
  return runAction(async (user) => {
    const id = parseInput(uuidField, submissionId);
    const db = firebaseAdminFirestore();
    const submissionRef = db.collection("submissions").doc(id);
    const initial = await submissionRef.get();
    if (!initial.exists) throw new AppError("NOT_FOUND");
    const submissionData = initial.data()!;
    const projectId = String(submissionData.project_id ?? "");
    const taskId = String(submissionData.task_id ?? "");
    const teamId = typeof submissionData.team_id === "string" ? submissionData.team_id : null;
    const access = await getProjectAccess(projectId);
    if (!access || !can(access, "tasks.review")) throw new AppError("PERMISSION_DENIED");
    const taskRef = db.collection("tasks").doc(taskId);
    const reviewerRef = db.collection("project_members").doc(`${projectId}_${user.id}`);
    const teamMemberRef = teamId ? db.collection("team_members").doc(`${teamId}_${user.id}`) : null;
    const profile = await db.collection("profiles").doc(user.id).get();
    const reviewerName = String(profile.get("full_name") ?? user.email ?? "Reviewer");
    const activityRef = db.collection("activity_logs").doc(crypto.randomUUID());
    const timestamp = now();

    await db.runTransaction(async (transaction) => {
      const [submission, task, reviewer, teamMember] = await Promise.all([
        transaction.get(submissionRef),
        transaction.get(taskRef),
        transaction.get(reviewerRef),
        teamMemberRef ? transaction.get(teamMemberRef) : Promise.resolve(null),
      ]);
      if (
        !submission.exists ||
        !task.exists ||
        !reviewer.exists ||
        reviewer.get("status") !== "active" ||
        !hasPermission(reviewer.data()!, "tasks.review")
      )
        throw new AppError("PERMISSION_DENIED");
      const currentSubmission = submission.data()!;
      const currentTask = task.data()!;
      if (
        currentSubmission.project_id !== projectId ||
        currentSubmission.task_id !== taskId ||
        (currentSubmission.team_id ?? null) !== teamId ||
        currentTask.project_id !== projectId ||
        currentTask.latest_submission_id !== submissionRef.id ||
        currentTask.status !== "submitted" ||
        currentSubmission.status !== "submitted"
      )
        throw new AppError("TASK_STATUS_FORBIDDEN");
      if (
        teamId &&
        !can(access, "project.edit") &&
        (!teamMember?.exists || teamMember.get("status") !== "active" || teamMember.get("projectId") !== projectId)
      ) {
        throw new AppError("PERMISSION_DENIED");
      }
      transaction.update(submissionRef, { status: "under_review", review_started_at: timestamp });
      transaction.update(taskRef, { status: "under_review", updated_at: timestamp });
      transaction.create(activityRef, {
        id: activityRef.id,
        project_id: projectId,
        actor_id: user.id,
        actor_email: user.email,
        actor_name: reviewerName,
        action: "submission.review_started",
        entity_type: "task",
        entity_id: taskId,
        entity_label: String(currentTask.title ?? ""),
        old_values: { status: "submitted" },
        new_values: { status: "under_review", submission_id: submissionRef.id },
        metadata: { task_title: String(currentTask.title ?? "") },
        ip_address: null,
        user_agent: null,
        created_at: timestamp,
      });
    });

    revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
    revalidatePath(`/projects/${projectId}/tasks/${taskId}/submissions`);
    return { submissionId: id };
  });
}

export async function reviewSubmissionAction(input: unknown) {
  return runAction(async (user) => {
    const values = parseInput(reviewSubmissionSchema, input);
    const db = firebaseAdminFirestore();
    const submissionRef = db.collection("submissions").doc(values.submissionId);
    const submissionSnapshot = await submissionRef.get();
    if (!submissionSnapshot.exists) throw new AppError("NOT_FOUND");
    const initial = submissionSnapshot.data()!;
    const projectId = String(initial.project_id ?? "");
    const taskId = String(initial.task_id ?? "");
    const teamId = typeof initial.team_id === "string" ? initial.team_id : null;
    const access = await getProjectAccess(projectId);
    if (!access || !can(access, "project.view")) throw new AppError("NOT_FOUND");
    if (!can(access, "tasks.review")) throw new AppError("PERMISSION_DENIED");

    const reviewRef = db.collection("reviews").doc(crypto.randomUUID());
    const activityRef = db.collection("activity_logs").doc(crypto.randomUUID());
    const taskRef = db.collection("tasks").doc(taskId);
    const reviewerMemberRef = db.collection("project_members").doc(`${projectId}_${user.id}`);
    const reviewerTeamMemberRef = teamId ? db.collection("team_members").doc(`${teamId}_${user.id}`) : null;
    const linkedDeliverables = await db.collection("deliverables").where("submission_id", "==", submissionRef.id).get();
    const deliverableRefs = linkedDeliverables.docs.map((deliverable) => deliverable.ref);
    const reviewerProfile = await db.collection("profiles").doc(user.id).get();
    const reviewerName = String(reviewerProfile.get("full_name") ?? user.email ?? "Reviewer");
    const reviewedAt = now();

    await db.runTransaction(async (transaction) => {
      const [submission, task, reviewerMember, reviewerTeamMember, deliverables] = await Promise.all([
        transaction.get(submissionRef),
        transaction.get(taskRef),
        transaction.get(reviewerMemberRef),
        reviewerTeamMemberRef ? transaction.get(reviewerTeamMemberRef) : Promise.resolve(null),
        Promise.all(deliverableRefs.map((ref) => transaction.get(ref))),
      ]);
      if (!submission.exists || !task.exists) throw new AppError("NOT_FOUND");
      if (
        !reviewerMember.exists ||
        reviewerMember.get("status") !== "active" ||
        !hasPermission(reviewerMember.data()!, "tasks.review")
      ) {
        throw new AppError("PERMISSION_DENIED");
      }
      const submissionData = submission.data()!;
      const taskData = task.data()!;
      const taskStatus = normalizeTaskStatus(taskData.status);
      if (
        submissionData.project_id !== projectId ||
        submissionData.task_id !== taskId ||
        (submissionData.team_id ?? null) !== teamId ||
        taskData.project_id !== projectId ||
        (typeof taskData.team_id === "string" ? taskData.team_id : null) !== teamId ||
        taskData.latest_submission_id !== submissionRef.id ||
        !["submitted", "under_review"].includes(String(submissionData.status)) ||
        !taskStatus ||
        !["submitted", "under_review"].includes(taskStatus)
      ) {
        throw new AppError("TASK_STATUS_FORBIDDEN");
      }
      if (
        teamId &&
        !can(access, "project.edit") &&
        (!reviewerTeamMember?.exists ||
          reviewerTeamMember.get("status") !== "active" ||
          reviewerTeamMember.get("projectId") !== projectId)
      ) {
        throw new AppError("PERMISSION_DENIED");
      }
      const review = {
        id: reviewRef.id,
        project_id: projectId,
        team_id: submissionData.team_id ?? null,
        task_id: taskId,
        submission_id: submissionRef.id,
        submission_version: Number(submissionData.version_number),
        reviewer_id: user.id,
        reviewer_name: reviewerName,
        decision: values.decision,
        feedback: values.feedback,
        requested_changes: values.decision === "revision_required" ? values.feedback : "",
        created_at: reviewedAt,
      };
      transaction.create(reviewRef, review);
      transaction.update(submissionRef, { status: values.decision, reviewed_at: reviewedAt });
      transaction.update(taskRef, {
        status: taskStatusForReview(values.decision),
        completed_at: values.decision === "approved" ? reviewedAt : null,
        updated_at: reviewedAt,
      });
      for (const deliverable of deliverables) {
        if (!deliverable.exists || deliverable.get("submission_id") !== submissionRef.id) continue;
        transaction.update(deliverable.ref, {
          status: values.decision === "approved" ? "approved" : "revision_required",
          approved_at: values.decision === "approved" ? reviewedAt : null,
          updated_at: reviewedAt,
        });
      }
      transaction.create(activityRef, {
        id: activityRef.id,
        project_id: projectId,
        actor_id: user.id,
        actor_email: user.email,
        actor_name: reviewerName,
        action:
          values.decision === "approved"
            ? "submission.approved"
            : values.decision === "revision_required"
              ? "submission.revision_requested"
              : "submission.rejected",
        entity_type: "task",
        entity_id: taskId,
        entity_label: String(taskData.title ?? ""),
        old_values: null,
        new_values: {
          submission_id: submissionRef.id,
          version_number: Number(submissionData.version_number),
          decision: values.decision,
          feedback: values.feedback,
        },
        metadata: { task_title: String(taskData.title ?? "") },
        ip_address: null,
        user_agent: null,
        created_at: reviewedAt,
      });
      const notificationRef = db.collection("notifications").doc(crypto.randomUUID());
      transaction.create(notificationRef, {
        id: notificationRef.id,
        user_id: String(submissionData.researcher_id),
        project_id: projectId,
        task_id: taskId,
        task_title: String(taskData.title ?? ""),
        type: values.decision === "approved" ? "submission_approved" : "revision_requested",
        href: `/projects/${projectId}/tasks/${taskId}/submissions`,
        created_at: reviewedAt,
        read_at: null,
      });
    });

    revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
    revalidatePath(`/projects/${projectId}/tasks/${taskId}/submissions`);
    revalidatePath("/dashboard");
    return { reviewId: reviewRef.id };
  });
}
