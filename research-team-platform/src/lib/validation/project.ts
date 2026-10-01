import { z } from "zod";

import { PROJECT_STATUSES } from "@/lib/permissions/catalog";
import { optionalDateField, uuidField } from "@/lib/validation/common";

export const projectFormSchema = z
  .object({
    name: z.string().trim().min(2, "validation.tooShort").max(160, "validation.tooLong"),
    description: z.string().trim().max(5000, "validation.tooLong"),
    researchGoal: z.string().trim().max(5000, "validation.tooLong"),
    status: z.enum(PROJECT_STATUSES, "validation.invalid"),
    startDate: optionalDateField,
    deadline: optionalDateField,
  })
  .refine((values) => !values.startDate || !values.deadline || values.deadline >= values.startDate, {
    path: ["deadline"],
    message: "validation.deadlineBeforeStart",
  });

export const transferOwnershipSchema = z.object({
  newOwnerId: uuidField,
});

export const deleteProjectSchema = z.object({
  confirmation: z.string().trim().min(1, "validation.required"),
});

export type ProjectFormInput = z.input<typeof projectFormSchema>;
export type ProjectFormValues = z.output<typeof projectFormSchema>;
