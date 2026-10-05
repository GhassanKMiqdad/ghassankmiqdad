import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { normalizeTaskStatus, PERMISSION_KEYS, ROLE_TEMPLATES } from "@/lib/permissions/catalog";

const root = path.resolve(import.meta.dirname, "../..");
const firestoreRules = readFileSync(path.join(root, "firestore.rules"), "utf8");
const storageRules = readFileSync(path.join(root, "storage.rules"), "utf8");
const serverAuthorization = readFileSync(path.join(root, "src/lib/firebase/compat.ts"), "utf8");
const sharedPolicy = readFileSync(path.join(root, "src/lib/permissions/policy.ts"), "utf8");

function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key));
}

describe("Firebase ↔ application consistency", () => {
  it("the permission catalog is represented in Firestore authorization rules", () => {
    for (const key of PERMISSION_KEYS) {
      expect(
        `${firestoreRules}\n${serverAuthorization}\n${sharedPolicy}`,
        `Firebase authorization must reference ${key}`,
      ).toContain(key);
    }
  });

  it("researcher defaults cannot define tasks, view the whole task list, or view all documents", () => {
    expect(ROLE_TEMPLATES.member).not.toContain("tasks.create");
    expect(ROLE_TEMPLATES.member).not.toContain("tasks.edit");
    expect(ROLE_TEMPLATES.member).not.toContain("tasks.view");
    expect(ROLE_TEMPLATES.member).not.toContain("documents.view");
    expect(ROLE_TEMPLATES.member).toContain("tasks.update_progress");
    expect(ROLE_TEMPLATES.member).toContain("tasks.add_work_notes");
    expect(ROLE_TEMPLATES.member).toContain("tasks.submit");
    expect(ROLE_TEMPLATES.member).toContain("tasks.accept");
  });

  it("Firestore Rules delegate task mutations to audited Server Actions", () => {
    expect(firestoreRules).toContain("match /tasks/{taskId}");
    expect(firestoreRules).toContain("allow create, update, delete: if false;");
    expect(sharedPolicy).toContain('next === "accepted"');
    expect(sharedPolicy).toContain('next === "in_progress"');
    expect(serverAuthorization).toContain("assertTaskMutation");
  });

  it("Storage Rules require an authenticated, explicitly authorized project member", () => {
    expect(storageRules).toContain("request.auth.uid");
    expect(storageRules).toContain("authorized_users");
    expect(storageRules).toContain("hasPermission");
  });

  it("Arabic and English dictionaries expose exactly the same keys", () => {
    expect(keysOf(ar).sort()).toEqual(keysOf(en).sort());
  });

  it("every task status has a label in both languages", () => {
    for (const status of [
      "assigned",
      "accepted",
      "in_progress",
      "submitted",
      "under_review",
      "revision_required",
      "approved",
      "completed",
      "cancelled",
    ] as const) {
      expect(en.taskStatus).toHaveProperty(status);
      expect(ar.taskStatus).toHaveProperty(status);
    }
  });

  it("normalizes retired task states without exposing them as current UI states", () => {
    expect(normalizeTaskStatus("todo")).toBe("assigned");
    expect(normalizeTaskStatus("review")).toBe("under_review");
    expect(normalizeTaskStatus("rejected")).toBe("cancelled");
    expect(normalizeTaskStatus("unknown")).toBeNull();
  });
});
