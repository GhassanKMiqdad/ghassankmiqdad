/**
 * Isolated fixture for the API security suite.
 *
 * Every run creates its own users and projects (random e-mail suffix) through
 * the same public API the application uses, and removes them afterwards, so
 * the suite never depends on — or modifies — the demo data.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type Client = SupabaseClient<Database>;
export type Role = "owner" | "manager" | "member" | "reviewer" | "outsider";
export type FixtureUser = { id: string; email: string; client: Client };

export const BUCKET = "project-documents";
const ROLES: Role[] = ["owner", "manager", "member", "reviewer", "outsider"];
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "host.docker.internal", "kong"]);

export type IntegrationEnv = { url: string; anonKey: string; serviceKey: string };

/**
 * Reads the Supabase connection from the environment (or .env.local). Returns
 * null when the suite cannot run. Refuses remote projects unless explicitly
 * allowed: the suite creates and deletes users.
 */
export function readIntegrationEnv(): { env: IntegrationEnv | null; reason: string } {
  const root = path.resolve(import.meta.dirname, "../..");
  for (const file of [".env.local", ".env"]) {
    const full = path.join(root, file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceKey) {
    return {
      env: null,
      reason: "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required",
    };
  }
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host) && process.env.INTEGRATION_ALLOW_REMOTE !== "1") {
    return {
      env: null,
      reason: `refusing to run against ${host}; set INTEGRATION_ALLOW_REMOTE=1 for a disposable project`,
    };
  }
  return { env: { url, anonKey, serviceKey }, reason: "" };
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

export function anonymousClient(env: IntegrationEnv): Client {
  return createClient<Database>(env.url, env.anonKey, clientOptions);
}

/** Unwraps a Supabase response or throws with a readable label. */
export function must<R extends { data: unknown; error: { message: string } | null }>(
  label: string,
  response: R,
): NonNullable<R["data"]> {
  if (response.error) throw new Error(`${label}: ${response.error.message}`);
  return response.data as NonNullable<R["data"]>;
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

export async function createFixture(env: IntegrationEnv) {
  const admin = createClient<Database>(env.url, env.serviceKey, clientOptions);
  const run = randomBytes(4).toString("hex");
  const password = `It-${randomBytes(12).toString("base64url")}9a`;
  const users = {} as Record<Role, FixtureUser>;

  for (const role of ROLES) {
    const email = `it-${run}-${role}@example.com`;
    const created = must(
      `create ${role}`,
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: `Integration ${role}` },
      }),
    );
    if (!created.user) throw new Error(`create ${role}: no user returned`);
    const client = anonymousClient(env);
    must(`sign in ${role}`, await client.auth.signInWithPassword({ email, password }));
    users[role] = { id: created.user.id, email, client };
  }

  // The owner may create projects (platform flag), exactly like the seed.
  must("bootstrap owner", await admin.rpc("bootstrap_platform_admin", { p_user_id: users.owner.id }));
  const owner = users.owner.client;
  const projectA = must("project A", await owner.rpc("create_project", { p_name: `Integration ${run} A` }));
  const projectB = must("project B", await owner.rpc("create_project", { p_name: `Integration ${run} B` }));

  for (const [role, project, projectRole] of [
    ["manager", projectA, "manager"],
    ["member", projectA, "member"],
    ["reviewer", projectA, "reviewer"],
    ["outsider", projectB, "member"],
  ] as const) {
    must(
      `add ${role}`,
      await owner.rpc("add_project_member", { p_project_id: project, p_email: users[role].email, p_role: projectRole }),
    );
  }

  const createTask = async (
    client: Client,
    label: string,
    values: Partial<Database["public"]["Tables"]["tasks"]["Insert"]> = {},
  ) =>
    must(
      `task ${label}`,
      await client
        .from("tasks")
        .insert({ project_id: projectA, title: label, ...values })
        .select("id")
        .single(),
    ).id;

  const tasks = {
    assignedToMember: await createTask(owner, "Assigned to member", { assigned_to: users.member.id }),
    assignedToManager: await createTask(owner, "Assigned to manager", { assigned_to: users.manager.id }),
    unassigned: await createTask(owner, "Unassigned"),
    inReview: await createTask(owner, "Waiting for review", { assigned_to: users.member.id, status: "review" }),
    ownedByMember: await createTask(users.member.client, "Created by member"),
    inProjectB: must(
      "task in B",
      await owner.from("tasks").insert({ project_id: projectB, title: "Project B task" }).select("id").single(),
    ).id,
  };

  async function storagePaths(prefix: string): Promise<string[]> {
    const { data } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
    const paths: string[] = [];
    for (const entry of data ?? []) {
      const full = `${prefix}/${entry.name}`;
      if (entry.id) paths.push(full);
      else paths.push(...(await storagePaths(full)));
    }
    return paths;
  }

  async function cleanup() {
    for (const project of [projectA, projectB]) {
      const paths = await storagePaths(project);
      if (paths.length > 0) await admin.storage.from(BUCKET).remove(paths);
      await owner.from("projects").delete().eq("id", project);
    }
    for (const user of Object.values(users)) {
      await user.client.auth.signOut().catch(() => undefined);
      await admin.auth.admin.deleteUser(user.id);
    }
  }

  return { admin, run, users, projectA, projectB, tasks, cleanup };
}
