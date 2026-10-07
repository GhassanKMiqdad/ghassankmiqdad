import { describe, expect, it } from "vitest";

import { PERMISSION_KEYS, type TaskStatus } from "@/lib/permissions/catalog";
import {
  assignableRoles,
  can,
  canChangeTaskStatus,
  canDeleteComment,
  canDeleteTasks,
  canEditComment,
  canEditTaskContent,
  canEditTaskSchedule,
  canExecuteTask,
  canReviewTask,
  canSubmitTask,
  canUpdateTask,
  canUpdateTaskProgress,
  editablePermissionKeys,
  evaluateMemberAdd,
  evaluateMemberRemove,
  evaluatePermissionChange,
  evaluateRoleChange,
  evaluateTaskCreate,
  evaluateTaskUpdate,
  isActive,
  isDirectTransitionAllowed,
} from "@/lib/permissions/policy";

import { accessFor, MANAGER, MEMBER, OTHER, OWNER, REVIEWER } from "./helpers";

function task(createdBy: string | null, assignedTo: string | null, status: TaskStatus = "in_progress") {
  return { createdBy, assignedTo, status };
}

describe("project access", () => {
  it("user cannot access another project (no membership)", () => {
    expect(can(null, "project.view")).toBe(false);
    expect(isActive(undefined)).toBe(false);
  });

  it("a suspended member has no effective permission", () => {
    const suspended = accessFor("manager", { status: "suspended" });
    expect(can(suspended, "project.view")).toBe(false);
    expect(can(suspended, "tasks.edit")).toBe(false);
  });

  it("without project.view nothing else applies", () => {
    const gated = accessFor("member", { permissions: ["tasks.view", "tasks.edit"] });
    expect(isActive(gated)).toBe(false);
    expect(can(gated, "tasks.edit")).toBe(false);
  });
});

describe("tasks: supervisor (owner / Director / Team Lead)", () => {
  const owner = accessFor("owner");

  it("plans, schedules, assigns, cancels and deletes", () => {
    const foreign = task(OTHER, OTHER, "scheduled");
    expect(canEditTaskContent(owner, foreign)).toBe(true);
    expect(canEditTaskSchedule(owner, foreign)).toBe(true);
    expect(canDeleteTasks(owner)).toBe(true);
    expect(
      evaluateTaskUpdate(owner, foreign, { content: true, schedule: true, assignedTo: MEMBER, status: "cancelled" }),
    ).toEqual({
      ok: true,
    });
  });

  it("cannot set workflow states directly (submission, approval and completion go through the workflow)", () => {
    for (const status of ["submitted", "under_review", "revision_required", "approved", "completed"] as const) {
      expect(canChangeTaskStatus(owner, task(OTHER, OTHER, "in_progress"), status)).toBe(false);
    }
  });

  it("a completed task is a closed record", () => {
    const closed = task(OTHER, OTHER, "completed");
    expect(canEditTaskContent(owner, closed)).toBe(false);
    expect(canEditTaskSchedule(owner, closed)).toBe(false);
    expect(canUpdateTask(owner, closed)).toBe(false);
  });

  it("reviews others' work; only a Director may review their own", () => {
    const own = task(OWNER, OWNER, "submitted");
    expect(canReviewTask(owner, task(OWNER, MEMBER, "submitted"))).toBe(true);
    expect(canReviewTask(owner, own)).toBe(false);
    expect(canReviewTask({ ...owner, isDirector: true }, own)).toBe(true);
  });
});

describe("tasks: team member", () => {
  const member = accessFor("member");

  it("member cannot delete, create or assign tasks", () => {
    expect(canDeleteTasks(member)).toBe(false);
    expect(evaluateTaskCreate(member, { assignedTo: MEMBER, planned: false })).toEqual({
      ok: false,
      code: "PERMISSION_DENIED",
    });
    expect(evaluateTaskUpdate(member, task(OWNER, MEMBER), { assignedTo: OTHER })).toEqual({
      ok: false,
      code: "TASK_ASSIGN_FORBIDDEN",
    });
  });

  it("executes an assigned task: start, progress, submit", () => {
    const assigned = task(OWNER, MEMBER, "scheduled");
    expect(canExecuteTask(member, assigned)).toBe(true);
    expect(canChangeTaskStatus(member, assigned, "in_progress")).toBe(true);
    expect(canUpdateTaskProgress(member, assigned)).toBe(true);
    expect(canSubmitTask(member, task(OWNER, MEMBER, "in_progress"))).toBe(true);
    expect(canSubmitTask(member, task(OWNER, MEMBER, "revision_required"))).toBe(true);
    expect(canSubmitTask(member, assigned)).toBe(false);
  });

  it("cannot change the definition, the plan or the schedule of an assigned task", () => {
    const assigned = task(OWNER, MEMBER);
    expect(canEditTaskContent(member, assigned)).toBe(false);
    expect(canEditTaskSchedule(member, assigned)).toBe(false);
    expect(evaluateTaskUpdate(member, assigned, { schedule: true })).toEqual({
      ok: false,
      code: "TASK_EDIT_FORBIDDEN",
    });
    expect(evaluateTaskUpdate(member, assigned, { content: true })).toEqual({ ok: false, code: "TASK_EDIT_FORBIDDEN" });
  });

  it("cannot approve, complete or cancel their own work", () => {
    const assigned = task(OWNER, MEMBER, "submitted");
    expect(canReviewTask(member, assigned)).toBe(false);
    expect(evaluateTaskUpdate(member, assigned, { status: "completed" })).toEqual({
      ok: false,
      code: "TASK_STATUS_FORBIDDEN",
    });
    expect(canChangeTaskStatus(member, task(OWNER, MEMBER, "in_progress"), "cancelled")).toBe(false);
  });

  it("cannot touch another member's task", () => {
    const foreign = task(OTHER, OTHER);
    expect(canExecuteTask(member, foreign)).toBe(false);
    expect(canUpdateTask(member, foreign)).toBe(false);
    expect(canUpdateTaskProgress(member, foreign)).toBe(false);
  });

  it("tasks.edit_own lets a creator edit the definition but never the schedule", () => {
    const creator = accessFor("member", { permissions: ["project.view", "tasks.create", "tasks.edit_own"] });
    expect(canEditTaskContent(creator, task(MEMBER, null))).toBe(true);
    expect(canEditTaskSchedule(creator, task(MEMBER, null))).toBe(false);
    expect(evaluateTaskCreate(creator, { assignedTo: MEMBER, planned: true })).toEqual({
      ok: false,
      code: "TASK_EDIT_FORBIDDEN",
    });
    expect(evaluateTaskCreate(creator, { assignedTo: MEMBER, planned: false })).toEqual({ ok: true });
  });
});

describe("tasks: reviewer", () => {
  const reviewer = accessFor("reviewer");

  it("reviews submitted work but cannot edit or schedule it", () => {
    const inReview = task(OWNER, MEMBER, "submitted");
    expect(canReviewTask(reviewer, inReview)).toBe(true);
    expect(evaluateTaskUpdate(reviewer, inReview, { content: true })).toEqual({
      ok: false,
      code: "TASK_EDIT_FORBIDDEN",
    });
    expect(canChangeTaskStatus(reviewer, task(OWNER, MEMBER, "scheduled"), "in_progress")).toBe(false);
  });
});

describe("direct status transitions (mirror of private.task_transition_allowed)", () => {
  it("matches the database rules", () => {
    expect(isDirectTransitionAllowed("scheduled", "in_progress", false, true)).toBe(true);
    expect(isDirectTransitionAllowed("blocked", "in_progress", false, true)).toBe(false);
    expect(isDirectTransitionAllowed("blocked", "in_progress", true, false)).toBe(true);
    expect(isDirectTransitionAllowed("revision_required", "in_progress", false, true)).toBe(true);
    expect(isDirectTransitionAllowed("in_progress", "submitted", true, true)).toBe(false);
    expect(isDirectTransitionAllowed("approved", "completed", true, false)).toBe(false);
    expect(isDirectTransitionAllowed("completed", "cancelled", true, false)).toBe(false);
    expect(isDirectTransitionAllowed("cancelled", "not_started", true, false)).toBe(true);
    expect(isDirectTransitionAllowed("cancelled", "not_started", false, true)).toBe(false);
  });
});

describe("members and permissions", () => {
  const owner = accessFor("owner");
  const manager = accessFor("manager", {
    permissions: [
      "project.view",
      "team.view",
      "tasks.view",
      "tasks.edit",
      "permissions.manage",
      "members.manage",
      "members.add",
      "members.remove",
    ],
  });
  const member = accessFor("member");
  const memberTarget = { userId: MEMBER, role: "member" as const };

  it("user cannot modify permissions without permissions.manage", () => {
    expect(
      evaluatePermissionChange(member, { userId: OTHER, role: "member" }, new Set(), new Set(["tasks.edit"])),
    ).toEqual({
      ok: false,
      code: "PERMISSION_DENIED",
    });
  });

  it("nobody can change their own permissions", () => {
    expect(evaluatePermissionChange(manager, { userId: MANAGER, role: "manager" }, new Set(), new Set())).toEqual({
      ok: false,
      code: "CANNOT_MODIFY_SELF",
    });
  });

  it("the owner's permissions are immutable", () => {
    expect(evaluatePermissionChange(owner, { userId: OTHER, role: "owner" }, new Set(), new Set())).toEqual({
      ok: false,
      code: "CANNOT_MODIFY_OWNER",
    });
  });

  it("a manager cannot grant permissions they do not hold (privilege escalation)", () => {
    expect(
      evaluatePermissionChange(
        manager,
        memberTarget,
        new Set(["project.view"]),
        new Set(["project.view", "project.delete"]),
      ),
    ).toEqual({ ok: false, code: "PERMISSION_ESCALATION" });
  });

  it("a manager can grant permissions they hold to a lower role", () => {
    expect(
      evaluatePermissionChange(
        manager,
        memberTarget,
        new Set(["project.view"]),
        new Set(["project.view", "tasks.edit"]),
      ),
    ).toEqual({ ok: true });
  });

  it("peers cannot manage each other", () => {
    expect(evaluatePermissionChange(manager, { userId: OTHER, role: "manager" }, new Set(), new Set())).toEqual({
      ok: false,
      code: "INSUFFICIENT_RANK",
    });
    expect(evaluateMemberRemove(manager, { userId: OTHER, role: "manager" })).toEqual({
      ok: false,
      code: "INSUFFICIENT_RANK",
    });
  });

  it("the owner can change any permission of any non-owner", () => {
    expect(
      evaluatePermissionChange(owner, { userId: OTHER, role: "manager" }, new Set(), new Set(PERMISSION_KEYS)),
    ).toEqual({ ok: true });
    expect(editablePermissionKeys(owner).size).toBe(PERMISSION_KEYS.length);
  });

  it("roles can only be handed out below the actor's own rank", () => {
    expect(assignableRoles(owner)).toEqual(["manager", "member", "reviewer"]);
    expect(assignableRoles(manager)).toEqual(["member", "reviewer"]);
    expect(assignableRoles(member)).toEqual([]);
    expect(evaluateMemberAdd(manager, "manager")).toEqual({ ok: false, code: "ROLE_NOT_ALLOWED" });
    expect(evaluateRoleChange(manager, memberTarget, "manager")).toEqual({ ok: false, code: "ROLE_NOT_ALLOWED" });
    expect(evaluateRoleChange(manager, memberTarget, "reviewer")).toEqual({ ok: true });
  });

  it("members cannot add or remove members", () => {
    expect(evaluateMemberAdd(member, "member")).toEqual({ ok: false, code: "PERMISSION_DENIED" });
    expect(evaluateMemberRemove(member, { userId: OTHER, role: "member" })).toEqual({
      ok: false,
      code: "PERMISSION_DENIED",
    });
  });

  it("nobody can remove the owner", () => {
    expect(evaluateMemberRemove(owner, { userId: OWNER, role: "owner" })).toEqual({
      ok: false,
      code: "CANNOT_MODIFY_OWNER",
    });
  });
});

describe("comments", () => {
  const member = accessFor("member");
  const manager = accessFor("manager");

  it("authors edit and delete their own comments", () => {
    expect(canEditComment(member, MEMBER)).toBe(true);
    expect(canDeleteComment(member, MEMBER)).toBe(true);
  });

  it("other members cannot edit or delete someone else's comment", () => {
    expect(canEditComment(member, OTHER)).toBe(false);
    expect(canDeleteComment(member, OTHER)).toBe(false);
  });

  it("comments.delete allows moderation but not editing", () => {
    expect(canDeleteComment(manager, OTHER)).toBe(true);
    expect(canEditComment(manager, OTHER)).toBe(false);
  });

  it("reviewers without comments.delete cannot moderate", () => {
    expect(canDeleteComment(accessFor("reviewer"), OTHER)).toBe(false);
    expect(canEditComment(accessFor("reviewer"), REVIEWER)).toBe(true);
  });
});
