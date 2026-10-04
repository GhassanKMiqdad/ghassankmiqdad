import { describe, expect, it } from "vitest";

import { AppError, mapFirebaseError, toAppError } from "@/lib/errors";

describe("mapFirebaseError", () => {
  it("passes through known application codes emitted by the server adapter", () => {
    expect(mapFirebaseError({ code: "failed-precondition", message: "TASK_EDIT_FORBIDDEN" })).toBe(
      "TASK_EDIT_FORBIDDEN",
    );
    expect(mapFirebaseError({ message: "USER_NOT_FOUND" })).toBe("USER_NOT_FOUND");
    expect(mapFirebaseError({ message: "PERMISSION_ESCALATION" })).toBe("PERMISSION_ESCALATION");
  });

  it("maps Firebase SDK errors to safe application codes without exposing provider messages", () => {
    expect(mapFirebaseError({ code: "permission-denied", message: "private path" })).toBe("PERMISSION_DENIED");
    expect(mapFirebaseError({ code: "not-found", message: "missing record" })).toBe("NOT_FOUND");
    expect(mapFirebaseError({ code: "already-exists", message: "duplicate" })).toBe("CONFLICT");
    expect(mapFirebaseError({ code: "invalid-argument", message: "bad input" })).toBe("INVALID_INPUT");
    expect(mapFirebaseError({ code: "unauthenticated", message: "expired" })).toBe("NOT_AUTHENTICATED");
    expect(mapFirebaseError({ code: "internal", message: "secret provider details" })).toBe("UNEXPECTED");
    expect(mapFirebaseError(null)).toBe("UNEXPECTED");
  });

  it("wraps unknown errors as UNEXPECTED and preserves AppErrors", () => {
    expect(toAppError(new TypeError("boom")).code).toBe("UNEXPECTED");
    expect(toAppError(new AppError("ALREADY_MEMBER")).code).toBe("ALREADY_MEMBER");
  });
});
