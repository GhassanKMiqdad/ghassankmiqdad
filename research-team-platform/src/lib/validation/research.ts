import { z } from "zod";

import { optionalDateField, optionalUuidField, uuidField } from "@/lib/validation/common";

const nameField = z.string().trim().min(2, "validation.tooShort").max(120, "validation.tooLong");
const descriptionField = z.string().trim().max(5000, "validation.tooLong");

export const teamCreateSchema = z.object({ name: nameField, description: descriptionField });
export const teamPatchSchema = z
  .object({ name: nameField.optional(), description: descriptionField.optional() })
  .refine((patch) => Object.keys(patch).length > 0, { message: "validation.required" });
export const teamMemberSchema = z.object({ userId: uuidField });
export const teamLeadSchema = z.object({ userId: optionalUuidField });

export const milestoneFormSchema = z.object({
  title: nameField,
  description: descriptionField,
  dueDate: optionalDateField,
  teamId: optionalUuidField,
  researcherIds: z
    .array(uuidField)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, "validation.invalid"),
});
export const milestonePatchSchema = milestoneFormSchema;
export const resourceIdSchema = uuidField;

export type TeamCreateInput = z.input<typeof teamCreateSchema>;
export type TeamPatchInput = z.input<typeof teamPatchSchema>;
export type MilestoneInput = z.input<typeof milestoneFormSchema>;
