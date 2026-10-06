import { describe, expect, it } from "vitest";

import { PERMISSION_KEYS } from "../../src/lib/permissions/catalog";
import { parseMigrationArguments } from "../../scripts/migration/cli";
import {
  isSafeSubsetEqual,
  mapAuthUser,
  mapDocument,
  mapMembership,
  mapPermissionCatalogs,
  mapProfile,
  mapTask,
  membershipDocumentId,
  permissionDocumentId,
} from "../../scripts/migration/mapping";

const uid = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";

const authUser = {
  id: uid,
  email: "researcher@example.org",
  email_confirmed_at: "2025-01-01T00:00:00.000Z",
  created_at: "2024-01-01T00:00:00.000Z",
  user_metadata: { full_name: "Researcher One" },
};

describe("Supabase to Firebase migration mappings", () => {
  it("defaults to dry-run and rejects contradictory or unknown migration flags", () => {
    expect(parseMigrationArguments([])).toEqual({ help: false, mode: "dry-run" });
    expect(parseMigrationArguments(["--dry-run"])).toEqual({ help: false, mode: "dry-run" });
    expect(parseMigrationArguments(["--help"])).toEqual({ help: true, mode: "dry-run" });
    expect(parseMigrationArguments(["--apply", "--confirm-apply=staging"])).toEqual({ help: false, mode: "apply" });
    expect(() => parseMigrationArguments(["--apply", "--dry-run"])).toThrow("cannot be combined");
    expect(() => parseMigrationArguments(["--prod"])).toThrow("Unknown migration argument");
    expect(() => parseMigrationArguments(["--confirm-apply=staging"])).toThrow("only with --apply");
  });

  it("preserves Firebase Auth UIDs and stable relationship document IDs", () => {
    expect(membershipDocumentId(projectId, uid)).toBe(`${projectId}_${uid}`);
    expect(permissionDocumentId(projectId, uid, "project.view")).toBe(`${projectId}_${uid}_project.view`);
    expect(mapAuthUser(authUser).uid).toBe(uid);
  });

  it("maps verified auth/profile fields without inventing an email or privilege", () => {
    const mappedAuth = mapAuthUser(authUser, { full_name: "Profile Name" });
    expect(mappedAuth).toMatchObject({
      uid,
      email: "researcher@example.org",
      displayName: "Profile Name",
      emailVerified: true,
      disabled: false,
    });

    const profile = mapProfile(
      {
        id: uid,
        email: "researcher@example.org",
        full_name: "Profile Name",
        is_platform_admin: false,
        can_create_projects: false,
      },
      authUser,
    );
    expect(profile.data).toMatchObject({
      id: uid,
      email_lower: "researcher@example.org",
      email_verified: true,
      is_platform_admin: false,
      can_create_projects: false,
    });
  });

  it("maps an active legacy member to assigned-work defaults while dropping broad legacy grants", () => {
    const result = mapMembership(
      { id: "legacy-membership", project_id: projectId, user_id: uid, role: "member", status: "active" },
      [
        "project.view",
        "tasks.view",
        "tasks.create",
        "tasks.edit_own",
        "documents.view",
        "documents.upload",
        "comments.create",
        "team.view",
      ],
    );
    expect(result.membership.data.permissions).toEqual([
      "project.view",
      "tasks.update_progress",
      "tasks.add_work_notes",
      "tasks.submit",
      "documents.upload",
      "comments.create",
    ]);
    expect(result.removedPermissions).toEqual([
      "documents.view",
      "tasks.create",
      "tasks.edit_own",
      "tasks.view",
      "team.view",
    ]);
    expect(result.grants.every((grant) => grant.data.user_id === uid)).toBe(true);
  });

  it("keeps owners implicit and does not create synthetic owner grant records", () => {
    const result = mapMembership({ project_id: projectId, user_id: uid, role: "owner", status: "active" }, []);
    expect(result.membership.data.permissions).toEqual([...PERMISSION_KEYS]);
    expect(result.grants).toEqual([]);
  });

  it("preserves source task states and supplies empty target-only work fields", () => {
    const task = mapTask({
      id: uid,
      project_id: projectId,
      title: "Review literature",
      status: "review",
      priority: "high",
    });
    expect(task.data).toMatchObject({
      status: "review",
      expected_output: "",
      required_deliverables: "",
      progress: 100,
      work_notes: "",
    });
  });

  it("migrates document metadata with uploader-only explicit sharing", () => {
    const document = mapDocument({
      id: uid,
      project_id: projectId,
      storage_path: `${projectId}/${uid}/results.csv`,
      uploaded_by: uid,
      mime_type: "text/csv",
      size_bytes: 42,
    });
    expect(document.data.authorized_users).toEqual([uid]);
    expect(document.data.storage_path).toBe(`${projectId}/${uid}/results.csv`);
    expect(() =>
      mapDocument({
        id: uid,
        project_id: projectId,
        storage_path: `${projectId}/../outside/results.csv`,
      }),
    ).toThrow("Invalid document storage path");
  });

  it("regenerates target reference catalogs from current code definitions", () => {
    const catalogs = mapPermissionCatalogs();
    expect(catalogs.filter((item) => item.collection === "permissions")).toHaveLength(PERMISSION_KEYS.length);
    expect(
      catalogs.some(
        (item) => item.collection === "role_permissions" && item.data.permission_key === "tasks.update_progress",
      ),
    ).toBe(true);
  });

  it("compares source projections without rejecting target-only fields", () => {
    expect(isSafeSubsetEqual({ id: uid, status: "active" }, { id: uid, status: "active", target_only: true })).toBe(
      true,
    );
    expect(isSafeSubsetEqual({ id: uid, status: "active" }, { id: uid, status: "suspended" })).toBe(false);
  });
});
