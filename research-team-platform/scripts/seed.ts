/**
 * Demo data for the Research Team Platform.
 *
 *   npm run seed            # create demo users + demo project (idempotent)
 *   npm run seed -- --reset # delete the demo project first and recreate it
 *
 * 1. Creates (or updates) four users through the Supabase Auth admin API:
 *      Ghassan (Owner), Research Manager, Research Member, Reviewer.
 * 2. Promotes Ghassan to platform admin (may create projects).
 * 3. Performs every other step AS the respective user through the public API,
 *    exactly like the application does: Row Level Security, field-level
 *    triggers and the audit log all run for real, so the activity log of the
 *    demo project is authentic.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY (read from the environment or .env.local).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database.types";

type Client = SupabaseClient<Database>;
type Role = "owner" | "manager" | "member" | "reviewer";

const DEMO_PROJECT = "AI-Assisted Early Diagnosis Study";
const BUCKET = "project-documents";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}. Set it in .env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
const DOMAIN = process.env.SEED_EMAIL_DOMAIN?.trim() || "example.com";
const PASSWORD = process.env.SEED_USER_PASSWORD?.trim() || `Rt-${randomBytes(9).toString("base64url")}9a`;
const RESET = process.argv.includes("--reset");

const USERS: { key: Role; email: string; fullName: string }[] = [
  { key: "owner", email: `ghassan@${DOMAIN}`, fullName: "Ghassan" },
  { key: "manager", email: `manager@${DOMAIN}`, fullName: "Research Manager" },
  { key: "member", email: `member@${DOMAIN}`, fullName: "Research Member" },
  { key: "reviewer", email: `reviewer@${DOMAIN}`, fullName: "Reviewer" },
];

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;
const admin: Client = createClient<Database>(SUPABASE_URL, SERVICE_KEY, options);

/** Throws with a readable label when a Supabase call fails; returns its data. */
function check<R extends { data: unknown; error: { message: string } | null }>(
  label: string,
  response: R,
): NonNullable<R["data"]> {
  if (response.error) {
    throw new Error(`${label}: ${response.error.message}`);
  }
  return response.data as NonNullable<R["data"]>;
}

function daysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureUser(email: string, fullName: string): Promise<string> {
  const existing = await findUserIdByEmail(email);
  if (existing) {
    check(
      `update ${email}`,
      await admin.auth.admin.updateUserById(existing, {
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      }),
    );
    return existing;
  }
  const created = check(
    `create ${email}`,
    await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    }),
  );
  if (!created.user) throw new Error(`create ${email}: no user returned`);
  return created.user.id;
}

async function signIn(email: string): Promise<Client> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, options);
  check(`sign in ${email}`, await client.auth.signInWithPassword({ email, password: PASSWORD }));
  return client;
}

async function uploadDocument(
  client: Client,
  projectId: string,
  input: { fileName: string; mimeType: string; content: string; title: string; description: string },
) {
  const documentId = randomUUID();
  const storagePath = `${projectId}/${documentId}/${input.fileName}`;
  const body = new Blob([input.content], { type: input.mimeType });
  check(
    `upload ${input.fileName}`,
    await client.storage.from(BUCKET).upload(storagePath, body, { contentType: input.mimeType, upsert: false }),
  );
  check(
    `register ${input.fileName}`,
    await client.from("documents").insert({
      id: documentId,
      project_id: projectId,
      title: input.title,
      description: input.description,
      file_name: input.fileName,
      storage_path: storagePath,
      mime_type: input.mimeType,
      size_bytes: 0,
    }),
  );
}

async function main() {
  console.log(`Seeding ${SUPABASE_URL}`);

  const ids = {} as Record<Role, string>;
  for (const user of USERS) {
    ids[user.key] = await ensureUser(user.email, user.fullName);
    console.log(`  ✓ user ${user.fullName} <${user.email}>`);
  }

  check("bootstrap platform admin", await admin.rpc("bootstrap_platform_admin", { p_user_id: ids.owner }));
  console.log("  ✓ Ghassan is platform admin");

  const owner = await signIn(USERS[0]!.email);
  const manager = await signIn(USERS[1]!.email);
  const member = await signIn(USERS[2]!.email);
  const reviewer = await signIn(USERS[3]!.email);

  const existing = check(
    "find demo project",
    await owner.from("projects").select("id").eq("name", DEMO_PROJECT).eq("created_by", ids.owner),
  );
  if (existing.length > 0) {
    if (!RESET) {
      console.log(`  • "${DEMO_PROJECT}" already exists — run with --reset to recreate it.`);
      printSummary();
      return;
    }
    for (const project of existing) {
      const { data: folders } = await admin.storage.from(BUCKET).list(project.id);
      for (const folder of folders ?? []) {
        const { data: files } = await admin.storage.from(BUCKET).list(`${project.id}/${folder.name}`);
        const paths = (files ?? []).map((file) => `${project.id}/${folder.name}/${file.name}`);
        if (paths.length > 0) await admin.storage.from(BUCKET).remove(paths);
      }
      check("delete demo project", await owner.from("projects").delete().eq("id", project.id));
    }
    console.log("  ✓ previous demo project deleted");
  }

  // --- Owner creates the project and builds the team -------------------------
  const projectId = check(
    "create project",
    await owner.rpc("create_project", {
      p_name: DEMO_PROJECT,
      p_description:
        "Multi-centre study evaluating machine-learning models for the early detection of chronic kidney disease from routine blood tests.",
      p_research_goal:
        "Validate a model reaching ≥ 85% sensitivity on retrospective data and prepare a manuscript for peer review.",
      p_status: "active",
      p_start_date: daysFromToday(-30),
      p_deadline: daysFromToday(120),
    }),
  );
  console.log(`  ✓ project "${DEMO_PROJECT}"`);

  for (const [key, role] of [
    ["manager", "manager"],
    ["member", "member"],
    ["reviewer", "reviewer"],
  ] as const) {
    const email = USERS.find((user) => user.key === key)!.email;
    check(
      `add ${key}`,
      await owner.rpc("add_project_member", { p_project_id: projectId, p_email: email, p_role: role }),
    );
  }
  console.log("  ✓ team: manager, member, reviewer");

  // The owner lets the manager read the audit log (recorded as a permission change).
  const managerPermissions = check(
    "manager permissions",
    await owner
      .from("user_permissions")
      .select("permission_key")
      .eq("project_id", projectId)
      .eq("user_id", ids.manager),
  ).map((row) => row.permission_key);
  check(
    "grant activity.view",
    await owner.rpc("set_member_permissions", {
      p_project_id: projectId,
      p_user_id: ids.manager,
      p_permissions: [...managerPermissions, "activity.view"],
    }),
  );

  // --- Tasks created by the owner -------------------------------------------
  const tasks = [
    {
      key: "literature",
      title: "Literature Review",
      status: "in_progress",
      priority: "high",
      assigned_to: ids.member,
      due: 5,
    },
    {
      key: "proposal",
      title: "Research Proposal Draft",
      status: "completed",
      priority: "high",
      assigned_to: ids.manager,
      due: -10,
    },
    {
      key: "dataPlan",
      title: "Data Collection Plan",
      status: "todo",
      priority: "medium",
      assigned_to: ids.member,
      due: 14,
    },
    {
      key: "survey",
      title: "Survey Instrument Design",
      status: "in_progress",
      priority: "critical",
      assigned_to: ids.manager,
      due: 9,
    },
    {
      key: "ethics",
      title: "Ethics Approval Submission",
      status: "todo",
      priority: "high",
      assigned_to: null,
      due: -2,
    },
    {
      key: "stats",
      title: "Statistical Analysis Plan",
      status: "review",
      priority: "medium",
      assigned_to: ids.member,
      due: 20,
    },
    { key: "report", title: "Final Report Outline", status: "todo", priority: "low", assigned_to: null, due: 90 },
  ] as const;

  const taskIds = {} as Record<(typeof tasks)[number]["key"], string>;
  for (const task of tasks) {
    const row = check(
      `task ${task.title}`,
      await owner
        .from("tasks")
        .insert({
          project_id: projectId,
          title: task.title,
          description: `${task.title} for the ${DEMO_PROJECT}.`,
          status: task.status,
          priority: task.priority,
          assigned_to: task.assigned_to,
          due_date: daysFromToday(task.due),
        })
        .select("id")
        .single(),
    );
    taskIds[task.key] = row.id;
  }
  console.log(`  ✓ ${tasks.length} tasks`);

  // --- Day-to-day work, each step performed by the right person -------------
  check(
    "member moves literature review to review",
    await member.from("tasks").update({ status: "review" }).eq("id", taskIds.literature),
  );
  check(
    "member comments",
    await member.from("comments").insert({
      project_id: projectId,
      task_id: taskIds.literature,
      content: "First pass done: 42 papers screened, 17 included. Ready for review.",
    }),
  );
  check(
    "reviewer approves the analysis plan",
    await reviewer.from("tasks").update({ status: "completed" }).eq("id", taskIds.stats),
  );
  check(
    "reviewer comments",
    await reviewer.from("comments").insert({
      project_id: projectId,
      task_id: taskIds.stats,
      content: "Approved. Please add the sensitivity analysis to the appendix.",
    }),
  );
  check(
    "manager takes the ethics submission",
    await manager.from("tasks").update({ assigned_to: ids.manager, status: "in_progress" }).eq("id", taskIds.ethics),
  );
  check(
    "manager creates a task",
    await manager.from("tasks").insert({
      project_id: projectId,
      title: "Interview Transcription",
      description: "Transcribe and anonymise the 12 clinician interviews.",
      status: "todo",
      priority: "medium",
      assigned_to: ids.member,
      due_date: daysFromToday(25),
    }),
  );
  check(
    "member creates an own task",
    await member.from("tasks").insert({
      project_id: projectId,
      title: "Draft Methodology Notes",
      description: "Personal notes for the methodology chapter.",
      status: "todo",
      priority: "low",
      assigned_to: ids.member,
      due_date: daysFromToday(30),
    }),
  );
  check(
    "owner project comment",
    await owner.from("comments").insert({
      project_id: projectId,
      content: "Welcome to the team! Weekly sync every Monday at 10:00. Please keep task statuses up to date.",
    }),
  );
  console.log("  ✓ status changes, assignments, follow-up tasks and comments");

  await uploadDocument(member, projectId, {
    fileName: "literature-notes.md",
    mimeType: "text/markdown",
    title: "Literature review notes",
    description: "Screening notes and inclusion criteria.",
    content: "# Literature review\n\n- 42 papers screened\n- 17 included\n- Main gap: external validation\n",
  });
  await uploadDocument(manager, projectId, {
    fileName: "survey-results.csv",
    mimeType: "text/csv",
    title: "Pilot survey results",
    description: "Anonymised answers of the pilot survey (n = 24).",
    content:
      "respondent,role,years_experience,uses_decision_support\nR01,nephrologist,12,yes\nR02,gp,4,no\nR03,gp,9,yes\n",
  });
  console.log("  ✓ documents uploaded");

  printSummary();
}

function printSummary() {
  console.log("\nDemo accounts (password for all):", PASSWORD);
  for (const user of USERS) {
    console.log(`  ${user.fullName.padEnd(17)} ${user.email}`);
  }
  if (!process.env.SEED_USER_PASSWORD) {
    console.log("\nSet SEED_USER_PASSWORD to choose the password instead of a random one.");
  }
}

main().catch((error: unknown) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
