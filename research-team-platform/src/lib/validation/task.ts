import { z } from "zod";

import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/permissions/catalog";
import { optionalDateField, optionalUuidField } from "@/lib/validation/common";

export const taskFormSchema = z.object({
  title: z.string().trim().min(2, "validation.tooShort").max(200, "validation.tooLong"),
  description: z.string().trim().max(10000, "validation.tooLong"),
  expectedOutput: z.string().trim().max(5000, "validation.tooLong"),
  requiredDeliverables: z.string().trim().max(10000, "validation.tooLong"),
  status: z.enum(TASK_STATUSES, "validation.invalid"),
  priority: z.enum(TASK_PRIORITIES, "validation.invalid"),
  assignedTo: optionalUuidField,
  dueDate: optionalDateField,
});

/** Partial update (e.g. quick status change from the task list). */
export const taskPatchSchema = z
  .object({
    title: z.string().trim().min(2, "validation.tooShort").max(200, "validation.tooLong"),
    description: z.string().trim().max(10000, "validation.tooLong"),
    expectedOutput: z.string().trim().max(5000, "validation.tooLong"),
    requiredDeliverables: z.string().trim().max(10000, "validation.tooLong"),
    status: z.enum(TASK_STATUSES, "validation.invalid"),
    priority: z.enum(TASK_PRIORITIES, "validation.invalid"),
    assignedTo: optionalUuidField,
    dueDate: optionalDateField,
    progress: z.number().int().min(0).max(100),
    workNotes: z.string().trim().max(10000, "validation.tooLong"),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "validation.required" });

export type TaskFormInput = z.input<typeof taskFormSchema>;
export type TaskFormValues = z.output<typeof taskFormSchema>;
export type TaskPatchInput = z.input<typeof taskPatchSchema>;
