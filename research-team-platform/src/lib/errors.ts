import type { Dictionary } from "@/lib/i18n/dictionaries";

export type ErrorCode = keyof Dictionary["errors"];

/** Expected, user-facing failure. Messages are resolved from the dictionary. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly values?: Record<string, string>;
  readonly fieldErrors?: Record<string, string>;

  constructor(code: ErrorCode, options?: { values?: Record<string, string>; fieldErrors?: Record<string, string> }) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.values = options?.values;
    this.fieldErrors = options?.fieldErrors;
  }
}

const KNOWN_DATABASE_CODES = new Set<string>([
  "NOT_AUTHENTICATED",
  "PERMISSION_DENIED",
  "PROJECT_CREATE_FORBIDDEN",
  "TASK_EDIT_FORBIDDEN",
  "TASK_STATUS_FORBIDDEN",
  "TASK_ASSIGN_FORBIDDEN",
  "ASSIGNEE_NOT_MEMBER",
  "ROLE_NOT_ALLOWED",
  "CANNOT_MODIFY_OWNER",
  "CANNOT_MODIFY_SELF",
  "INSUFFICIENT_RANK",
  "PERMISSION_ESCALATION",
  "UNKNOWN_PERMISSION",
  "ALREADY_MEMBER",
  "USER_NOT_FOUND",
  "MEMBER_NOT_FOUND",
  "DOCUMENT_FILE_MISSING",
  "LAST_PLATFORM_ADMIN",
  "OWNER_HAS_PROJECTS",
  "IMMUTABLE_FIELD",
  "ACTIVITY_LOG_IMMUTABLE",
  "INVALID_INPUT",
]);

export type DatabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

/**
 * Maps a PostgREST / Postgres error to an application error code. Raw database
 * messages are never shown to users.
 */
export function mapDatabaseError(error: DatabaseErrorLike | null | undefined): ErrorCode {
  if (!error) return "UNEXPECTED";
  const message = (error.message ?? "").trim();
  if (KNOWN_DATABASE_CODES.has(message)) return message as ErrorCode;

  switch (error.code) {
    case "42501": // insufficient_privilege / RLS violation
      return "PERMISSION_DENIED";
    case "PGRST116": // .single() found no row the user can see
    case "P0002":
      return "NOT_FOUND";
    case "23505":
      return "CONFLICT";
    case "23503":
    case "22P02":
    case "22023":
    case "22007":
    case "22008":
      return "INVALID_INPUT";
    case "23514":
    case "23502":
      return "VALIDATION_ERROR";
    case "PGRST301":
    case "PGRST302":
      return "NOT_AUTHENTICATED";
    default:
      return "UNEXPECTED";
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error && typeof error === "object" && ("code" in error || "message" in error)) {
    return new AppError(mapDatabaseError(error as DatabaseErrorLike));
  }
  return new AppError("UNEXPECTED");
}
