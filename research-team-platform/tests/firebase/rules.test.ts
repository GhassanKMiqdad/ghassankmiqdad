import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const projectId = "demo-research-platform";
const project = "project-1";
let env: RulesTestEnvironment;

const memberPermissions = [
  "project.view",
  "team.view",
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
    await setDoc(doc(db, `projects/${project}`), {
      id: project,
      name: "Study",
      status: "active",
      created_by: "director",
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
    await setDoc(doc(db, "teams/team-a"), {
      projectId: project,
      status: "active",
      memberIds: ["researcher-a", "reviewer"],
      leadId: "researcher-a",
    });
    await setDoc(doc(db, "teams/team-b"), {
      projectId: project,
      status: "active",
      memberIds: ["researcher-b"],
      leadId: "researcher-b",
    });
    await setDoc(doc(db, "team_members/team-a_researcher-a"), {
      projectId: project,
      teamId: "team-a",
      userId: "researcher-a",
      status: "active",
    });
    await setDoc(doc(db, "team_members/team-a_reviewer"), {
      projectId: project,
      teamId: "team-a",
      userId: "reviewer",
      status: "active",
    });
    await setDoc(doc(db, "team_members/team-b_researcher-b"), {
      projectId: project,
      teamId: "team-b",
      userId: "researcher-b",
      status: "active",
    });
    await setDoc(doc(db, "tasks/task-a"), {
      id: "task-a",
      project_id: project,
      title: "A's assignment",
      description: "Director instructions",
      expected_output: "",
      required_deliverables: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      priority: "high",
      due_date: "2026-12-01",
      status: "assigned",
      created_by: "director",
      assigned_to: "researcher-a",
      team_id: "team-a",
      progress: 0,
      work_notes: "",
    });
    await setDoc(doc(db, "tasks/task-b"), {
      id: "task-b",
      project_id: project,
      title: "B's assignment",
      description: "Private instructions",
      expected_output: "",
      required_deliverables: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      priority: "high",
      due_date: "2026-12-01",
      status: "assigned",
      created_by: "director",
      assigned_to: "researcher-b",
      team_id: "team-b",
      progress: 0,
      work_notes: "",
    });
    await setDoc(doc(db, "tasks/task-review"), {
      id: "task-review",
      project_id: project,
      title: "Submitted work",
      description: "Director instructions",
      expected_output: "",
      required_deliverables: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      priority: "medium",
      due_date: "2026-12-01",
      status: "under_review",
      created_by: "director",
      assigned_to: "researcher-a",
      team_id: "team-a",
      progress: 100,
      work_notes: "Submitted",
    });
    await setDoc(doc(db, "milestones/milestone-a"), {
      projectId: project,
      title: "Team A milestone",
      teamId: "team-a",
      researcherIds: [],
      status: "open",
    });
    await setDoc(doc(db, "milestones/milestone-b"), {
      projectId: project,
      title: "Team B milestone",
      teamId: "team-b",
      researcherIds: [],
      status: "open",
    });
    await setDoc(doc(db, "milestones/milestone-private"), {
      projectId: project,
      title: "Private milestone",
      teamId: null,
      researcherIds: ["researcher-b"],
      status: "open",
    });
    await setDoc(doc(db, "submissions/submission-a"), {
      id: "submission-a",
      project_id: project,
      team_id: "team-a",
      task_id: "task-a",
      researcher_id: "researcher-a",
    });
    await setDoc(doc(db, "submissions/submission-b"), {
      id: "submission-b",
      project_id: project,
      team_id: "team-b",
      task_id: "task-b",
      researcher_id: "researcher-b",
    });
    await setDoc(doc(db, "reviews/review-a"), {
      id: "review-a",
      project_id: project,
      task_id: "task-a",
      submission_id: "submission-a",
    });
    await setDoc(doc(db, "reviews/review-b"), {
      id: "review-b",
      project_id: project,
      task_id: "task-b",
      submission_id: "submission-b",
    });
    await setDoc(doc(db, "deliverables/deliverable-a"), {
      id: "deliverable-a",
      project_id: project,
      task_id: "task-a",
      name: "A output",
    });
    await setDoc(doc(db, "deliverables/deliverable-b"), {
      id: "deliverable-b",
      project_id: project,
      task_id: "task-b",
      name: "B output",
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
    await setDoc(doc(db, "upload_reservations/reserved-upload"), {
      project_id: project,
      document_id: "reserved-upload",
      storage_path: `${project}/reserved-upload/pending.txt`,
      uploader_uid: "researcher-a",
      token: "server-secret",
      status: "pending",
      expires_at: new Date(Date.now() + 60_000),
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

  it("isolates team rosters, milestones, submissions, reviews and deliverables", async () => {
    const db = env.authenticatedContext("researcher-a").firestore();
    await assertSucceeds(getDoc(doc(db, "teams/team-a")));
    await assertFails(getDoc(doc(db, "teams/team-b")));
    await assertSucceeds(getDoc(doc(db, "team_members/team-a_researcher-a")));
    await assertFails(getDoc(doc(db, "team_members/team-b_researcher-b")));
    await assertSucceeds(getDoc(doc(db, "milestones/milestone-a")));
    await assertFails(getDoc(doc(db, "milestones/milestone-b")));
    await assertFails(getDoc(doc(db, "milestones/milestone-private")));
    await assertSucceeds(getDoc(doc(db, "submissions/submission-a")));
    await assertFails(getDoc(doc(db, "submissions/submission-b")));
    await assertSucceeds(getDoc(doc(db, "reviews/review-a")));
    await assertFails(getDoc(doc(db, "reviews/review-b")));
    await assertSucceeds(getDoc(doc(db, "deliverables/deliverable-a")));
    await assertFails(getDoc(doc(db, "deliverables/deliverable-b")));
  });

  it("denies direct client changes to team membership and workflow records", async () => {
    const db = env.authenticatedContext("researcher-a").firestore();
    await assertFails(updateDoc(doc(db, "teams/team-a"), { memberIds: ["researcher-a", "researcher-b"] }));
    await assertFails(
      setDoc(doc(db, "team_members/team-a_researcher-b"), {
        projectId: project,
        teamId: "team-a",
        userId: "researcher-b",
        status: "active",
      }),
    );
    await assertFails(
      setDoc(doc(db, "milestones/malicious"), {
        projectId: project,
        title: "Escalation",
        teamId: "team-a",
        researcherIds: ["researcher-a"],
      }),
    );
    await assertFails(
      setDoc(doc(db, "submissions/malicious"), {
        project_id: project,
        task_id: "task-a",
        researcher_id: "researcher-b",
      }),
    );
    await assertFails(updateDoc(doc(db, "deliverables/deliverable-a"), { status: "approved" }));
  });

  it("rejects direct malicious task creates and updates", async () => {
    const db = env.authenticatedContext("director").firestore();
    const base = {
      id: "direct-task",
      project_id: project,
      title: "Valid task",
      description: "",
      expected_output: "",
      required_deliverables: "",
      status: "assigned",
      priority: "medium",
      assigned_to: null,
      due_date: null,
      created_by: "director",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      progress: 0,
      work_notes: "",
    };
    await assertFails(setDoc(doc(db, "tasks/direct-task"), base));
    await assertFails(setDoc(doc(db, "tasks/extra-field"), { ...base, id: "extra-field", is_admin: true }));
    await assertFails(setDoc(doc(db, "tasks/bad-status"), { ...base, id: "bad-status", status: "approved" }));
    await assertFails(setDoc(doc(db, "tasks/bad-date"), { ...base, id: "bad-date", due_date: "3026-01-01" }));
    await assertFails(setDoc(doc(db, "tasks/not-member"), { ...base, id: "not-member", assigned_to: "outsider" }));
    await assertFails(updateDoc(doc(db, "tasks/direct-task"), { hidden: true }));
    await assertFails(updateDoc(doc(db, "tasks/direct-task"), { status: "completed" }));
  });

  it("denies direct task mutations because all lifecycle changes require the audited Server Actions", async () => {
    const db = env.authenticatedContext("researcher-a").firestore();
    await assertFails(updateDoc(doc(db, "tasks/task-a"), { description: "changed" }));
    await assertFails(updateDoc(doc(db, "tasks/task-a"), { assigned_to: "researcher-b" }));
    await assertFails(
      updateDoc(doc(db, "tasks/task-a"), { status: "in_progress", progress: 35, work_notes: "Started analysis" }),
    );
    await assertFails(updateDoc(doc(db, "tasks/task-a"), { status: "under_review", progress: 100 }));
    await assertFails(updateDoc(doc(db, "tasks/task-a"), { status: "completed" }));
  });

  it("denies direct role and permission changes", async () => {
    const db = env.authenticatedContext("researcher-a").firestore();
    await assertFails(updateDoc(doc(db, `project_members/${project}_researcher-a`), { role: "manager" }));
    await assertFails(updateDoc(doc(db, `project_members/${project}_researcher-a`), { permissions: ownerPermissions }));
    await assertFails(
      setDoc(doc(db, `project_members/${project}_researcher-c`), { user_id: "researcher-c", status: "active" }),
    );
  });

  it("denies direct reviewer and researcher task transitions outside immutable Server Actions", async () => {
    const reviewerDb = env.authenticatedContext("reviewer").firestore();
    const researcherDb = env.authenticatedContext("researcher-a").firestore();
    await assertSucceeds(getDoc(doc(reviewerDb, "tasks/task-review")));
    await assertFails(getDoc(doc(reviewerDb, "tasks/task-a")));
    await assertFails(updateDoc(doc(reviewerDb, "tasks/task-review"), { status: "revision_required" }));
    await assertFails(updateDoc(doc(researcherDb, "tasks/task-review"), { status: "in_progress" }));
    await assertFails(updateDoc(doc(researcherDb, "tasks/task-review"), { status: "under_review" }));
    await assertFails(updateDoc(doc(researcherDb, "tasks/task-review"), { status: "completed" }));
  });

  it("permits only explicitly shared files in private Cloud Storage", async () => {
    const storage = env.authenticatedContext("researcher-a").storage();
    await assertSucceeds(getBytes(ref(storage, `${project}/document-a/output.txt`)));
    await assertFails(getBytes(ref(storage, `${project}/document-b/private.txt`)));
  });

  it("binds pending Storage uploads to the user named by a live server reservation", async () => {
    const path = `${project}/reserved-upload/pending.txt`;
    const blob = new Blob(["reserved upload"]);
    const other = env.authenticatedContext("researcher-b").storage();
    const uploader = env.authenticatedContext("researcher-a").storage();
    await assertFails(
      uploadBytes(ref(other, path), blob, {
        contentType: "text/plain",
        customMetadata: { uploader_uid: "researcher-b", upload_token: "server-secret" },
      }),
    );
    await assertSucceeds(
      uploadBytes(ref(uploader, path), blob, {
        contentType: "text/plain",
        customMetadata: { uploader_uid: "researcher-a", upload_token: "server-secret" },
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
