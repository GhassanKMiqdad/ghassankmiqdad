import { describe, expect, it } from "vitest";

import { loginSchema, newPasswordSchema, safeRedirectPath, signupSchema } from "@/lib/validation/auth";
import { permissionsSchema } from "@/lib/validation/member";
import { projectFormSchema } from "@/lib/validation/project";
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
});
