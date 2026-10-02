import { describe, expect, it } from "vitest";

import { AppError, mapDatabaseError, toAppError } from "@/lib/errors";

describe("mapDatabaseError", () => {
  it("passes through machine-readable codes raised by RPCs and triggers", () => {
    expect(mapDatabaseError({ code: "42501", message: "TASK_EDIT_FORBIDDEN" })).toBe("TASK_EDIT_FORBIDDEN");
    expect(mapDatabaseError({ code: "P0002", message: "USER_NOT_FOUND" })).toBe("USER_NOT_FOUND");
    expect(mapDatabaseError({ code: "42501", message: "PERMISSION_ESCALATION" })).toBe("PERMISSION_ESCALATION");
  });

  it("maps Postgres / PostgREST error classes without leaking raw messages", () => {
    expect(
      mapDatabaseError({ code: "42501", message: 'new row violates row-level security policy for table "tasks"' }),
    ).toBe("PERMISSION_DENIED");
    expect(mapDatabaseError({ code: "42501", message: "permission denied for table activity_logs" })).toBe(
      "PERMISSION_DENIED",
    );
    expect(
      mapDatabaseError({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }),
    ).toBe("NOT_FOUND");
    expect(mapDatabaseError({ code: "23505", message: "duplicate key value" })).toBe("CONFLICT");
    expect(mapDatabaseError({ code: "22P02", message: "invalid input syntax for type uuid" })).toBe("INVALID_INPUT");
    expect(mapDatabaseError({ code: "XX000", message: "internal error at line 3" })).toBe("UNEXPECTED");
    expect(mapDatabaseError(null)).toBe("UNEXPECTED");
  });

  it("wraps unknown errors as UNEXPECTED", () => {
    expect(toAppError(new TypeError("boom")).code).toBe("UNEXPECTED");
    expect(toAppError(new AppError("ALREADY_MEMBER")).code).toBe("ALREADY_MEMBER");
  });
});
