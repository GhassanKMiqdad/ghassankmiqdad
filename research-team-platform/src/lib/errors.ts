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

const KNOWN_APPLICATION_CODES = new Set<string>([
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

export type FirebaseErrorLike = {
  code?: string | number | null;
  message?: string | null;
};

/** Maps Firebase SDK failures without leaking raw provider messages to users. */
export function mapFirebaseError(error: FirebaseErrorLike | null | undefined): ErrorCode {
  if (!error) return "UNEXPECTED";
  const message = (error.message ?? "").trim();
  if (KNOWN_APPLICATION_CODES.has(message)) return message as ErrorCode;

  switch (String(error.code ?? "").toLowerCase()) {
    case "permission-denied":
    case "auth/insufficient-permission":
      return "PERMISSION_DENIED";
    case "not-found":
    case "auth/user-not-found":
      return "NOT_FOUND";
    case "already-exists":
    case "auth/email-already-exists":
      return "CONFLICT";
    case "invalid-argument":
    case "auth/invalid-email":
    case "auth/invalid-password":
    case "auth/weak-password":
      return "INVALID_INPUT";
    case "unauthenticated":
    case "auth/id-token-expired":
    case "auth/invalid-id-token":
      return "NOT_AUTHENTICATED";
    default:
      return "UNEXPECTED";
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error && typeof error === "object" && ("code" in error || "message" in error)) {
    return new AppError(mapFirebaseError(error as FirebaseErrorLike));
  }
  return new AppError("UNEXPECTED");
}
