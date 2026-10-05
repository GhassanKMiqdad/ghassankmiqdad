import { z } from "zod";

import { emailField, passwordField } from "@/lib/validation/common";

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "validation.required").max(72, "validation.tooLong"),
});

export const signupSchema = z
  .object({
    fullName: z.string().trim().min(2, "validation.tooShort").max(120, "validation.tooLong"),
    email: emailField,
    password: passwordField,
    confirmPassword: z.string().min(1, "validation.required"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "validation.passwordsDontMatch",
  });
export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const newPasswordSchema = z
  .object({
    password: passwordField,
    confirmPassword: z.string().min(1, "validation.required"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "validation.passwordsDontMatch",
  });

export const passwordChangeSchema = newPasswordSchema.extend({
  currentPassword: z.string().min(1, "validation.required").max(72, "validation.tooLong"),
});
export type PasswordChangeInput = z.input<typeof passwordChangeSchema>;

/** Only same-origin relative paths are accepted as post-login redirects. */
export function safeRedirectPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.startsWith("/login") || value.startsWith("/signup") || value.startsWith("/auth/")) return fallback;
  return value;
}

export type LoginInput = z.input<typeof loginSchema>;
export type SignupInput = z.input<typeof signupSchema>;
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;
export type NewPasswordInput = z.input<typeof newPasswordSchema>;
