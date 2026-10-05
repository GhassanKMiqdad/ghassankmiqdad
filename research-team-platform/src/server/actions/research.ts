"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { firebaseAdminFirestore, FieldValue } from "@/lib/firebase/admin";
import { isValidTeamLead, validateMilestoneAssociations } from "@/lib/domain/research-associations";
import {
  milestoneFormSchema,
  milestonePatchSchema,
  resourceIdSchema,
  teamCreateSchema,
  teamLeadSchema,
  teamMemberSchema,
  teamPatchSchema,
} from "@/lib/validation/research";
import { uuidField } from "@/lib/validation/common";
import { assertProjectPermission } from "@/server/access";
import { parseInput, runAction } from "@/server/action";

function revalidateResearchPaths(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
  revalidatePath(`/projects/${projectId}/teams`);
  revalidatePath(`/projects/${projectId}/milestones`);
}

function requireExists(snapshot: FirebaseFirestore.DocumentSnapshot) {
  if (!snapshot.exists) throw new AppError("NOT_FOUND");
  return snapshot.data()!;
}

export async function createTeamAction(projectId: string, input: unknown): Promise<ActionResult<{ teamId: string }>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, projectId);
    const values = parseInput(teamCreateSchema, input);
    await assertProjectPermission(id, "members.manage");
    const db = firebaseAdminFirestore();
    const teamId = randomUUID();
    const now = FieldValue.serverTimestamp();
    await db.collection("teams").doc(teamId).create({
      projectId: id,
      name: values.name,
      description: values.description,
      status: "active",
      memberIds: [],
      leadId: null,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    });
    revalidateResearchPaths(id);
    return { teamId };
  });
}

export async function updateTeamAction(projectId: string, teamId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const resourceId = parseInput(resourceIdSchema, teamId);
    const values = parseInput(teamPatchSchema, input);
    await assertProjectPermission(id, "members.manage");
    const ref = firebaseAdminFirestore().collection("teams").doc(resourceId);
    await firebaseAdminFirestore().runTransaction(async (transaction) => {
      const row = requireExists(await transaction.get(ref));
      if (row.projectId !== id) throw new AppError("NOT_FOUND");
      if (row.status !== "active") throw new AppError("PERMISSION_DENIED");
      transaction.update(ref, { ...values, updatedAt: FieldValue.serverTimestamp() });
    });
    revalidateResearchPaths(id);
    return null;
  });
}

export async function archiveTeamAction(projectId: string, teamId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const resourceId = parseInput(resourceIdSchema, teamId);
    await assertProjectPermission(id, "members.manage");
    const ref = firebaseAdminFirestore().collection("teams").doc(resourceId);
    await firebaseAdminFirestore().runTransaction(async (transaction) => {
      const row = requireExists(await transaction.get(ref));
      if (row.projectId !== id) throw new AppError("NOT_FOUND");
      if (row.status === "archived") return;
      transaction.update(ref, { status: "archived", updatedAt: FieldValue.serverTimestamp() });
    });
    revalidateResearchPaths(id);
    return null;
  });
}

export async function addTeamMemberAction(
  projectId: string,
  teamId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, projectId);
    const resourceId = parseInput(resourceIdSchema, teamId);
    const { userId } = parseInput(teamMemberSchema, input);
    await assertProjectPermission(id, "members.add");
    const db = firebaseAdminFirestore();
    const teamRef = db.collection("teams").doc(resourceId);
    const memberRef = db.collection("project_members").doc(`${id}_${userId}`);
    const teamMemberRef = db.collection("team_members").doc(`${resourceId}_${userId}`);
    await db.runTransaction(async (transaction) => {
      const [teamSnapshot, memberSnapshot, teamMemberSnapshot] = await Promise.all([
        transaction.get(teamRef),
        transaction.get(memberRef),
        transaction.get(teamMemberRef),
      ]);
      const row = requireExists(teamSnapshot);
      if (row.projectId !== id) throw new AppError("NOT_FOUND");
      if (row.status !== "active") throw new AppError("PERMISSION_DENIED");
      if (
        !memberSnapshot.exists ||
        memberSnapshot.get("status") !== "active" ||
        memberSnapshot.get("project_id") !== id ||
        memberSnapshot.get("user_id") !== userId
      ) {
        throw new AppError("MEMBER_NOT_FOUND");
      }
      const members = Array.isArray(row.memberIds)
        ? row.memberIds.filter((value: unknown): value is string => typeof value === "string")
        : [];
      if (members.includes(userId) || teamMemberSnapshot.exists) throw new AppError("ALREADY_MEMBER");
      transaction.update(teamRef, { memberIds: [...members, userId], updatedAt: FieldValue.serverTimestamp() });
      transaction.create(teamMemberRef, {
        id: teamMemberRef.id,
        projectId: id,
        teamId: resourceId,
        userId,
        status: "active",
        createdBy: user.id,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    revalidateResearchPaths(id);
    return null;
  });
}

export async function removeTeamMemberAction(
  projectId: string,
  teamId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const resourceId = parseInput(resourceIdSchema, teamId);
    const { userId } = parseInput(teamMemberSchema, input);
    await assertProjectPermission(id, "members.remove");
    const db = firebaseAdminFirestore();
    const teamRef = db.collection("teams").doc(resourceId);
    const teamMemberRef = db.collection("team_members").doc(`${resourceId}_${userId}`);
    await db.runTransaction(async (transaction) => {
      const [teamSnapshot, teamMemberSnapshot] = await Promise.all([
        transaction.get(teamRef),
        transaction.get(teamMemberRef),
      ]);
      const row = requireExists(teamSnapshot);
      if (row.projectId !== id) throw new AppError("NOT_FOUND");
      if (row.status !== "active") throw new AppError("PERMISSION_DENIED");
      const members = Array.isArray(row.memberIds)
        ? row.memberIds.filter((value: unknown): value is string => typeof value === "string")
        : [];
      if (!members.includes(userId)) throw new AppError("MEMBER_NOT_FOUND");
      transaction.update(teamRef, {
        memberIds: members.filter((memberId) => memberId !== userId),
        ...(row.leadId === userId ? { leadId: null } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (teamMemberSnapshot.exists) transaction.delete(teamMemberRef);
    });
    revalidateResearchPaths(id);
    return null;
  });
}

export async function setTeamLeadAction(
  projectId: string,
  teamId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const resourceId = parseInput(resourceIdSchema, teamId);
    const { userId: leadId } = parseInput(teamLeadSchema, input);
    await assertProjectPermission(id, "members.manage");
    const db = firebaseAdminFirestore();
    const teamRef = db.collection("teams").doc(resourceId);
    await db.runTransaction(async (transaction) => {
      const row = requireExists(await transaction.get(teamRef));
      if (row.projectId !== id) throw new AppError("NOT_FOUND");
      if (row.status !== "active") throw new AppError("PERMISSION_DENIED");
      const memberIds = Array.isArray(row.memberIds)
        ? row.memberIds.filter((value: unknown): value is string => typeof value === "string")
        : [];
      const activeIds = new Set<string>();
      if (leadId) {
        const [memberSnapshot, teamMemberSnapshot] = await Promise.all([
          transaction.get(db.collection("project_members").doc(`${id}_${leadId}`)),
          transaction.get(db.collection("team_members").doc(`${resourceId}_${leadId}`)),
        ]);
        if (
          memberSnapshot.exists &&
          memberSnapshot.get("status") === "active" &&
          memberSnapshot.get("project_id") === id &&
          memberSnapshot.get("user_id") === leadId &&
          teamMemberSnapshot.exists &&
          teamMemberSnapshot.get("status") === "active" &&
          teamMemberSnapshot.get("projectId") === id &&
          teamMemberSnapshot.get("teamId") === resourceId &&
          teamMemberSnapshot.get("userId") === leadId
        )
          activeIds.add(leadId);
      }
      if (!isValidTeamLead(leadId, memberIds, activeIds)) throw new AppError("INVALID_INPUT");
      transaction.update(teamRef, { leadId, updatedAt: FieldValue.serverTimestamp() });
    });
    revalidateResearchPaths(id);
    return null;
  });
}

async function validateMilestoneLinks(
  projectId: string,
  teamId: string | null,
  researcherIds: string[],
  transaction: FirebaseFirestore.Transaction,
) {
  const db = firebaseAdminFirestore();
  const membershipsQuery = db.collection("project_members").where("project_id", "==", projectId);
  const [membershipSnapshot, teamSnapshot] = await Promise.all([
    transaction.get(membershipsQuery),
    teamId ? transaction.get(db.collection("teams").doc(teamId)) : Promise.resolve(null),
  ]);
  const activeIds = new Set(
    membershipSnapshot.docs
      .filter((doc) => doc.get("status") === "active")
      .map((doc) => doc.get("user_id"))
      .filter((value): value is string => typeof value === "string"),
  );
  const teamExists = Boolean(teamSnapshot?.exists);
  const team = teamSnapshot?.data();
  const teamMemberIds = Array.isArray(team?.memberIds)
    ? team.memberIds.filter((value: unknown): value is string => typeof value === "string")
    : [];
  const reason = validateMilestoneAssociations({
    hasTeam: Boolean(teamId),
    teamProjectMatches: !teamId || (teamExists && team?.projectId === projectId && team?.status === "active"),
    teamMemberIds,
    researcherIds,
    activeProjectMemberIds: activeIds,
  });
  if (reason) throw new AppError("INVALID_INPUT");
}

export async function createMilestoneAction(
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ milestoneId: string }>> {
  return runAction(async (user) => {
    const id = parseInput(uuidField, projectId);
    const values = parseInput(milestoneFormSchema, input);
    await assertProjectPermission(id, "project.edit");
    const db = firebaseAdminFirestore();
    const milestoneId = randomUUID();
    const ref = db.collection("milestones").doc(milestoneId);
    await db.runTransaction(async (transaction) => {
      await validateMilestoneLinks(id, values.teamId, values.researcherIds, transaction);
      transaction.create(ref, {
        projectId: id,
        title: values.title,
        description: values.description,
        dueDate: values.dueDate,
        status: "open",
        teamId: values.teamId,
        researcherIds: values.researcherIds,
        createdBy: user.id,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    revalidateResearchPaths(id);
    return { milestoneId };
  });
}

export async function updateMilestoneAction(milestoneId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const resourceId = parseInput(resourceIdSchema, milestoneId);
    const values = parseInput(milestonePatchSchema, input);
    const db = firebaseAdminFirestore();
    const ref = db.collection("milestones").doc(resourceId);
    const existing = await ref.get();
    const current = requireExists(existing);
    const projectId = parseInput(uuidField, current.projectId);
    await assertProjectPermission(projectId, "project.edit");
    await db.runTransaction(async (transaction) => {
      const row = requireExists(await transaction.get(ref));
      if (row.projectId !== projectId) throw new AppError("NOT_FOUND");
      if (row.status === "archived") throw new AppError("PERMISSION_DENIED");
      await validateMilestoneLinks(projectId, values.teamId, values.researcherIds, transaction);
      transaction.update(ref, {
        title: values.title,
        description: values.description,
        dueDate: values.dueDate,
        teamId: values.teamId,
        researcherIds: values.researcherIds,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    revalidateResearchPaths(projectId);
    return null;
  });
}

export async function setMilestoneStatusAction(
  milestoneId: string,
  status: "completed" | "open",
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const resourceId = parseInput(resourceIdSchema, milestoneId);
    const db = firebaseAdminFirestore();
    const ref = db.collection("milestones").doc(resourceId);
    const current = requireExists(await ref.get());
    const projectId = parseInput(uuidField, current.projectId);
    await assertProjectPermission(projectId, "project.edit");
    await db.runTransaction(async (transaction) => {
      const row = requireExists(await transaction.get(ref));
      if (row.projectId !== projectId) throw new AppError("NOT_FOUND");
      if (
        row.status === "archived" ||
        (status === "completed" && row.status !== "open") ||
        (status === "open" && row.status !== "completed")
      ) {
        throw new AppError("PERMISSION_DENIED");
      }
      transaction.update(ref, { status, updatedAt: FieldValue.serverTimestamp() });
    });
    revalidateResearchPaths(projectId);
    return null;
  });
}

export async function archiveMilestoneAction(milestoneId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const resourceId = parseInput(resourceIdSchema, milestoneId);
    const db = firebaseAdminFirestore();
    const ref = db.collection("milestones").doc(resourceId);
    const current = requireExists(await ref.get());
    const projectId = parseInput(uuidField, current.projectId);
    await assertProjectPermission(projectId, "project.edit");
    await db.runTransaction(async (transaction) => {
      const row = requireExists(await transaction.get(ref));
      if (row.projectId !== projectId) throw new AppError("NOT_FOUND");
      if (row.status !== "archived")
        transaction.update(ref, { status: "archived", updatedAt: FieldValue.serverTimestamp() });
    });
    revalidateResearchPaths(projectId);
    return null;
  });
}
