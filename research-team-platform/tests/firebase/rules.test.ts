import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const projectId = "demo-research-platform";
const project = "project-1";
let env: RulesTestEnvironment;

const memberPermissions = [
  "project.view",
  "tasks.update_progress",
  "tasks.add_work_notes",
  "tasks.submit",
  "documents.upload",
];
const ownerPermissions = [
  "project.view",
  "project.edit",
  "project.delete",
  "tasks.view",
  "tasks.create",
  "tasks.edit",
  "tasks.assign",
  "tasks.review",
  "tasks.delete",
  "documents.view",
  "documents.upload",
  "documents.edit",
  "documents.delete",
  "team.view",
  "members.add",
  "members.remove",
  "members.manage",
  "permissions.manage",
  "activity.view",
  "data.export",
];

async function seed() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `projects/${project}`), { id: project, name: "Study", created_by: "director" });
    await setDoc(doc(db, "projects/project-2"), { id: "project-2", name: "Private study", created_by: "researcher-b" });
    await setDoc(doc(db, "profiles/platform-director"), {
      id: "platform-director",
      is_platform_admin: true,
      full_name: "Platform Director",
    });
    await setDoc(doc(db, `project_members/${project}_researcher-a`), {
      id: `${project}_researcher-a`,
      project_id: project,
      user_id: "researcher-a",
      role: "member",
      status: "active",
      permissions: memberPermissions,
    });
    await setDoc(doc(db, `project_members/${project}_researcher-b`), {
      id: `${project}_researcher-b`,
      project_id: project,
      user_id: "researcher-b",
      role: "member",
      status: "active",
      permissions: memberPermissions,
    });
    await setDoc(doc(db, `project_members/${project}_researcher-c`), {
      id: `${project}_researcher-c`,
      project_id: project,
      user_id: "researcher-c",
      role: "member",
      status: "active",
      permissions: [...memberPermissions, "tasks.assign"],
    });
    await setDoc(doc(db, `project_members/${project}_director`), {
      id: `${project}_director`,
      project_id: project,
      user_id: "director",
      role: "owner",
      status: "active",
      permissions: ownerPermissions,
    });
    await setDoc(doc(db, `project_members/${project}_reviewer`), {
      id: `${project}_reviewer`,
      project_id: project,
      user_id: "reviewer",
      role: "reviewer",
      status: "active",
      permissions: ["project.view", "tasks.review"],
    });
    await setDoc(doc(db, `project_members/${project}_team-observer`), {
      id: `${project}_team-observer`,
      project_id: project,
      user_id: "team-observer",
      role: "member",
      status: "active",
      permissions: ["project.view", "tasks.view"],
    });
    await setDoc(doc(db, `project_members/${project}_team-outsider`), {
      id: `${project}_team-outsider`,
      project_id: project,
      user_id: "team-outsider",
      role: "member",
      status: "active",
      permissions: ["project.view", "tasks.view"],
    });
    await setDoc(doc(db, "teams/team-alpha"), {
      id: "team-alpha",
      project_id: project,
      name: "Alpha research team",
      status: "active",
    });
    await setDoc(doc(db, "team_members/team-alpha_team-observer"), {
      id: "team-alpha_team-observer",
      project_id: project,
      team_id: "team-alpha",
      user_id: "team-observer",
      status: "active",
    });
    await setDoc(doc(db, "team_members/team-alpha_researcher-b"), {
      id: "team-alpha_researcher-b",
      project_id: project,
      team_id: "team-alpha",
      user_id: "researcher-b",
      status: "active",
    });
    await setDoc(doc(db, "milestones/team-alpha-milestone"), {
      id: "team-alpha-milestone",
      project_id: project,
      responsible_team_id: "team-alpha",
      responsible_researcher_id: null,
      status: "pending",
    });
    await setDoc(doc(db, "milestones/researcher-b-milestone"), {
      id: "researcher-b-milestone",
      project_id: project,
      responsible_team_id: null,
      responsible_researcher_id: "researcher-b",
      status: "pending",
    });
    await setDoc(doc(db, "tasks/reviewer-own-review"), {
      id: "reviewer-own-review",
      project_id: project,
      title: "Reviewer assignment",
      description: "Self-review must be blocked",
      expected_output: "",
      required_deliverables: "",
      priority: "medium",
      status: "review",
      created_by: "director",
      assigned_to: "reviewer",
      progress: 100,
      work_notes: "Submitted",
    });
    await setDoc(doc(db, "tasks/task-a"), {
      id: "task-a",
      project_id: project,
      title: "A's assignment",
      description: "Director instructions",
      priority: "high",
      due_date: "2026-12-01",
      status: "todo",
      created_by: "director",
      assigned_to: "researcher-a",
      progress: 0,
      work_notes: "",
    });
    await setDoc(doc(db, "tasks/task-b"), {
      id: "task-b",
      project_id: project,
      title: "B's assignment",
      description: "Private instructions",
      priority: "high",
      due_date: "2026-12-01",
      status: "todo",
      created_by: "director",
      assigned_to: "researcher-b",
      progress: 0,
      work_notes: "",
    });
    await setDoc(doc(db, "tasks/project-2-task"), {
      id: "project-2-task",
      project_id: "project-2",
      title: "Private project task",
      description: "Not assigned to researcher-a",
      priority: "medium",
      status: "todo",
      created_by: "researcher-b",
      assigned_to: "researcher-b",
    });
    await setDoc(doc(db, "user_permissions/project-1_researcher-c_tasks.assign"), {
      id: "project-1_researcher-c_tasks.assign",
      project_id: project,
      user_id: "researcher-c",
      permission_key: "tasks.assign",
    });
    await setDoc(doc(db, "user_permissions/project-1_researcher-b_tasks.submit"), {
      id: "project-1_researcher-b_tasks.submit",
      project_id: project,
      user_id: "researcher-b",
      permission_key: "tasks.submit",
    });
    await setDoc(doc(db, "comments/comment-other-project-by-a"), {
      id: "comment-other-project-by-a",
      project_id: "project-2",
      task_id: null,
      author_id: "researcher-a",
      content: "Must not remain visible after project access is absent",
    });
    await setDoc(doc(db, "activity_logs/log-other-project-by-a"), {
      id: "log-other-project-by-a",
      project_id: "project-2",
      actor_id: "researcher-a",
      old_values: { description: "sensitive" },
    });
    await setDoc(doc(db, "tasks/task-review"), {
      id: "task-review",
      project_id: project,
      title: "Submitted work",
      description: "Director instructions",
      priority: "medium",
      due_date: "2026-12-01",
      status: "review",
      created_by: "director",
      assigned_to: "researcher-a",
      progress: 100,
      work_notes: "Submitted",
      submission_version: 2,
      latest_submission_id: "submission-a-v2",
    });
    await setDoc(doc(db, "tasks/team-task"), {
      id: "team-task",
      project_id: project,
      team_id: "team-alpha",
      title: "Team-only assignment",
      description: "Visible only within the assigned team",
      priority: "medium",
      status: "in_progress",
      created_by: "director",
      assigned_to: "researcher-b",
    });
    await setDoc(doc(db, "task_submissions/submission-a-v1"), {
      id: "submission-a-v1",
      project_id: project,
      task_id: "task-review",
      submitted_by: "researcher-a",
      version: 1,
      notes: "First version",
      files: [],
    });
    await setDoc(doc(db, "task_submissions/submission-a-v2"), {
      id: "submission-a-v2",
      project_id: project,
      task_id: "task-review",
      submitted_by: "researcher-a",
      version: 2,
      notes: "Second version after requested revisions",
      files: [],
    });
    await setDoc(doc(db, "task_reviews/review-a-r1"), {
      id: "review-a-r1",
      project_id: project,
      task_id: "task-review",
      reviewer_id: "reviewer",
      decision: "revision_required",
      feedback: "Please revise the conclusion.",
    });
    await setDoc(doc(db, "documents/document-a"), {
      id: "document-a",
      project_id: project,
      storage_path: `${project}/document-a/output.txt`,
      authorized_users: ["researcher-a"],
    });
    await setDoc(doc(db, "documents/document-b"), {
      id: "document-b",
      project_id: project,
      storage_path: `${project}/document-b/private.txt`,
      authorized_users: ["researcher-b"],
    });
    await setDoc(doc(db, "documents/project-2-document"), {
      id: "project-2-document",
      project_id: "project-2",
      storage_path: "project-2/project-2-document/private.txt",
      authorized_users: ["researcher-b"],
    });
    await setDoc(doc(db, "notifications/notice-a"), {
      id: "notice-a",
      user_id: "researcher-a",
      type: "task_assigned",
      read_at: null,
    });
    await setDoc(doc(db, "notifications/notice-b"), {
      id: "notice-b",
      user_id: "researcher-b",
      type: "task_assigned",
      read_at: null,
    });
    const storage = context.storage();
    await uploadBytes(ref(storage, `${project}/document-a/output.txt`), new Blob(["A output"]), {
      contentType: "text/plain",
    });
    await uploadBytes(ref(storage, `${project}/document-b/private.txt`), new Blob(["B private output"]), {
      contentType: "text/plain",
    });
    await uploadBytes(ref(storage, "project-2/project-2-document/private.txt"), new Blob(["Director-visible file"]), {
      contentType: "text/plain",
    });
    await uploadBytes(ref(storage, `${project}/document-a/unregistered-extra.txt`), new Blob(["Orphan"]), {
      contentType: "text/plain",
    });
  });
}

describe("Firebase Security Rules: researcher assignment privacy", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId,
      firestore: { rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8") },
      storage: { rules: readFileSync(resolve(process.cwd(), "storage.rules"), "utf8") },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seed();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("lets a researcher read their assigned task but not another researcher's task or project membership", async () => {
    const db = env.authenticatedContext("researcher-a").firestore();
    await assertSucceeds(getDoc(doc(db, "tasks/task-a")));
    await assertFails(getDoc(doc(db, "tasks/task-b")));
    await assertFails(getDoc(doc(db, `project_members/${project}_researcher-b`)));
  });

  it("denies cross-project reads even when the researcher authored the comment or audit row", async () => {
    const db = env.authenticatedContext("researcher-a").firestore();
    await assertFails(getDoc(doc(db, "tasks/project-2-task")));
    await assertFails(getDoc(doc(db, "comments/comment-other-project-by-a")));
    await assertFails(getDoc(doc(db, "activity_logs/log-other-project-by-a")));
  });

  it("does not let task assignment permission expose other members' permission grants", async () => {
    const db = env.authenticatedContext("researcher-c").firestore();
    await assertSucceeds(getDoc(doc(db, "user_permissions/project-1_researcher-c_tasks.assign")));
    await assertFails(getDoc(doc(db, "user_permissions/project-1_researcher-b_tasks.submit")));
    await assertFails(getDoc(doc(db, `project_members/${project}_researcher-b`)));
  });

  it("grants the trusted platform director global project and file access", async () => {
    const db = env.authenticatedContext("platform-director", { platform_admin: true }).firestore();
    const storage = env.authenticatedContext("platform-director", { platform_admin: true }).storage();
    await assertSucceeds(getDoc(doc(db, "projects/project-2")));
    await assertSucceeds(getDoc(doc(db, "tasks/project-2-task")));
    await assertSucceeds(getBytes(ref(storage, "project-2/project-2-document/private.txt")));
  });

  it("allows authorized progress updates but protects instructions, ownership and workflow transitions", async () => {
    const db = env.authenticatedContext("researcher-a").firestore();
    await assertFails(updateDoc(doc(db, "tasks/task-a"), { description: "changed" }));
    await assertFails(updateDoc(doc(db, "tasks/task-a"), { assigned_to: "researcher-b" }));
    await assertSucceeds(
      updateDoc(doc(db, "tasks/task-a"), { status: "in_progress", progress: 35, work_notes: "Started analysis" }),
    );
    await assertFails(updateDoc(doc(db, "tasks/task-a"), { status: "review", progress: 100 }));
    await assertFails(updateDoc(doc(db, "tasks/task-a"), { status: "completed" }));
    await assertFails(updateDoc(doc(db, "tasks/task-a"), { status: "not-a-valid-state" }));
  });

  it("denies direct role and permission changes", async () => {
    const db = env.authenticatedContext("researcher-a").firestore();
    await assertFails(updateDoc(doc(db, `project_members/${project}_researcher-a`), { role: "manager" }));
    await assertFails(updateDoc(doc(db, `project_members/${project}_researcher-a`), { permissions: ownerPermissions }));
    await assertFails(
      setDoc(doc(db, `project_members/${project}_researcher-c`), { user_id: "researcher-c", status: "active" }),
    );
  });

  it("rejects direct task creation that includes fields outside the validated task schema", async () => {
    const db = env.authenticatedContext("director").firestore();
    await assertFails(
      setDoc(doc(db, "tasks/task-with-hidden-field"), {
        project_id: project,
        created_by: "director",
        title: "Valid task title",
        description: "Instructions",
        expected_output: "A report",
        required_deliverables: "PDF",
        status: "todo",
        priority: "medium",
        assigned_to: null,
        due_date: null,
        internal_note: "Unmodeled data must not be accepted",
      }),
    );
  });

  it("requires dedicated immutable review actions instead of direct status writes", async () => {
    const reviewerDb = env.authenticatedContext("reviewer").firestore();
    const researcherDb = env.authenticatedContext("researcher-a").firestore();
    await assertSucceeds(getDoc(doc(reviewerDb, "tasks/task-review")));
    await assertFails(getDoc(doc(reviewerDb, "tasks/task-a")));
    await assertFails(updateDoc(doc(reviewerDb, "tasks/task-review"), { status: "revision_required" }));
    await assertFails(updateDoc(doc(researcherDb, "tasks/task-review"), { status: "in_progress" }));
    await assertFails(updateDoc(doc(researcherDb, "tasks/task-review"), { status: "submitted" }));
    await assertFails(updateDoc(doc(researcherDb, "tasks/task-review"), { status: "completed" }));
    await assertFails(updateDoc(doc(reviewerDb, "tasks/reviewer-own-review"), { status: "completed" }));
    await assertFails(updateDoc(doc(reviewerDb, "tasks/reviewer-own-review"), { status: "revision_required" }));
    await assertFails(
      setDoc(doc(reviewerDb, "tasks/created-in-review"), {
        id: "created-in-review",
        project_id: project,
        title: "Invalid initial review",
        description: "A task cannot begin in review",
        expected_output: "",
        required_deliverables: "",
        priority: "medium",
        status: "review",
        created_by: "reviewer",
        assigned_to: "reviewer",
      }),
    );
  });

  it("limits team-scoped reads to active team members and blocks client-side team lifecycle writes", async () => {
    const observerDb = env.authenticatedContext("team-observer").firestore();
    const outsiderDb = env.authenticatedContext("team-outsider").firestore();
    const ownerDb = env.authenticatedContext("director").firestore();
    await assertSucceeds(getDoc(doc(observerDb, "teams/team-alpha")));
    await assertSucceeds(getDoc(doc(observerDb, "team_members/team-alpha_team-observer")));
    await assertSucceeds(getDoc(doc(observerDb, "tasks/team-task")));
    await assertSucceeds(getDoc(doc(observerDb, "milestones/team-alpha-milestone")));
    await assertFails(getDoc(doc(observerDb, "milestones/researcher-b-milestone")));
    await assertFails(getDoc(doc(outsiderDb, "teams/team-alpha")));
    await assertFails(getDoc(doc(outsiderDb, "team_members/team-alpha_team-observer")));
    await assertFails(getDoc(doc(outsiderDb, "tasks/team-task")));
    await assertFails(getDoc(doc(outsiderDb, "milestones/team-alpha-milestone")));
    const researcherA = env.authenticatedContext("researcher-a").firestore();
    const researcherB = env.authenticatedContext("researcher-b").firestore();
    await assertFails(getDoc(doc(researcherA, "milestones/researcher-b-milestone")));
    await assertSucceeds(getDoc(doc(researcherB, "milestones/researcher-b-milestone")));
    await assertFails(
      setDoc(doc(ownerDb, "teams/team-forged"), {
        id: "team-forged",
        project_id: project,
        name: "Forged team",
        status: "active",
      }),
    );
    await assertFails(updateDoc(doc(ownerDb, "teams/team-alpha"), { status: "archived" }));
    await assertFails(deleteDoc(doc(ownerDb, "teams/team-alpha")));
    await assertFails(
      setDoc(doc(ownerDb, "team_members/team-alpha_team-outsider"), {
        id: "team-alpha_team-outsider",
        project_id: project,
        team_id: "team-alpha",
        user_id: "team-outsider",
        status: "active",
      }),
    );
  });

  it("keeps submission and reviewer decision history readable only to the assignee and reviewer, and immutable", async () => {
    const researcherDb = env.authenticatedContext("researcher-a").firestore();
    const otherResearcherDb = env.authenticatedContext("researcher-b").firestore();
    const reviewerDb = env.authenticatedContext("reviewer").firestore();
    const submission = doc(researcherDb, "task_submissions/submission-a-v1");
    const submissionV2 = doc(researcherDb, "task_submissions/submission-a-v2");
    const review = doc(researcherDb, "task_reviews/review-a-r1");
    await assertSucceeds(getDoc(submission));
    await assertSucceeds(getDoc(submissionV2));
    await assertSucceeds(getDoc(doc(reviewerDb, "task_submissions/submission-a-v1")));
    await assertSucceeds(getDoc(doc(reviewerDb, "task_submissions/submission-a-v2")));
    await assertSucceeds(getDoc(review));
    await assertSucceeds(getDoc(doc(reviewerDb, "task_reviews/review-a-r1")));
    await assertFails(getDoc(doc(otherResearcherDb, "task_submissions/submission-a-v1")));
    await assertFails(getDoc(doc(otherResearcherDb, "task_reviews/review-a-r1")));
    await assertFails(updateDoc(submission, { notes: "rewritten history" }));
    await assertFails(deleteDoc(submission));
    await assertFails(updateDoc(submissionV2, { notes: "rewritten version two" }));
    await assertFails(deleteDoc(submissionV2));
    await assertFails(setDoc(doc(reviewerDb, "task_reviews/review-forged"), { task_id: "task-review" }));
    await assertFails(updateDoc(review, { feedback: "rewritten history" }));
    await assertFails(deleteDoc(review));
  });

  it("permits only explicitly shared files in private Cloud Storage", async () => {
    const storage = env.authenticatedContext("researcher-a").storage();
    await assertSucceeds(getBytes(ref(storage, `${project}/document-a/output.txt`)));
    await assertFails(getBytes(ref(storage, `${project}/document-b/private.txt`)));
    await assertFails(getBytes(ref(storage, `${project}/document-a/unregistered-extra.txt`)));
    await assertFails(
      uploadBytes(ref(storage, `${project}/document-a/direct-client-write.txt`), new Blob(["not allowed"]), {
        contentType: "text/plain",
      }),
    );
  });

  it("isolates notifications and permits only recipient read acknowledgements", async () => {
    const db = env.authenticatedContext("researcher-a").firestore();
    await assertSucceeds(getDoc(doc(db, "notifications/notice-a")));
    await assertFails(getDoc(doc(db, "notifications/notice-b")));
    await assertSucceeds(updateDoc(doc(db, "notifications/notice-a"), { read_at: "2026-10-04T12:00:00.000Z" }));
    await assertFails(updateDoc(doc(db, "notifications/notice-a"), { type: "submission_approved" }));
  });
});
