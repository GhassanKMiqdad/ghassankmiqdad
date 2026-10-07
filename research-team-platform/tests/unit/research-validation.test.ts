import { describe, expect, it } from "vitest";

import {
  milestoneFormSchema,
  researcherProfileSchema,
  taskReviewSchema,
  taskSubmissionSchema,
  teamFormSchema,
} from "@/lib/validation/research";

const id = "123e4567-e89b-42d3-a456-426614174000";

describe("research-domain validation", () => {
  it("rejects weak team names and conflicting milestone owners", () => {
    expect(teamFormSchema.safeParse({ name: "x", description: "" }).success).toBe(false);
    expect(teamFormSchema.safeParse({ name: "Data analysis", description: "" }).success).toBe(true);
    expect(
      milestoneFormSchema.safeParse({
        name: "Pilot",
        description: "",
        deadline: "2026-11-02",
        responsibleTeamId: id,
        responsibleResearcherId: id,
        status: "pending",
      }).success,
    ).toBe(false);
  });

  it("validates profile lifecycle and immutable submission references", () => {
    expect(researcherProfileSchema.safeParse({ fullName: "Researcher One", status: "active" }).success).toBe(true);
    expect(researcherProfileSchema.safeParse({ fullName: "Researcher One", status: "root" }).success).toBe(false);
    expect(taskSubmissionSchema.safeParse({ taskId: id, notes: "Version 1", documentIds: [id] }).success).toBe(true);
    expect(taskSubmissionSchema.safeParse({ taskId: id, notes: "Version 1", documentIds: ["invalid"] }).success).toBe(
      false,
    );
  });

  it("requires reviewers to give actionable feedback when requesting changes or rejecting", () => {
    expect(
      taskReviewSchema.safeParse({ taskId: id, submissionId: id, decision: "approved", feedback: "" }).success,
    ).toBe(true);
    expect(
      taskReviewSchema.safeParse({ taskId: id, submissionId: id, decision: "revision_required", feedback: "" }).success,
    ).toBe(false);
  });
});
