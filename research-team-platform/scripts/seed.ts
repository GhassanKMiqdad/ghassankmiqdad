/**
 * Demo data for NestHire Workspace.
 *
 *   npm run seed            # create demo users + demo projects (idempotent)
 *   npm run seed -- --reset # delete the demo projects first and recreate them
 *
 * 1. Creates (or updates) the demo users through the Supabase Auth admin API:
 *      Ghassan (Director), Research Manager, Research Member, Reviewer and the
 *      eight other members of the NestHire team.
 * 2. Bootstraps Ghassan as platform admin and Director.
 * 3. Performs every other step AS the respective user through the public API,
 *    exactly like the application does: Row Level Security, field-level
 *    triggers, workflow functions and the audit log all run for real.
 *
 * The NestHire tasks created here are DEMO data with demo dates. Real tasks
 * are entered by the Director / Team Lead in the application.
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
const NESTHIRE_TEAM = "NestHire Team";
const NESTHIRE_PROJECT = "NestHire — Month 1 (demo)";
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
  { key: "owner", email: `ghassan@${DOMAIN}`, fullName: "Ghassan Meqdad" },
  { key: "manager", email: `manager@${DOMAIN}`, fullName: "Research Manager" },
  { key: "member", email: `member@${DOMAIN}`, fullName: "Research Member" },
  { key: "reviewer", email: `reviewer@${DOMAIN}`, fullName: "Reviewer" },
];

/** The NestHire roster: Ghassan (Team Lead, also Director) and eight members. */
const NESTHIRE: { code: string; name: string; title: string; email: string; lead?: boolean }[] = [
  {
    code: "GH",
    name: "Ghassan Meqdad",
    title: "Founder / Team Lead / ML Engineer / AI Lead",
    email: `ghassan@${DOMAIN}`,
    lead: true,
  },
  { code: "AB", name: "Abdullah Fsfs", title: "AI Engineering", email: `abdullah@${DOMAIN}` },
  { code: "JA", name: "Janna", title: "UI/UX Designer", email: `janna@${DOMAIN}` },
  { code: "AM", name: "Ammar Ramadan", title: "Frontend Developer", email: `ammar@${DOMAIN}` },
  { code: "BR", name: "Baraa Al-Nabih", title: "Backend Developer", email: `baraa@${DOMAIN}` },
  { code: "AS", name: "Ashraf Al-Kahlout", title: "ML Engineer", email: `ashraf@${DOMAIN}` },
  { code: "BA", name: "Bashar Badawi", title: "ML Engineer", email: `bashar@${DOMAIN}` },
  { code: "IS", name: "Israa Hamad", title: "AI Integration", email: `israa@${DOMAIN}` },
  { code: "AH", name: "Ahmed Al-Gharabli", title: "Mobile Developer", email: `ahmed@${DOMAIN}` },
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

/** An instant `days` from today at `hour`:00 UTC (demo schedules). */
function at(days: number, hour = 7): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
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

async function deleteProjects(owner: Client, ownerId: string, name: string): Promise<boolean> {
  const existing = check(
    "find project",
    await owner.from("projects").select("id").eq("name", name).eq("created_by", ownerId),
  );
  if (existing.length === 0) return false;
  if (!RESET) return true;
  for (const project of existing) {
    const { data: folders } = await admin.storage.from(BUCKET).list(project.id);
    for (const folder of folders ?? []) {
      const { data: files } = await admin.storage.from(BUCKET).list(`${project.id}/${folder.name}`);
      const paths = (files ?? []).map((file) => `${project.id}/${folder.name}/${file.name}`);
      if (paths.length > 0) await admin.storage.from(BUCKET).remove(paths);
    }
    check("delete project", await owner.from("projects").delete().eq("id", project.id));
  }
  console.log(`  ✓ previous "${name}" deleted`);
  return false;
}

async function main() {
  console.log(`Seeding ${SUPABASE_URL}`);

  const ids = {} as Record<Role, string>;
  for (const user of USERS) {
    ids[user.key] = await ensureUser(user.email, user.fullName);
    console.log(`  ✓ user ${user.fullName} <${user.email}>`);
  }
  for (const person of NESTHIRE.filter((item) => !item.lead)) {
    await ensureUser(person.email, person.name);
  }
  console.log(`  ✓ ${NESTHIRE.length - 1} NestHire members`);

  check("bootstrap platform admin", await admin.rpc("bootstrap_platform_admin", { p_user_id: ids.owner }));
  console.log("  ✓ Ghassan is platform admin and Director");

  const owner = await signIn(USERS[0]!.email);
  await seedResearchDemo(owner, ids);
  await seedNestHire(owner);
  printSummary();
}

async function seedResearchDemo(owner: Client, ids: Record<Role, string>) {
  if (await deleteProjects(owner, ids.owner, DEMO_PROJECT)) {
    console.log(`  • "${DEMO_PROJECT}" already exists — run with --reset to recreate it.`);
    return;
  }
  const manager = await signIn(USERS[1]!.email);
  const member = await signIn(USERS[2]!.email);
  const reviewer = await signIn(USERS[3]!.email);

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

  // --- Tasks planned by the owner (demo dates) --------------------------------
  const tasks = [
    {
      key: "literature",
      title: "Literature Review",
      priority: "p1",
      assigned_to: ids.member,
      start: -6,
      days: 10,
      week: 1,
    },
    {
      key: "proposal",
      title: "Research Proposal Draft",
      priority: "p1",
      assigned_to: ids.manager,
      start: -20,
      days: 7,
      week: 1,
    },
    {
      key: "dataPlan",
      title: "Data Collection Plan",
      priority: "p2",
      assigned_to: ids.member,
      start: 7,
      days: 5,
      week: 2,
    },
    {
      key: "survey",
      title: "Survey Instrument Design",
      priority: "p0",
      assigned_to: ids.manager,
      start: -2,
      days: 11,
      week: 1,
    },
    {
      key: "ethics",
      title: "Ethics Approval Submission",
      priority: "p1",
      assigned_to: null,
      start: -9,
      days: 7,
      week: 1,
    },
    {
      key: "stats",
      title: "Statistical Analysis Plan",
      priority: "p2",
      assigned_to: ids.member,
      start: -12,
      days: 8,
      week: 1,
    },
    {
      key: "report",
      title: "Final Report Outline",
      priority: "p3",
      assigned_to: null,
      start: null,
      days: null,
      week: null,
    },
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
          expected_output: "A document shared with the team.",
          priority: task.priority,
          assigned_to: task.assigned_to,
          planning_week: task.week,
          planned_start_at: task.start === null ? null : at(task.start),
          planned_duration: task.days,
          duration_unit: task.days === null ? null : "days",
        })
        .select("id")
        .single(),
    );
    taskIds[task.key] = row.id;
  }
  console.log(`  ✓ ${tasks.length} tasks`);

  // --- Day-to-day work, each step performed by the right person -------------
  const start = async (client: Client, key: keyof typeof taskIds) =>
    check(`start ${key}`, await client.from("tasks").update({ status: "in_progress" }).eq("id", taskIds[key]));
  const submit = async (client: Client, key: keyof typeof taskIds, summary: string) =>
    check(
      `submit ${key}`,
      await client.rpc("submit_task", {
        p_task_id: taskIds[key],
        p_summary: summary,
        p_deliverable_links: [],
        p_notes: "",
      }),
    );

  await start(member, "literature");
  await submit(member, "literature", "42 papers screened, 17 included. Notes uploaded to Documents.");
  check(
    "member comments",
    await member.from("comments").insert({
      project_id: projectId,
      task_id: taskIds.literature,
      content: "First pass done: 42 papers screened, 17 included. Ready for review.",
    }),
  );

  await start(manager, "proposal");
  await submit(manager, "proposal", "Proposal draft v1 with aims, design and timeline.");
  check(
    "reviewer starts the proposal review",
    await reviewer.rpc("start_task_review", { p_task_id: taskIds.proposal }),
  );
  check(
    "reviewer approves proposal",
    await reviewer.rpc("review_task", {
      p_task_id: taskIds.proposal,
      p_decision: "approved",
      p_comment: "Clear and complete.",
    }),
  );
  check(
    "owner publishes proposal",
    await owner.rpc("complete_task", {
      p_task_id: taskIds.proposal,
      p_team_comment: "Approved proposal — the reference for the study.",
    }),
  );

  await start(member, "stats");
  await submit(member, "stats", "Analysis plan: primary endpoint, power calculation, sensitivity analyses.");
  check(
    "reviewer starts the analysis plan review",
    await reviewer.rpc("start_task_review", { p_task_id: taskIds.stats }),
  );
  check(
    "reviewer approves the analysis plan",
    await reviewer.rpc("review_task", {
      p_task_id: taskIds.stats,
      p_decision: "approved",
      p_comment: "Approved. Please add the sensitivity analysis to the appendix.",
    }),
  );

  await start(manager, "survey");
  check(
    "manager takes the ethics submission",
    await manager.from("tasks").update({ assigned_to: ids.manager }).eq("id", taskIds.ethics),
  );
  check(
    "manager creates a task",
    await manager.from("tasks").insert({
      project_id: projectId,
      title: "Interview Transcription",
      description: "Transcribe and anonymise the 12 clinician interviews.",
      priority: "p2",
      assigned_to: ids.member,
      planning_week: 2,
      planned_start_at: at(3),
      planned_duration: 2,
      duration_unit: "weeks",
    }),
  );
  check(
    "owner project comment",
    await owner.from("comments").insert({
      project_id: projectId,
      content: "Welcome to the team! Weekly sync every Monday at 10:00. Please keep task statuses up to date.",
    }),
  );
  console.log("  ✓ workflow: starts, submissions, reviews, a published result, comments");

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
}

/** NestHire: team roster, linked project and a demo month of scheduled work. */
async function seedNestHire(director: Client) {
  const directorId = check("director id", await director.auth.getUser()).user!.id;
  if (await deleteProjects(director, directorId, NESTHIRE_PROJECT)) {
    console.log(`  • "${NESTHIRE_PROJECT}" already exists — run with --reset to recreate it.`);
    return;
  }

  // Team + roster (accounts with these confirmed e-mails are linked automatically).
  const existingTeam = check(
    "find team",
    await director.from("teams").select("id").eq("name", NESTHIRE_TEAM).maybeSingle(),
  );
  const teamId =
    existingTeam?.id ??
    check(
      "create team",
      await director.rpc("create_team", { p_name: NESTHIRE_TEAM, p_description: "NestHire product team" }),
    );
  const roster = check("roster", await director.from("team_members").select("id, member_code").eq("team_id", teamId));
  for (const person of NESTHIRE) {
    const current = roster.find((row) => row.member_code === person.code);
    check(
      `roster ${person.code}`,
      await director.rpc("upsert_team_member", {
        p_team_id: teamId,
        p_member_id: (current?.id ?? null) as string,
        p_display_name: person.name,
        p_member_code: person.code,
        p_job_title: person.title,
        p_role: person.lead ? "team_lead" : "team_member",
        p_invite_email: person.email,
      }),
    );
  }
  console.log(`  ✓ team "${NESTHIRE_TEAM}" with ${NESTHIRE.length} members`);

  const projectId = check(
    "create NestHire project",
    await director.rpc("create_project", {
      p_name: NESTHIRE_PROJECT,
      p_description: "Demo month of NestHire work: scheduled tasks, submissions, reviews and published results.",
      p_research_goal: "Ship the first NestHire matching prototype.",
      p_status: "active",
      p_start_date: daysFromToday(-7),
      p_deadline: daysFromToday(23),
    }),
  );
  check("link project to team", await director.rpc("set_project_team", { p_project_id: projectId, p_team_id: teamId }));
  console.log(`  ✓ project "${NESTHIRE_PROJECT}" linked to the team`);

  const userIds = new Map<string, string>();
  for (const person of NESTHIRE) userIds.set(person.code, (await findUserIdByEmail(person.email))!);

  const plan = [
    {
      code: "GH",
      title: "Define the matching architecture",
      week: 1,
      start: -6,
      duration: 3,
      unit: "days",
      priority: "p0",
    },
    {
      code: "AB",
      title: "Build the candidate embedding pipeline",
      week: 1,
      start: -5,
      duration: 4,
      unit: "days",
      priority: "p0",
    },
    { code: "JA", title: "Design the onboarding flow", week: 1, start: -3, duration: 1, unit: "weeks", priority: "p1" },
    {
      code: "AM",
      title: "Implement the job listing screen",
      week: 1,
      start: -4,
      duration: 2,
      unit: "days",
      priority: "p1",
    },
    { code: "BR", title: "Set up the matching API", week: 2, start: 1, duration: 5, unit: "days", priority: "p1" },
    {
      code: "AS",
      title: "Train the baseline ranking model",
      week: 2,
      start: 0,
      duration: 20,
      unit: "hours",
      priority: "p0",
    },
    { code: "BA", title: "Evaluate ranking metrics", week: 2, start: 3, duration: 3, unit: "days", priority: "p2" },
    {
      code: "IS",
      title: "Integrate the LLM screening assistant",
      week: 2,
      start: 2,
      duration: 1,
      unit: "weeks",
      priority: "p1",
    },
    { code: "AH", title: "Mobile app skeleton", week: 3, start: null, duration: null, unit: null, priority: "p2" },
  ] as const;

  const created = new Map<string, string>();
  for (const item of plan) {
    const row = check(
      `task ${item.code}`,
      await director
        .from("tasks")
        .insert({
          project_id: projectId,
          title: item.title,
          original_instructions: `${item.title}. Demo task — replace with the real plan.`,
          expected_output: "Working result with a short write-up and links.",
          completion_criteria: "Reviewed and approved by the Team Lead.",
          priority: item.priority,
          assigned_to: userIds.get(item.code)!,
          planning_month: 1,
          planning_week: item.week,
          planned_start_at: item.start === null ? null : at(item.start),
          planned_duration: item.duration,
          duration_unit: item.unit,
        })
        .select("id, task_code")
        .single(),
    );
    created.set(item.code, row.id);
  }
  console.log(`  ✓ ${plan.length} demo tasks (IDs generated, e.g. M01-AB-01-01)`);

  // The embedding pipeline depends on the architecture.
  check(
    "dependency",
    await director
      .from("task_dependencies")
      .insert({ task_id: created.get("BR")!, depends_on_task_id: created.get("AB")!, project_id: projectId }),
  );

  // Abdullah: start → submit → revision → resubmit → approve → MARK AS COMPLETED.
  const ab = await signIn(NESTHIRE.find((person) => person.code === "AB")!.email);
  const abTask = created.get("AB")!;
  check("AB starts", await ab.from("tasks").update({ status: "in_progress" }).eq("id", abTask));
  check(
    "AB progress",
    await ab
      .from("tasks")
      .update({ progress: 70, work_notes: "Pipeline runs end-to-end; tuning batch size." })
      .eq("id", abTask),
  );
  check(
    "AB submits v1",
    await ab.rpc("submit_task", {
      p_task_id: abTask,
      p_summary: "Pipeline v1: 1.2k candidates embedded in 40 s.",
      p_deliverable_links: ["https://github.com/example/nesthire/pull/1"],
      p_notes: "",
    }),
  );
  check("GH reviews", await director.rpc("start_task_review", { p_task_id: abTask }));
  check(
    "GH requests revision",
    await director.rpc("review_task", {
      p_task_id: abTask,
      p_decision: "revision_required",
      p_comment: "Good start.",
      p_required_changes: "Add caching and a benchmark table.",
      p_additional_instructions: "Keep the model version pinned.",
    }),
  );
  check(
    "AB resubmits",
    await ab.rpc("submit_task", {
      p_task_id: abTask,
      p_summary: "Pipeline v2 with caching: 1.2k candidates in 9 s. Benchmark attached.",
      p_deliverable_links: ["https://github.com/example/nesthire/pull/2"],
      p_notes: "Benchmarks in the PR description.",
    }),
  );
  check("GH reviews v2", await director.rpc("start_task_review", { p_task_id: abTask }));
  check(
    "GH approves",
    await director.rpc("review_task", { p_task_id: abTask, p_decision: "approved", p_comment: "Meets the criteria." }),
  );
  check(
    "GH publishes",
    await director.rpc("complete_task", {
      p_task_id: abTask,
      p_team_comment: "Use this pipeline for all matching experiments.",
    }),
  );

  // Janna and Ammar are working; Ammar's deadline has passed (overdue example).
  const ja = await signIn(NESTHIRE.find((person) => person.code === "JA")!.email);
  check("JA starts", await ja.from("tasks").update({ status: "in_progress" }).eq("id", created.get("JA")!));
  const am = await signIn(NESTHIRE.find((person) => person.code === "AM")!.email);
  check(
    "AM starts",
    await am.from("tasks").update({ status: "in_progress", progress: 40 }).eq("id", created.get("AM")!),
  );
  console.log("  ✓ demo workflow: revision loop, approval, publication, overdue and unscheduled examples");
}

function printSummary() {
  console.log("\nDemo accounts (password for all):", PASSWORD);
  for (const user of USERS) {
    console.log(`  ${user.fullName.padEnd(17)} ${user.email}`);
  }
  for (const person of NESTHIRE.filter((item) => !item.lead)) {
    console.log(`  ${`${person.code} ${person.name}`.padEnd(17)} ${person.email}`);
  }
  if (!process.env.SEED_USER_PASSWORD) {
    console.log("\nSet SEED_USER_PASSWORD to choose the password instead of a random one.");
  }
}

main().catch((error: unknown) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
