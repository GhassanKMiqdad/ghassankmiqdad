import type { ErrorCode } from "@/lib/errors";

/** Serializable result returned by every Server Action. */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: ErrorCode;
        message: string;
        /** Field name -> validation message key (e.g. "validation.required"). */
        fieldErrors?: Record<string, string>;
      };
    };
