import { describe, expect, it } from "vitest";

import { PERMISSION_KEYS, isPermissionKey, type TaskStatus } from "@/lib/permissions/catalog";
import {
  allowedTaskStatuses,
  assignableRoles,
  can,
  canDeleteComment,
  canDeleteTasks,
  canEditComment,
  canEditTaskContent,
  canUpdateTask,
  editablePermissionKeys,
  evaluateMemberAdd,
  evaluateMemberRemove,
  evaluatePermissionChange,
  evaluateRoleChange,
  evaluateTaskCreate,
  evaluateTaskUpdate,
  isActive,
} from "@/lib/permissions/policy";

import { accessFor, MANAGER, MEMBER, OTHER, OWNER, REVIEWER } from "./helpers";

const current = { title: "Literature Review", description: "", priority: "high", dueDate: null };

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

describe("tasks: admin / owner", () => {
  const owner = accessFor("owner");

  it("director can edit definitions but cannot reopen terminal tasks", () => {
    const foreign = task(OTHER, OTHER, "completed");
    expect(canEditTaskContent(owner, foreign)).toBe(true);
    expect(allowedTaskStatuses(owner, foreign)).toEqual(["completed"]);
    expect(canDeleteTasks(owner)).toBe(true);
    expect(evaluateTaskUpdate(owner, foreign, { title: "New", assignedTo: MEMBER, priority: "low" }, current)).toEqual({
      ok: true,
    });
  });
});

describe("tasks: research member", () => {
  const member = accessFor("member");

  it("member cannot delete tasks without permission", () => {
    expect(canDeleteTasks(member)).toBe(false);
  });

  it("member can update progress and submit assigned work, but cannot edit task instructions", () => {
    const assigned = task(OWNER, MEMBER, "in_progress");
    expect(canEditTaskContent(member, assigned)).toBe(false);
    expect(canUpdateTask(member, assigned)).toBe(true);
    expect(evaluateTaskUpdate(member, assigned, { progress: 55, workNotes: "Screened abstracts" }, current)).toEqual({
      ok: true,
    });
    expect(evaluateTaskUpdate(member, assigned, { status: "under_review" }, current)).toEqual({
      ok: false,
      code: "TASK_STATUS_FORBIDDEN",
    });
    expect(evaluateTaskUpdate(member, assigned, { title: "Updated" }, current)).toEqual({
      ok: false,
      code: "TASK_EDIT_FORBIDDEN",
    });
  });

  it("assigned researcher must accept before starting work", () => {
    const assigned = task(OWNER, MEMBER, "assigned");
    expect(evaluateTaskUpdate(member, assigned, { status: "accepted" }, current)).toEqual({ ok: true });
    expect(evaluateTaskUpdate(member, assigned, { status: "in_progress" }, current)).toEqual({
      ok: false,
      code: "TASK_STATUS_FORBIDDEN",
    });
    expect(evaluateTaskUpdate(member, task(OWNER, MEMBER, "accepted"), { status: "in_progress" }, current)).toEqual({
      ok: true,
    });
  });

  it("member cannot edit another user's task", () => {
    const foreign = task(OTHER, OTHER);
    expect(canEditTaskContent(member, foreign)).toBe(false);
    expect(canUpdateTask(member, foreign)).toBe(false);
    expect(evaluateTaskUpdate(member, foreign, { title: "Hacked" }, current)).toEqual({
      ok: false,
      code: "TASK_EDIT_FORBIDDEN",
    });
  });

  it("member cannot approve (complete) their own work", () => {
    const assigned = task(OWNER, MEMBER, "under_review");
    expect(allowedTaskStatuses(member, assigned)).toEqual(["under_review"]);
    expect(evaluateTaskUpdate(member, assigned, { status: "completed" }, current)).toEqual({
      ok: false,
      code: "TASK_STATUS_FORBIDDEN",
    });
  });

  it("member cannot re-assign a task", () => {
    expect(evaluateTaskUpdate(member, task(OWNER, MEMBER), { assignedTo: OTHER }, current)).toEqual({
      ok: false,
      code: "TASK_ASSIGN_FORBIDDEN",
    });
  });

  it("rejects removed legacy task-definition edit grants", () => {
    expect(isPermissionKey("tasks.edit_own")).toBe(false);
    expect(isPermissionKey("tasks.edit_assigned")).toBe(false);
  });

  it("member cannot create tasks; task definition remains manager-owned", () => {
    expect(evaluateTaskCreate(member, { assignedTo: MEMBER, status: "assigned" })).toEqual({
      ok: false,
      code: "PERMISSION_DENIED",
    });
    expect(evaluateTaskCreate(member, { assignedTo: OTHER, status: "assigned" })).toEqual({
      ok: false,
      code: "PERMISSION_DENIED",
    });
    expect(evaluateTaskCreate(member, { assignedTo: null, status: "completed" })).toEqual({
      ok: false,
      code: "PERMISSION_DENIED",
    });
  });
});

describe("tasks: reviewer", () => {
  const reviewer = accessFor("reviewer");

  it("formal reviewer decisions do not mutate task state through the generic task update policy", () => {
    const inReview = task(OWNER, MEMBER, "under_review");
    expect(allowedTaskStatuses(reviewer, inReview)).toEqual(["under_review"]);
    expect(evaluateTaskUpdate(reviewer, inReview, { status: "completed" }, current)).toEqual({
      ok: false,
      code: "TASK_STATUS_FORBIDDEN",
    });
  });

  it("reviewer cannot edit content or move tasks that are not under review", () => {
    expect(evaluateTaskUpdate(reviewer, task(OWNER, MEMBER, "under_review"), { title: "Rewrite" }, current)).toEqual({
      ok: false,
      code: "TASK_EDIT_FORBIDDEN",
    });
    expect(allowedTaskStatuses(reviewer, task(OWNER, MEMBER, "assigned"))).toEqual(["assigned"]);
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
