import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { PERMISSION_KEYS, ROLE_TEMPLATES } from "@/lib/permissions/catalog";

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
  });

  it("Firestore Rules restrict assigned tasks and protect definitions and review outcomes", () => {
    expect(firestoreRules).toContain("data.assigned_to == request.auth.uid");
    expect(firestoreRules).toContain("hasPermission(before.project_id, 'tasks.edit')");
    expect(firestoreRules).toContain("match /task_submissions/{submissionId}");
    expect(firestoreRules).toContain("match /task_reviews/{reviewId}");
    expect(firestoreRules).toContain("allow create, update, delete: if false;");
    expect(firestoreRules).not.toContain("after.status in ['approved', 'revision_required', 'rejected']");
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
    for (const status of ["todo", "in_progress", "review", "revision_required", "completed", "rejected"] as const) {
      expect(en.taskStatus).toHaveProperty(status);
      expect(ar.taskStatus).toHaveProperty(status);
    }
  });
});
