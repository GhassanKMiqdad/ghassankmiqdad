import { z } from "zod";

import { DURATION_UNITS, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/permissions/catalog";
import { emailField, optionalUuidField, uuidField } from "@/lib/validation/common";
import { TASK_CODE_PATTERN } from "@/lib/schedule";

/** "" / null → null; otherwise a wall-clock "YYYY-MM-DDTHH:mm" in the application time zone. */
export const optionalLocalDateTimeField = z
  .union([
    z.literal(""),
    z.null(),
    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "validation.invalidDate"),
  ])
  .optional()
  .transform((value) => (value ? value : null));

const optionalNumber = (schema: z.ZodNumber) =>
  z
    .union([z.literal(""), z.null(), z.coerce.number()])
    .optional()
    .transform((value) => (value === "" || value === null || value === undefined ? null : value))
    .pipe(schema.nullable());

const text = (max: number) => z.string().trim().max(max, "validation.tooLong");

/**
 * Task definition form (supervisors). Sections: basic information,
 * assignment, scheduling, priority, expected result.
 */
export const taskFormSchema = z
  .object({
    taskCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(60, "validation.tooLong")
      .refine((value) => value === "" || TASK_CODE_PATTERN.test(value), "validation.invalidTaskCode")
      .optional()
      .transform((value) => (value ? value : null)),
    title: z.string().trim().min(2, "validation.tooShort").max(200, "validation.tooLong"),
    description: text(10000),
    originalInstructions: text(10000),
    expectedOutput: text(5000),
    completionCriteria: text(5000),
    assignedTo: optionalUuidField,
    priority: z.enum(TASK_PRIORITIES, "validation.invalid"),
    planningMonth: z.coerce.number().int("validation.invalid").min(1, "validation.invalid").max(99, "validation.invalid"),
    planningWeek: optionalNumber(z.number().int("validation.invalid").min(1, "validation.invalid").max(5, "validation.invalid")),
    plannedStart: optionalLocalDateTimeField,
    plannedDuration: optionalNumber(z.number().gt(0, "validation.invalid").max(1000, "validation.invalid")),
    durationUnit: z
      .union([z.literal(""), z.null(), z.enum(DURATION_UNITS, "validation.invalid")])
      .optional()
      .transform((value) => (value ? value : null)),
    dueOverride: z.boolean().default(false),
    dueAt: optionalLocalDateTimeField,
  })
  .superRefine((value, ctx) => {
    if (value.plannedDuration !== null && value.durationUnit === null) {
      ctx.addIssue({ code: "custom", path: ["durationUnit"], message: "validation.required" });
    }
    if (value.dueOverride && value.dueAt === null) {
      ctx.addIssue({ code: "custom", path: ["dueAt"], message: "validation.required" });
    }
    // Same time zone on both sides: wall-clock strings compare chronologically.
    if (value.dueOverride && value.dueAt && value.plannedStart && value.dueAt < value.plannedStart) {
      ctx.addIssue({ code: "custom", path: ["dueAt"], message: "validation.deadlineBeforeStart" });
    }
  });

export type TaskFormInput = z.input<typeof taskFormSchema>;
export type TaskFormValues = z.output<typeof taskFormSchema>;

/** Direct status change (start, block, cancel, reopen). Workflow steps have their own actions. */
export const taskStatusSchema = z.object({ status: z.enum(TASK_STATUSES, "validation.invalid") });

/** Execution updates by the responsible member. */
export const taskProgressSchema = z.object({
  progress: z.coerce.number().int("validation.invalid").min(0, "validation.invalid").max(100, "validation.invalid"),
  workNotes: text(10000),
});
export type TaskProgressInput = z.input<typeof taskProgressSchema>;

/** One deliverable link per line (http/https), at most 10. */
const linksField = z
  .string()
  .max(25000, "validation.tooLong")
  .transform((value) =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  )
  .pipe(
    z
      .array(z.url({ protocol: /^https?$/, error: "validation.invalidUrl" }).max(2048, "validation.tooLong"))
      .max(10, "validation.tooManyLinks"),
  );

export const submitTaskSchema = z.object({
  summary: z.string().trim().min(1, "validation.required").max(10000, "validation.tooLong"),
  links: linksField,
  notes: text(5000),
});
export type SubmitTaskInput = z.input<typeof submitTaskSchema>;
export type SubmitTaskValues = z.output<typeof submitTaskSchema>;

export const reviewTaskSchema = z
  .object({
    decision: z.enum(["approved", "revision_required"], "validation.invalid"),
    comment: text(5000),
    requiredChanges: text(5000),
    additionalInstructions: text(5000),
    newDueAt: optionalLocalDateTimeField,
  })
  .superRefine((value, ctx) => {
    if (value.decision === "revision_required" && !value.requiredChanges && !value.comment) {
      ctx.addIssue({ code: "custom", path: ["requiredChanges"], message: "validation.required" });
    }
  });
export type ReviewTaskInput = z.input<typeof reviewTaskSchema>;

export const completeTaskSchema = z.object({ teamComment: text(5000) });
export type CompleteTaskInput = z.input<typeof completeTaskSchema>;

export const dependencySchema = z.object({ dependsOn: uuidField });

// -----------------------------------------------------------------------------
// Teams (Director)
// -----------------------------------------------------------------------------
export const teamSchema = z.object({
  name: z.string().trim().min(2, "validation.tooShort").max(120, "validation.tooLong"),
  description: text(2000),
});
export type TeamInput = z.input<typeof teamSchema>;

export const teamMemberSchema = z.object({
  displayName: z.string().trim().min(1, "validation.required").max(120, "validation.tooLong"),
  memberCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}$/, "validation.invalidMemberCode"),
  jobTitle: text(120),
  role: z.enum(["team_lead", "team_member"], "validation.invalid"),
  inviteEmail: z
    .union([z.literal(""), emailField])
    .optional()
    .transform((value) => (value ? value.toLowerCase() : null)),
});
export type TeamMemberInput = z.input<typeof teamMemberSchema>;
export type TeamMemberValues = z.output<typeof teamMemberSchema>;

export const linkMemberSchema = z.object({ email: emailField });
