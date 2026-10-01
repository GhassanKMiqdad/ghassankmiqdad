import { z } from "zod";

import { uuidField } from "@/lib/validation/common";

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, "validation.tooShort").max(120, "validation.tooLong"),
});

export const platformFlagsSchema = z
  .object({
    userId: uuidField,
    isPlatformAdmin: z.boolean().optional(),
    canCreateProjects: z.boolean().optional(),
  })
  .refine((value) => value.isPlatformAdmin !== undefined || value.canCreateProjects !== undefined, {
    message: "validation.required",
  });

export type ProfileInput = z.input<typeof profileSchema>;
