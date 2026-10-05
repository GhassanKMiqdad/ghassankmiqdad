import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeEmulatorTarget,
  isSafeStoragePath,
  parseExport,
  reconcile,
  sha256,
  validateAndMap,
} from "../../scripts/migration/engine.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = join(root, "tests/migration/fixtures/source-export.json");
const fixtureText = await readFile(fixturePath, "utf8");
const fixture = JSON.parse(fixtureText);
const temporaryDirectories = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "migration-tests-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
function plan(input = fixture) {
  return validateAndMap({ tables: input, issues: [] }, sha256(JSON.stringify(input)));
}

describe("Supabase migration mapping", () => {
  it("normalizes emails, timestamps, metadata, ids and permission grants deterministically", () => {
    const first = plan();
    const second = plan();
    expect(first.report.valid).toBe(true);
    expect(first.records.profiles[0]).toMatchObject({
      email: "owner@example.test",
      is_platform_admin: false,
      can_create_projects: false,
    });
    expect(first.records.profiles[0]).not.toHaveProperty("encrypted_password");
    expect(first.records.projects[0].created_at).toBe("2026-01-02T03:04:05.000Z");
    expect(first.records.project_members.find((member) => member.user_id === "user-owner").id).toBe(
      "project-alpha_user-owner",
    );
    expect(first.records.project_members.find((member) => member.user_id === "user-researcher").permissions).toEqual([
      "project.view",
      "tasks.view",
    ]);
    expect(first.records.user_permissions[0].id).toBe("project-alpha_user-researcher_tasks.view");
    expect(first.records.documents[0].size_bytes).toBe(42);
    expect(first.records.activity_logs[0].metadata).toEqual({ a: 2, z: 1 });
    expect(first.records.tasks[0].status).toBe("assigned");
    expect(first.records).toEqual(second.records);
    expect(first.report.warnings.map((warning) => warning.code)).toContain("AUTH_SECRET_FIELDS_OMITTED");
    expect(first.report.authentication.passwordsMigrated).toBe(false);
    expect(first.report.storage.binaryObjectsCopied).toBe(false);
  });

  it("normalizes legacy task states and critical priority with explicit warnings", () => {
    for (const [legacy, canonical] of [
      ["todo", "assigned"],
      ["review", "under_review"],
      ["rejected", "cancelled"],
    ]) {
      const source = structuredClone(fixture);
      source.tasks[0].status = legacy;
      source.tasks[0].priority = "critical";
      const result = plan(source);
      expect(result.records.tasks[0].status).toBe(canonical);
      expect(result.records.tasks[0].priority).toBe("urgent");
      expect(result.report.warnings.map((warning) => warning.code)).toContain("LEGACY_TASK_STATUS_NORMALIZED");
      expect(result.report.warnings.map((warning) => warning.code)).toContain("LEGACY_TASK_PRIORITY_NORMALIZED");
    }
  });

  it("accepts table-wrapped JSON and flat or wrapped JSONL input", () => {
    const wrapped = parseExport(JSON.stringify({ tables: { profiles: [{ id: "solo", full_name: "" }] } }));
    expect(wrapped.tables.profiles).toHaveLength(1);
    const jsonl = parseExport(
      [
        JSON.stringify({ table: "profiles", row: { id: "user-1", full_name: "A" } }),
        JSON.stringify({ table: "projects", id: "project-1", name: "Project", status: "planning" }),
      ].join("\n"),
      "jsonl",
    );
    expect(jsonl.tables.profiles[0].id).toBe("user-1");
    expect(jsonl.tables.projects[0].id).toBe("project-1");
  });

  it("reports invalid data and missing relationships without dropping the records silently", () => {
    const invalid = structuredClone(fixture);
    invalid.projects[0].status = "unknown";
    invalid.tasks[0].project_id = "missing-project";
    invalid.tasks[0].assigned_to = "missing-user";
    invalid.comments[0].task_id = "missing-task";
    const result = plan(invalid);
    expect(result.report.valid).toBe(false);
    const codes = result.report.issues.map((entry) => entry.code);
    expect(codes).toContain("INVALID_STATUS");
    expect(codes.filter((code) => code === "MISSING_RELATIONSHIP").length).toBeGreaterThanOrEqual(3);
  });

  it("detects exact duplicates, identity conflicts, and natural-key conflicts", () => {
    const duplicate = structuredClone(fixture);
    duplicate.tasks.push(structuredClone(duplicate.tasks[0]));
    expect(plan(duplicate).report.issues.map((entry) => entry.code)).toContain("DUPLICATE_RECORD");

    const conflict = structuredClone(fixture);
    conflict.tasks.push({ ...conflict.tasks[0], title: "Conflicting copy" });
    expect(plan(conflict).report.issues.map((entry) => entry.code)).toContain("CONFLICTING_RECORD");

    const uniqueConflict = structuredClone(fixture);
    uniqueConflict.profiles.push({ id: "different-user", email: "OWNER@example.test", full_name: "Different" });
    expect(plan(uniqueConflict).report.issues.map((entry) => entry.code)).toContain("DUPLICATE_KEY");
  });

  it("rejects path traversal, encoded traversal, absolute paths, and cross-document paths", () => {
    for (const path of [
      "project-alpha/document-1/../secret",
      "project-alpha/document-1/%2e%2e/secret",
      "/absolute/file",
      "project-alpha\\document-1\\file",
    ]) {
      expect(isSafeStoragePath(path)).toBe(false);
    }
    const unsafe = structuredClone(fixture);
    unsafe.documents[0].storage_path = "project-alpha/document-1/../secret";
    expect(plan(unsafe).report.issues.map((entry) => entry.code)).toContain("UNSAFE_STORAGE_PATH");
    const crossScope = structuredClone(fixture);
    crossScope.documents[0].storage_path = "other/document-1/file.pdf";
    expect(plan(crossScope).report.issues.map((entry) => entry.code)).toContain("INVALID_STORAGE_SCOPE");
    const unsafeId = structuredClone(fixture);
    unsafeId.projects[0].id = "project-alpha/nested";
    expect(plan(unsafeId).report.issues.map((entry) => entry.code)).toContain("UNSAFE_DOCUMENT_ID");
  });

  it("reconciles expected, completed, and remaining records", () => {
    const result = plan();
    const expected = result.report.reconciliation.expectedTargetRows;
    const partial = reconcile(result, {
      completed: { "profiles/user-owner": "written", "projects/project-alpha": "written" },
    });
    expect(partial).toEqual({ expected, completed: 2, remaining: expected - 2, matches: false });
    const complete = reconcile(result, {
      completed: Object.fromEntries(Array.from({ length: expected }, (_, index) => [`row-${index}`, "written"])),
    });
    expect(complete).toEqual({ expected, completed: expected, remaining: 0, matches: true });
  });

  it("refuses apply unless both target project and Firestore emulator host are loopback-safe", () => {
    expect(() => assertSafeEmulatorTarget("research-team-platform", "localhost:8080")).toThrow(/demo-/);
    expect(() => assertSafeEmulatorTarget("demo-test", "firestore.googleapis.com:443")).toThrow(/localhost/);
    expect(() => assertSafeEmulatorTarget("demo-test", "localhost:8080")).not.toThrow();
  });

  it("runs CLI in dry-run mode by default and creates no checkpoint or Firebase connection", async () => {
    const directory = await temporaryDirectory();
    const reportPath = join(directory, "report.json");
    const checkpointPath = join(directory, "checkpoint.json");
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/migration/cli.mjs"), "--input", fixturePath, "--report", reportPath],
      {
        cwd: root,
        env: { ...process.env, FIRESTORE_EMULATOR_HOST: "127.0.0.1:1" },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No Firebase connection or data writes were made");
    expect((await readFile(reportPath, "utf8")).includes('"mode": "dry-run"')).toBe(true);
    await expect(readFile(checkpointPath, "utf8")).rejects.toThrow();
  });

  it("does not permit an implicit production or named Firebase apply", () => {
    const result = spawnSync(
      process.execPath,
      [
        join(root, "scripts/migration/cli.mjs"),
        "--input",
        fixturePath,
        "--apply",
        "--target-project",
        "research-team-platform",
        "--checkpoint",
        "/tmp/nope",
      ],
      {
        cwd: root,
        env: { ...process.env, FIRESTORE_EMULATOR_HOST: "localhost:8080" },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("demo-*");
  });
});
