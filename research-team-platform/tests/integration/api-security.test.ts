/**
 * API security suite: calls the Supabase API directly with each user's real
 * session — exactly what an attacker who skips the UI would do — and checks
 * that Row Level Security, column privileges, triggers and RPC checks reject
 * everything the user is not allowed to do.
 *
 *   npx supabase start && npm run seed   # or any local stack with the migrations
 *   npm run test:integration
 */
import { createHmac, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mapDatabaseError } from "@/lib/errors";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { ROLE_TEMPLATES } from "@/lib/permissions/catalog";

import { anonymousClient, BUCKET, createFixture, must, readIntegrationEnv, type Fixture } from "./fixture";

const { env, reason } = readIntegrationEnv();
if (!env) console.warn(`[integration] skipped: ${reason}`);

type Response<T> = { data: T | null; error: { code?: string; message: string } | null };

/** Rows returned by a request that must succeed (RLS may legitimately return none). */
async function rows<T>(request: PromiseLike<Response<T[]>>): Promise<T[]> {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The error of a request that must fail. */
async function failure(request: PromiseLike<Response<unknown>>) {
  const { error } = await request;
  expect(error, "request should have been rejected").not.toBeNull();
  return error!;
}

/** Message the application shows for a database error (Arabic interface). */
function userMessage(error: { code?: string; message: string }) {
  return ar.errors[mapDatabaseError(error)];
}

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe.skipIf(!env)("API security — direct requests that bypass the UI", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(env!);
  }, 120_000);

  afterAll(async () => {
    await f?.cleanup();
  }, 120_000);

  const taskTitle = async (id: string) =>
    must("read task", await f.admin.from("tasks").select("title").eq("id", id).single()).title;
  const taskExists = async (id: string) => (await rows(f.admin.from("tasks").select("id").eq("id", id))).length === 1;
  const permissionsOf = async (userId: string) =>
    (
      await rows(
        f.admin.from("user_permissions").select("permission_key").eq("project_id", f.projectA).eq("user_id", userId),
      )
    ).map((row) => row.permission_key);

  // -------------------------------------------------------------------------
  describe("owner (admin of the project)", () => {
    it("can edit the project, edit any task, delete tasks and manage permissions", async () => {
      const { owner, member } = f.users;
      const client = owner.client;

      expect(
        await rows(
          client.from("projects").update({ research_goal: "Updated by owner" }).eq("id", f.projectA).select("id"),
        ),
      ).toHaveLength(1);
      expect(
        await rows(
          client.from("tasks").update({ title: "Edited by owner" }).eq("id", f.tasks.assignedToManager).select("id"),
        ),
      ).toHaveLength(1);
      expect(
        await rows(client.from("tasks").update({ priority: "critical" }).eq("id", f.tasks.ownedByMember).select("id")),
      ).toHaveLength(1);

      const granted = must(
        "grant activity.view",
        await client.rpc("set_member_permissions", {
          p_project_id: f.projectA,
          p_user_id: member.id,
          p_permissions: [...ROLE_TEMPLATES.member, "activity.view"],
        }),
      );
      expect(granted).toContain("activity.view");
      must(
        "restore template",
        await client.rpc("set_member_permissions", {
          p_project_id: f.projectA,
          p_user_id: member.id,
          p_permissions: [...ROLE_TEMPLATES.member],
        }),
      );
      expect(await permissionsOf(member.id)).not.toContain("activity.view");

      expect(await rows(client.from("tasks").delete().eq("id", f.tasks.unassigned).select("id"))).toHaveLength(1);
      expect(await taskExists(f.tasks.unassigned)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("research member", () => {
    it("cannot delete a task without the tasks.delete permission", async () => {
      const { member } = f.users;
      for (const id of [f.tasks.assignedToMember, f.tasks.ownedByMember, f.tasks.assignedToManager]) {
        expect(await rows(member.client.from("tasks").delete().eq("id", id).select("id"))).toEqual([]);
        expect(await taskExists(id)).toBe(true);
      }
    });

    it("can edit a task assigned to them and a task they created", async () => {
      const { member } = f.users;
      expect(
        await rows(
          member.client
            .from("tasks")
            .update({ title: "Assigned — updated", status: "in_progress" })
            .eq("id", f.tasks.assignedToMember)
            .select("id"),
        ),
      ).toHaveLength(1);
      expect(await taskTitle(f.tasks.assignedToMember)).toBe("Assigned — updated");

      expect(
        await rows(
          member.client.from("tasks").update({ title: "Own — updated" }).eq("id", f.tasks.ownedByMember).select("id"),
        ),
      ).toHaveLength(1);
      expect(await taskTitle(f.tasks.ownedByMember)).toBe("Own — updated");
    });

    it("cannot edit a task that another user created and that is not assigned to them", async () => {
      const { member } = f.users;
      const before = await taskTitle(f.tasks.assignedToManager);
      // RLS excludes the row from the UPDATE: nothing matches, nothing changes.
      expect(
        await rows(
          member.client.from("tasks").update({ title: "Hijacked" }).eq("id", f.tasks.assignedToManager).select("id"),
        ),
      ).toEqual([]);
      expect(await taskTitle(f.tasks.assignedToManager)).toBe(before);
    });

    it("cannot use an editable task to reassign it, approve it or move it to another project", async () => {
      const { member, manager } = f.users;
      const reassign = await failure(
        member.client.from("tasks").update({ assigned_to: manager.id }).eq("id", f.tasks.assignedToMember),
      );
      expect(reassign.message).toBe("TASK_ASSIGN_FORBIDDEN");

      const approve = await failure(
        member.client.from("tasks").update({ status: "completed" }).eq("id", f.tasks.assignedToMember),
      );
      expect(approve.message).toBe("TASK_STATUS_FORBIDDEN");

      const move = await failure(
        member.client.from("tasks").update({ project_id: f.projectB }).eq("id", f.tasks.ownedByMember),
      );
      expect(move.code).toBe("42501");

      const spoofCreator = await failure(
        member.client.from("tasks").insert({ project_id: f.projectA, title: "Spoofed", created_by: manager.id }),
      );
      expect(spoofCreator.code).toBe("42501");
    });

    it("cannot change permissions — neither their own nor anybody else's", async () => {
      const { member, reviewer } = f.users;
      for (const target of [member.id, reviewer.id]) {
        const error = await failure(
          member.client.rpc("set_member_permissions", {
            p_project_id: f.projectA,
            p_user_id: target,
            p_permissions: [...ROLE_TEMPLATES.owner],
          }),
        );
        expect(error.message).toBe("PERMISSION_DENIED");
        expect(userMessage(error)).toBe("ليس لديك صلاحية لتنفيذ هذه العملية.");
      }

      const direct = await failure(
        member.client
          .from("user_permissions")
          .insert({ project_id: f.projectA, user_id: member.id, permission_key: "tasks.delete" }),
      );
      expect(direct.code).toBe("42501");
      expect(await permissionsOf(member.id)).not.toContain("tasks.delete");
    });

    it("cannot promote themselves or become a platform administrator", async () => {
      const { member } = f.users;
      expect(
        (await failure(member.client.from("project_members").update({ role: "owner" }).eq("user_id", member.id))).code,
      ).toBe("42501");
      const rpc = await failure(
        member.client.rpc("update_project_member", {
          p_project_id: f.projectA,
          p_user_id: member.id,
          p_role: "manager",
        }),
      );
      expect(rpc.message).toBe("PERMISSION_DENIED");
      expect(
        (await failure(member.client.from("profiles").update({ is_platform_admin: true }).eq("id", member.id))).code,
      ).toBe("42501");
      await failure(member.client.rpc("bootstrap_platform_admin", { p_user_id: member.id }));
      expect((await failure(member.client.rpc("create_project", { p_name: "Not allowed" }))).message).toBe(
        "PROJECT_CREATE_FORBIDDEN",
      );
      const profile = must(
        "profile",
        await f.admin.from("profiles").select("is_platform_admin").eq("id", member.id).single(),
      );
      expect(profile.is_platform_admin).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("reviewer", () => {
    it("can approve work under review but cannot edit its content", async () => {
      const { reviewer } = f.users;
      const edit = await failure(
        reviewer.client.from("tasks").update({ title: "Rewritten" }).eq("id", f.tasks.inReview),
      );
      expect(edit.message).toBe("TASK_EDIT_FORBIDDEN");
      expect(userMessage(edit)).toBe("لا يمكنك تعديل هذه المهمة.");

      expect(
        await rows(
          reviewer.client.from("tasks").update({ status: "completed" }).eq("id", f.tasks.inReview).select("status"),
        ),
      ).toEqual([{ status: "completed" }]);
    });
  });

  // -------------------------------------------------------------------------
  describe("manager", () => {
    it("cannot manage permissions without permissions.manage, nor grant what they do not hold", async () => {
      const { owner, manager, member } = f.users;
      const denied = await failure(
        manager.client.rpc("set_member_permissions", {
          p_project_id: f.projectA,
          p_user_id: member.id,
          p_permissions: [...ROLE_TEMPLATES.member, "tasks.delete"],
        }),
      );
      expect(denied.message).toBe("PERMISSION_DENIED");

      must(
        "owner delegates permissions.manage",
        await owner.client.rpc("set_member_permissions", {
          p_project_id: f.projectA,
          p_user_id: manager.id,
          p_permissions: [...ROLE_TEMPLATES.manager, "permissions.manage"],
        }),
      );

      const escalation = await failure(
        manager.client.rpc("set_member_permissions", {
          p_project_id: f.projectA,
          p_user_id: member.id,
          p_permissions: [...ROLE_TEMPLATES.member, "project.delete"],
        }),
      );
      expect(escalation.message).toBe("PERMISSION_ESCALATION");

      const self = await failure(
        manager.client.rpc("set_member_permissions", {
          p_project_id: f.projectA,
          p_user_id: manager.id,
          p_permissions: [...ROLE_TEMPLATES.owner],
        }),
      );
      expect(self.message).toBe("CANNOT_MODIFY_SELF");

      const onOwner = await failure(
        manager.client.rpc("set_member_permissions", {
          p_project_id: f.projectA,
          p_user_id: owner.id,
          p_permissions: [],
        }),
      );
      expect(onOwner.message).toBe("CANNOT_MODIFY_OWNER");

      const addOwner = await failure(
        manager.client.rpc("add_project_member", {
          p_project_id: f.projectA,
          p_email: f.users.outsider.email,
          p_role: "owner",
        }),
      );
      expect(addOwner.message).toBe("ROLE_NOT_ALLOWED");

      // Allowed: a permission the manager holds, on a lower-ranked member.
      const ok = must(
        "manager grants tasks.delete",
        await manager.client.rpc("set_member_permissions", {
          p_project_id: f.projectA,
          p_user_id: member.id,
          p_permissions: [...ROLE_TEMPLATES.member, "tasks.delete"],
        }),
      );
      expect(ok).toContain("tasks.delete");
      must(
        "restore member",
        await owner.client.rpc("set_member_permissions", {
          p_project_id: f.projectA,
          p_user_id: member.id,
          p_permissions: [...ROLE_TEMPLATES.member],
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("project isolation", () => {
    it("a member of project A cannot read or write project B", async () => {
      const { member } = f.users;
      expect(await rows(member.client.from("projects").select("id").eq("id", f.projectB))).toEqual([]);
      expect(await rows(member.client.from("tasks").select("id").eq("project_id", f.projectB))).toEqual([]);
      expect(await rows(member.client.from("tasks").select("id").eq("id", f.tasks.inProjectB))).toEqual([]);
      expect(await rows(member.client.from("project_members").select("user_id").eq("project_id", f.projectB))).toEqual(
        [],
      );

      const insert = await failure(member.client.from("tasks").insert({ project_id: f.projectB, title: "Intrusion" }));
      expect(insert.code).toBe("42501");
      const team = await failure(member.client.rpc("get_project_team", { p_project_id: f.projectB }));
      expect(team.message).toBe("PERMISSION_DENIED");
      expect(
        await rows(member.client.from("tasks").update({ title: "x" }).eq("id", f.tasks.inProjectB).select("id")),
      ).toEqual([]);
    });

    it("an outsider cannot reach project A by guessing ids (IDOR)", async () => {
      const { outsider } = f.users;
      expect(await rows(outsider.client.from("projects").select("id").eq("id", f.projectA))).toEqual([]);
      expect(await rows(outsider.client.from("tasks").select("id").eq("id", f.tasks.assignedToMember))).toEqual([]);
      expect(await rows(outsider.client.from("comments").select("id").eq("project_id", f.projectA))).toEqual([]);
      expect(await rows(outsider.client.from("documents").select("id").eq("project_id", f.projectA))).toEqual([]);
      expect(await rows(outsider.client.from("activity_logs").select("id").eq("project_id", f.projectA))).toEqual([]);
      expect(
        await rows(outsider.client.from("tasks").delete().eq("id", f.tasks.assignedToMember).select("id")),
      ).toEqual([]);
      expect(await rows(outsider.client.from("projects").delete().eq("id", f.projectA).select("id"))).toEqual([]);

      const comment = await failure(
        outsider.client.from("comments").insert({ project_id: f.projectA, content: "spam" }),
      );
      expect(comment.code).toBe("42501");
      const access = must("access", await outsider.client.rpc("get_my_project_access", { p_project_id: f.projectA }));
      expect(access).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("storage", () => {
    const put = (client: Fixture["admin"], storagePath: string) =>
      client.storage
        .from(BUCKET)
        .upload(storagePath, new Blob(["field notes"], { type: "text/plain" }), { contentType: "text/plain" });
    const exists = async (storagePath: string) =>
      (await f.admin.storage.from(BUCKET).download(storagePath)).error === null;

    it("keeps files inside project folders and applies the document permissions", async () => {
      const { member, outsider } = f.users;
      const documentId = randomUUID();
      const storagePath = `${f.projectA}/${documentId}/notes.txt`;
      expect((await put(member.client, storagePath)).error).toBeNull();
      must(
        "register document",
        await member.client.from("documents").insert({
          id: documentId,
          project_id: f.projectA,
          title: "Field notes",
          file_name: "notes.txt",
          storage_path: storagePath,
          mime_type: "text/plain",
          size_bytes: 0,
        }),
      );

      expect((await put(outsider.client, `${f.projectA}/${randomUUID()}/evil.txt`)).error).not.toBeNull();
      expect((await outsider.client.storage.from(BUCKET).download(storagePath)).error).not.toBeNull();
      expect((await outsider.client.storage.from(BUCKET).createSignedUrl(storagePath, 60)).error).not.toBeNull();

      // The member has documents.upload but not documents.delete.
      expect((await member.client.storage.from(BUCKET).remove([storagePath])).data ?? []).toEqual([]);
      expect(await exists(storagePath)).toBe(true);

      // A document row in project B cannot point at project A's file.
      const hijack = await failure(
        outsider.client.from("documents").insert({
          project_id: f.projectB,
          title: "Hijack",
          file_name: "notes.txt",
          storage_path: storagePath,
          mime_type: "text/plain",
          size_bytes: 1,
        }),
      );
      expect(["23514", "23505", "42501", "22023"]).toContain(hijack.code);
    });

    it("lets only the uploader discard an upload that was never registered", async () => {
      const { member, manager } = f.users;
      const mine = `${f.projectA}/${randomUUID()}/draft.txt`;
      const theirs = `${f.projectA}/${randomUUID()}/managers-draft.txt`;
      expect((await put(member.client, mine)).error).toBeNull();
      expect((await put(manager.client, theirs)).error).toBeNull();

      expect((await member.client.storage.from(BUCKET).remove([theirs])).data ?? []).toEqual([]);
      expect(await exists(theirs)).toBe(true);

      expect((await member.client.storage.from(BUCKET).remove([mine])).data).toHaveLength(1);
      expect(await exists(mine)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("activity log", () => {
    it("is immutable for everybody and only fully visible with activity.view", async () => {
      const { owner, member } = f.users;
      expect((await failure(owner.client.from("activity_logs").delete().eq("project_id", f.projectA))).code).toBe(
        "42501",
      );
      expect(
        (
          await failure(
            owner.client.from("activity_logs").update({ action: "task.created" }).eq("project_id", f.projectA),
          )
        ).code,
      ).toBe("42501");
      expect(
        (
          await failure(
            owner.client
              .from("activity_logs")
              .insert({ project_id: f.projectA, action: "task.created", entity_type: "task" }),
          )
        ).code,
      ).toBe("42501");

      const ownerView = await rows(
        owner.client.from("activity_logs").select("actor_id, action").eq("project_id", f.projectA),
      );
      expect(ownerView.some((row) => row.actor_id !== owner.id)).toBe(true);
      expect(ownerView.map((row) => row.action)).toEqual(
        expect.arrayContaining(["permissions.changed", "task.deleted"]),
      );

      // Without activity.view a member only sees their own entries.
      const memberView = await rows(
        member.client.from("activity_logs").select("actor_id").eq("project_id", f.projectA),
      );
      expect(memberView.length).toBeGreaterThan(0);
      expect(memberView.every((row) => row.actor_id === member.id)).toBe(true);
    });

    it("records permission changes with old and new values", async () => {
      const entries = await rows(
        f.admin
          .from("activity_logs")
          .select("old_values, new_values, actor_id")
          .eq("project_id", f.projectA)
          .eq("action", "permissions.changed")
          .eq("entity_id", f.users.member.id),
      );
      expect(entries).toContainEqual({
        actor_id: f.users.owner.id,
        old_values: { "activity.view": false },
        new_values: { "activity.view": true },
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("unauthenticated and forged requests", () => {
    it("rejects requests without a session", async () => {
      const anon = anonymousClient(env!);
      expect((await failure(anon.from("tasks").select("id").limit(1))).code).toBe("42501");
      expect((await failure(anon.from("projects").select("id").limit(1))).code).toBe("42501");
      await failure(anon.rpc("create_project", { p_name: "anonymous" }));
      await failure(anon.rpc("get_project_team", { p_project_id: f.projectA }));
      const file = await anon.storage.from(BUCKET).list(f.projectA);
      expect(file.data ?? []).toEqual([]);
    });

    it("rejects forged and tampered access tokens", async () => {
      const header = base64url({ alg: "HS256", typ: "JWT" });
      const claims = base64url({
        sub: f.users.owner.id,
        role: "service_role",
        aud: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const forged = `${header}.${claims}.${createHmac("sha256", "not-the-project-secret").update(`${header}.${claims}`).digest("base64url")}`;

      // A real member token whose payload was edited to claim another identity.
      const session = must("session", await f.users.member.client.auth.getSession()).session!;
      const [realHeader, , realSignature] = session.access_token.split(".");
      const tampered = `${realHeader}.${claims}.${realSignature}`;

      for (const token of [forged, tampered]) {
        const response = await fetch(`${env!.url}/rest/v1/tasks?select=id&project_id=eq.${f.projectA}`, {
          headers: { apikey: env!.anonKey, Authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(401);
      }
    });
  });
});
