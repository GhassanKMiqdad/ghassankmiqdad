import { z } from "zod";

import { optionalDateField, optionalUuidField, uuidField } from "@/lib/validation/common";

export const TEAM_STATUSES = ["active", "archived"] as const;
export const teamFormSchema = z.object({
  name: z.string().trim().min(2, "validation.tooShort").max(120, "validation.tooLong"),
  description: z.string().trim().max(3000, "validation.tooLong"),
});
export const teamMemberSchema = z.object({ userId: uuidField });
export const teamLeadSchema = z.object({ userId: optionalUuidField });

export const RESEARCHER_STATUSES = ["active", "inactive", "suspended"] as const;
export const researcherProfileSchema = z.object({
  fullName: z.string().trim().min(2, "validation.tooShort").max(120, "validation.tooLong"),
  phone: z.string().trim().max(40, "validation.tooLong").nullable().optional(),
  avatarUrl: z.union([z.literal(""), z.null(), z.url("validation.invalid")]).optional(),
  specialization: z.string().trim().max(200, "validation.tooLong").optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  academicBackground: z.string().trim().max(3000, "validation.tooLong").optional(),
  status: z.enum(RESEARCHER_STATUSES),
  notes: z.string().trim().max(5000, "validation.tooLong").optional(),
});

export const MILESTONE_STATUSES = ["pending", "in_progress", "at_risk", "completed"] as const;
export const milestoneFormSchema = z
  .object({
    name: z.string().trim().min(2, "validation.tooShort").max(160, "validation.tooLong"),
    description: z.string().trim().max(5000, "validation.tooLong"),
    deadline: optionalDateField,
    responsibleTeamId: optionalUuidField,
    responsibleResearcherId: optionalUuidField,
    status: z.enum(MILESTONE_STATUSES),
  })
  .refine((value) => !(value.responsibleTeamId && value.responsibleResearcherId), {
    message: "validation.chooseOneResponsibleParty",
    path: ["responsibleResearcherId"],
  });

export const taskSubmissionSchema = z.object({
  taskId: uuidField,
  notes: z.string().trim().min(1, "validation.required").max(10000, "validation.tooLong"),
  documentIds: z.array(uuidField).max(20, "validation.tooLong").default([]),
});

export const REVIEW_DECISIONS = ["approved", "revision_required", "rejected"] as const;
export const taskReviewSchema = z
  .object({
    taskId: uuidField,
    submissionId: uuidField,
    decision: z.enum(REVIEW_DECISIONS),
    feedback: z.string().trim().max(10000, "validation.tooLong"),
  })
  .refine((value) => value.decision === "approved" || value.feedback.length >= 3, {
    message: "validation.required",
    path: ["feedback"],
  });

export type TeamFormValues = z.output<typeof teamFormSchema>;
export type ResearcherProfileValues = z.output<typeof researcherProfileSchema>;
export type MilestoneFormInput = z.input<typeof milestoneFormSchema>;
export type MilestoneFormValues = z.output<typeof milestoneFormSchema>;
export type TaskSubmissionValues = z.output<typeof taskSubmissionSchema>;
export type TaskReviewValues = z.output<typeof taskReviewSchema>;
