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

  it("allows progress/status updates on an assigned task but protects instructions and ownership", async () => {
    const db = env.authenticatedContext("researcher-a").firestore();
    await assertFails(updateDoc(doc(db, "tasks/task-a"), { description: "changed" }));
    await assertFails(updateDoc(doc(db, "tasks/task-a"), { assigned_to: "researcher-b" }));
    await assertSucceeds(
      updateDoc(doc(db, "tasks/task-a"), { status: "in_progress", progress: 35, work_notes: "Started analysis" }),
    );
    await assertSucceeds(updateDoc(doc(db, "tasks/task-a"), { status: "review", progress: 100 }));
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

  it("allows reviewer revision requests and resubmission but not researcher approval", async () => {
    const reviewerDb = env.authenticatedContext("reviewer").firestore();
    const researcherDb = env.authenticatedContext("researcher-a").firestore();
    await assertSucceeds(getDoc(doc(reviewerDb, "tasks/task-review")));
    await assertFails(getDoc(doc(reviewerDb, "tasks/task-a")));
    await assertSucceeds(updateDoc(doc(reviewerDb, "tasks/task-review"), { status: "revision_required" }));
    await assertSucceeds(updateDoc(doc(researcherDb, "tasks/task-review"), { status: "in_progress" }));
    await assertSucceeds(updateDoc(doc(researcherDb, "tasks/task-review"), { status: "review" }));
    await assertFails(updateDoc(doc(researcherDb, "tasks/task-review"), { status: "completed" }));
  });

  it("permits only explicitly shared files in private Cloud Storage", async () => {
    const storage = env.authenticatedContext("researcher-a").storage();
    await assertSucceeds(getBytes(ref(storage, `${project}/document-a/output.txt`)));
    await assertFails(getBytes(ref(storage, `${project}/document-b/private.txt`)));
  });

  it("isolates notifications and permits only recipient read acknowledgements", async () => {
    const db = env.authenticatedContext("researcher-a").firestore();
    await assertSucceeds(getDoc(doc(db, "notifications/notice-a")));
    await assertFails(getDoc(doc(db, "notifications/notice-b")));
    await assertSucceeds(updateDoc(doc(db, "notifications/notice-a"), { read_at: "2026-10-04T12:00:00.000Z" }));
    await assertFails(updateDoc(doc(db, "notifications/notice-a"), { type: "submission_approved" }));
  });
});
