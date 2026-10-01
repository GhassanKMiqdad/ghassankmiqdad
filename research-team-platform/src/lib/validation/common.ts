import { z } from "zod";

/**
 * Validation messages are dictionary keys ("validation.*"); forms translate
 * them with `i18n.message()`, so one schema serves the browser (React Hook
 * Form) and the server (Server Actions) in every language.
 */
export const emailField = z
  .string()
  .trim()
  .min(1, "validation.required")
  .max(254, "validation.tooLong")
  .pipe(z.email("validation.invalidEmail"));

export const passwordField = z
  .string()
  .min(8, "validation.passwordTooShort")
  .max(72, "validation.tooLong")
  .regex(/[A-Za-z؀-ۿ]/, "validation.passwordWeak")
  .regex(/\d/, "validation.passwordWeak");

export const uuidField = z.uuid("validation.invalid");

/** "" or null from an empty <input type="date"> becomes null. */
export const optionalDateField = z
  .union([z.literal(""), z.null(), z.iso.date("validation.invalidDate")])
  .optional()
  .transform((value) => (value ? value : null));

export const optionalUuidField = z
  .union([z.literal(""), z.null(), z.uuid("validation.invalid")])
  .optional()
  .transform((value) => (value ? value : null));
