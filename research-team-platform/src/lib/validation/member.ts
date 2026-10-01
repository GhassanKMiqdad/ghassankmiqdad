import { z } from "zod";

import { MEMBER_STATUSES, PERMISSION_KEYS } from "@/lib/permissions/catalog";
import { emailField } from "@/lib/validation/common";

/** Roles that can be handed out (ownership is transferred, never assigned). */
export const ASSIGNABLE_ROLES = ["manager", "member", "reviewer"] as const;

export const addMemberSchema = z.object({
  email: emailField,
  role: z.enum(ASSIGNABLE_ROLES, "validation.invalid"),
});

export const updateMemberSchema = z
  .object({
    role: z.enum(ASSIGNABLE_ROLES, "validation.invalid").optional(),
    status: z.enum(MEMBER_STATUSES, "validation.invalid").optional(),
    resetPermissions: z.boolean().optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, { message: "validation.required" });

export const permissionsSchema = z.object({
  permissions: z.array(z.enum(PERMISSION_KEYS, "validation.invalid")).max(PERMISSION_KEYS.length),
});

export type AddMemberInput = z.input<typeof addMemberSchema>;
