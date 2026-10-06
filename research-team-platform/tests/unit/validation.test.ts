import { describe, expect, it } from "vitest";

import {
  changePasswordSchema,
  loginSchema,
  newPasswordSchema,
  safeRedirectPath,
  signupSchema,
} from "@/lib/validation/auth";
import { permissionsSchema } from "@/lib/validation/member";
import { projectFormSchema } from "@/lib/validation/project";
import {
  milestoneFormSchema,
  researcherProfileSchema,
  taskReviewSchema,
  taskSubmissionSchema,
  teamFormSchema,
} from "@/lib/validation/research";
import { taskFormSchema, taskPatchSchema } from "@/lib/validation/task";

describe("auth validation", () => {
  it("only accepts same-origin relative redirects (no open redirect)", () => {
    expect(safeRedirectPath("/projects/abc")).toBe("/projects/abc");
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "/login",
      null,
    ]) {
      expect(safeRedirectPath(value)).toBe("/dashboard");
    }
  });

  it("enforces password strength and confirmation", () => {
    expect(newPasswordSchema.safeParse({ password: "short1", confirmPassword: "short1" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "onlyletters", confirmPassword: "onlyletters" }).success).toBe(
      false,
    );
    expect(newPasswordSchema.safeParse({ password: "Research2026", confirmPassword: "Research2027" }).success).toBe(
      false,
    );
    expect(newPasswordSchema.safeParse({ password: "Research2026", confirmPassword: "Research2026" }).success).toBe(
      true,
    );
  });

  it("requires current-password reauthentication before a password change", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "",
        password: "Research2026",
        confirmPassword: "Research2026",
      }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "Current2025",
        password: "Research2026",
        confirmPassword: "Different2026",
      }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "Current2025",
        password: "Research2026",
        confirmPassword: "Research2026",
      }).success,
    ).toBe(true);
  });

  it("normalises e-mails and reports dictionary keys", () => {
    const result = loginSchema.safeParse({ email: "  nope ", password: "" });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((issue) => issue.message);
    expect(messages).toContain("validation.invalidEmail");
    expect(messages).toContain("validation.required");
    expect(
      signupSchema.safeParse({
        fullName: "غسان",
        email: "g@example.com",
        password: "Research2026",
        confirmPassword: "Research2026",
      }).success,
    ).toBe(true);
  });
});

describe("domain validation", () => {
  it("rejects a deadline before the start date", () => {
    const result = projectFormSchema.safeParse({
      name: "Study",
      description: "",
      researchGoal: "",
      status: "active",
      startDate: "2026-10-10",
      deadline: "2026-10-01",
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]?.message).toBe("validation.deadlineBeforeStart");
  });

  it("turns empty optional form values into null", () => {
    const parsed = taskFormSchema.parse({
      title: "Literature review",
      description: "",
      expectedOutput: "",
      requiredDeliverables: "",
      status: "todo",
      priority: "medium",
      assignedTo: "",
      dueDate: "",
    });
    expect(parsed.assignedTo).toBeNull();
    expect(parsed.dueDate).toBeNull();
  });

  it("rejects unknown statuses, identifiers and permission keys", () => {
    expect(taskPatchSchema.safeParse({ status: "done" }).success).toBe(false);
    expect(taskPatchSchema.safeParse({ assignedTo: "not-a-uuid" }).success).toBe(false);
    expect(taskPatchSchema.safeParse({}).success).toBe(false);
    expect(permissionsSchema.safeParse({ permissions: ["tasks.edit", "root.everything"] }).success).toBe(false);
  });

  it("validates team and milestone ownership without permitting ambiguous assignments", () => {
    expect(teamFormSchema.safeParse({ name: "Analysis team", description: "" }).success).toBe(true);
    expect(teamFormSchema.safeParse({ name: "x", description: "" }).success).toBe(false);
    const teamId = "123e4567-e89b-42d3-a456-426614174000";
    expect(
      milestoneFormSchema.safeParse({
        name: "Pilot study",
        description: "",
        deadline: "2026-11-01",
        responsibleTeamId: teamId,
        responsibleResearcherId: teamId,
        status: "pending",
      }).success,
    ).toBe(false);
  });

  it("requires attached submission IDs to be valid UUIDs and review feedback for non-approval decisions", () => {
    const taskId = "123e4567-e89b-42d3-a456-426614174000";
    expect(taskSubmissionSchema.safeParse({ taskId, notes: "Version 1", documentIds: [taskId] }).success).toBe(true);
    expect(taskSubmissionSchema.safeParse({ taskId, notes: "Version 1", documentIds: ["bad"] }).success).toBe(false);
    expect(
      taskReviewSchema.safeParse({ taskId, submissionId: taskId, decision: "revision_required", feedback: "" }).success,
    ).toBe(false);
    expect(
      taskReviewSchema.safeParse({ taskId, submissionId: taskId, decision: "approved", feedback: "" }).success,
    ).toBe(true);
  });

  it("validates Director-managed researcher profile status and fields", () => {
    expect(
      researcherProfileSchema.safeParse({ fullName: "Researcher One", status: "active", skills: ["Genomics"] }).success,
    ).toBe(true);
    expect(researcherProfileSchema.safeParse({ fullName: "R", status: "root" }).success).toBe(false);
  });
});
