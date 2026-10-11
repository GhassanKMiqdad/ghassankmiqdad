import { describe, expect, it } from "vitest";

import { loginSchema, newPasswordSchema, safeRedirectPath, signupSchema } from "@/lib/validation/auth";
import { permissionsSchema } from "@/lib/validation/member";
import { projectFormSchema } from "@/lib/validation/project";
import { reviewTaskSchema, submitTaskSchema, taskFormSchema, taskStatusSchema } from "@/lib/validation/task";

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
      expect(safeRedirectPath(value)).toBe("/workspace");
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

  const baseTask = {
    taskCode: "",
    title: "Literature review",
    description: "",
    originalInstructions: "",
    expectedOutput: "",
    completionCriteria: "",
    priority: "p2",
    assignedTo: "",
    planningMonth: "1",
    planningWeek: "",
    plannedStart: "",
    plannedDuration: "",
    durationUnit: "days",
    dueOverride: false,
    dueAt: "",
  };

  it("turns empty optional form values into null (no invented dates)", () => {
    const parsed = taskFormSchema.parse(baseTask);
    expect(parsed.assignedTo).toBeNull();
    expect(parsed.taskCode).toBeNull();
    expect(parsed.plannedStart).toBeNull();
    expect(parsed.plannedDuration).toBeNull();
    expect(parsed.planningWeek).toBeNull();
    expect(parsed.dueAt).toBeNull();
    expect(parsed.planningMonth).toBe(1);
  });

  it("normalizes and validates task IDs", () => {
    expect(taskFormSchema.parse({ ...baseTask, taskCode: " m01-gh-01-01 " }).taskCode).toBe("M01-GH-01-01");
    expect(taskFormSchema.safeParse({ ...baseTask, taskCode: "M01 GH" }).success).toBe(false);
    expect(taskFormSchema.safeParse({ ...baseTask, taskCode: "M01--GH" }).success).toBe(false);
  });

  it("requires a deadline when it is overridden, after the start", () => {
    expect(taskFormSchema.safeParse({ ...baseTask, dueOverride: true }).success).toBe(false);
    const early = taskFormSchema.safeParse({
      ...baseTask,
      plannedStart: "2026-11-02T09:00",
      dueOverride: true,
      dueAt: "2026-11-01T09:00",
    });
    expect(early.success).toBe(false);
    expect(early.error!.issues[0]?.message).toBe("validation.deadlineBeforeStart");
  });

  it("rejects unknown priorities, statuses, identifiers and permission keys", () => {
    expect(taskFormSchema.safeParse({ ...baseTask, priority: "high" }).success).toBe(false);
    expect(taskStatusSchema.safeParse({ status: "done" }).success).toBe(false);
    expect(taskFormSchema.safeParse({ ...baseTask, assignedTo: "not-a-uuid" }).success).toBe(false);
    expect(permissionsSchema.safeParse({ permissions: ["tasks.edit", "root.everything"] }).success).toBe(false);
  });

  it("parses external links one per line: https only, no credentials, no Storage URLs", () => {
    const parsed = submitTaskSchema.parse({
      summary: "Done",
      links: "https://a.example\n\n https://b.example/pr/1 ",
      notes: "",
    });
    expect(parsed.links).toEqual(["https://a.example", "https://b.example/pr/1"]);
    for (const link of [
      "http://b.example",
      "https://user:secret@b.example/x",
      "https://example.com:bad/x",
      "https://example.com:99999/x",
      "https://example..com/x",
      "https://abc.supabase.co/storage/v1/object/sign/project-documents/a?token=1",
    ]) {
      expect(submitTaskSchema.safeParse({ summary: "Done", links: link, notes: "" }).success).toBe(false);
    }
    expect(submitTaskSchema.safeParse({ summary: "Done", links: "javascript:alert(1)", notes: "" }).success).toBe(
      false,
    );
    expect(submitTaskSchema.safeParse({ summary: " ", links: "", notes: "" }).success).toBe(false);
  });

  it("a revision request must say what to change", () => {
    expect(
      reviewTaskSchema.safeParse({
        decision: "revision_required",
        comment: "",
        requiredChanges: "",
        additionalInstructions: "",
      }).success,
    ).toBe(false);
    expect(
      reviewTaskSchema.safeParse({ decision: "approved", comment: "", requiredChanges: "", additionalInstructions: "" })
        .success,
    ).toBe(true);
  });
});
