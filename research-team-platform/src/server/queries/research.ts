import "server-only";

import { AppError } from "@/lib/errors";
import { firebaseAdminFirestore } from "@/lib/firebase/admin";
import { can } from "@/lib/permissions/policy";
import { canReadTeam, requireTaskAccess } from "@/server/research-domain";
import { getProjectAccess } from "@/server/access";
import { getSessionUser } from "@/server/auth";
import type {
  ResearchMilestone,
  ResearchTeam,
  ResearchTeamMember,
  ResearcherRecord,
  TaskReview,
  TaskSubmission,
} from "@/types/research";

function iso(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return (value.toDate() as Date).toISOString();
  }
  return typeof value === "string" ? value : "";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function researcherStatus(value: unknown): ResearcherRecord["status"] {
  return value === "inactive" || value === "suspended" ? value : "active";
}

function canManage(access: NonNullable<Awaited<ReturnType<typeof getProjectAccess>>>) {
  return access.isOwner || can(access, "members.manage");
}

export async function listResearchTeams(projectId: string): Promise<ResearchTeam[]> {
  const user = await getSessionUser();
  const access = await getProjectAccess(projectId);
  if (!user || !access || access.status !== "active" || !can(access, "project.view")) throw new AppError("NOT_FOUND");
  const db = firebaseAdminFirestore();

  let teamDocs: FirebaseFirestore.QueryDocumentSnapshot[];
  if (canManage(access) || can(access, "team.view")) {
    const snapshot = await db.collection("teams").where("project_id", "==", projectId).limit(200).get();
    teamDocs = snapshot.docs;
  } else {
    const memberships = await db
      .collection("team_members")
      .where("project_id", "==", projectId)
      .where("user_id", "==", user.id)
      .where("status", "==", "active")
      .limit(100)
      .get();
    const snapshots = await Promise.all(
      memberships.docs.map((membership) =>
        db
          .collection("teams")
          .doc(String(membership.get("team_id")))
          .get(),
      ),
    );
    teamDocs = snapshots.filter((snapshot): snapshot is FirebaseFirestore.QueryDocumentSnapshot => snapshot.exists);
  }

  const rows = await Promise.all(
    teamDocs.map(async (snapshot) => {
      const team: FirebaseFirestore.DocumentData = { ...snapshot.data(), id: snapshot.id };
      if (!(await canReadTeam(user.id, team))) return null;
      const [members, tasks] = await Promise.all([
        db
          .collection("team_members")
          .where("team_id", "==", snapshot.id)
          .where("status", "==", "active")
          .limit(500)
          .get(),
        db
          .collection("tasks")
          .where("project_id", "==", projectId)
          .where("team_id", "==", snapshot.id)
          .limit(2000)
          .get(),
      ]);
      return {
        id: snapshot.id,
        projectId,
        name: text(team.name),
        description: text(team.description),
        status: team.status === "archived" ? "archived" : "active",
        leadId: nullableText(team.lead_id),
        memberCount: members.size,
        openTaskCount: tasks.docs.filter(
          (task) => !["completed", "approved", "rejected", "cancelled"].includes(String(task.get("status"))),
        ).length,
        createdAt: iso(team.created_at),
      } satisfies ResearchTeam;
    }),
  );
  return rows.filter((row): row is ResearchTeam => row !== null).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getResearchTeamMembers(teamId: string): Promise<ResearchTeamMember[]> {
  const db = firebaseAdminFirestore();
  const teamSnapshot = await db.collection("teams").doc(teamId).get();
  if (!teamSnapshot.exists) return [];
  const user = await getSessionUser();
  if (!user || !(await canReadTeam(user.id, { ...teamSnapshot.data(), id: teamSnapshot.id })))
    throw new AppError("NOT_FOUND");
  const membershipSnapshot = await db.collection("team_members").where("team_id", "==", teamId).limit(500).get();
  const active = membershipSnapshot.docs.filter((row) => row.get("status") === "active");
  const profiles = await db.getAll(...active.map((row) => db.collection("profiles").doc(String(row.get("user_id")))));
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile.data() ?? {}]));
  return active
    .map((row) => {
      const userId = String(row.get("user_id"));
      const profile = profileMap.get(userId) ?? {};
      return {
        userId,
        fullName: text(profile.full_name),
        email: nullableText(profile.email),
        role: row.get("role") === "lead" ? ("lead" as const) : ("member" as const),
        status: "active" as const,
      };
    })
    .sort((a, b) => (a.role === "lead" ? -1 : b.role === "lead" ? 1 : a.fullName.localeCompare(b.fullName)));
}

export async function listProjectMilestones(projectId: string): Promise<ResearchMilestone[]> {
  const user = await getSessionUser();
  const access = await getProjectAccess(projectId);
  if (!user || !access || access.status !== "active" || !can(access, "project.view")) throw new AppError("NOT_FOUND");
  const snapshot = await firebaseAdminFirestore()
    .collection("milestones")
    .where("project_id", "==", projectId)
    .limit(500)
    .get();
  const all = await Promise.all(
    snapshot.docs.map(async (doc) => {
      const row = doc.data();
      if (access.isOwner || can(access, "members.manage")) return { doc, row };
      if (row.responsible_researcher_id === user.id) return { doc, row };
      if (typeof row.responsible_team_id === "string") {
        const team = await firebaseAdminFirestore().collection("teams").doc(row.responsible_team_id).get();
        if (team.exists && (await canReadTeam(user.id, { ...team.data(), id: team.id }))) return { doc, row };
      }
      return null;
    }),
  );
  return all
    .filter(
      (item): item is { doc: FirebaseFirestore.QueryDocumentSnapshot; row: FirebaseFirestore.DocumentData } =>
        item !== null,
    )
    .map(({ doc, row }) => ({
      id: doc.id,
      projectId,
      name: text(row.name),
      description: text(row.description),
      deadline: nullableText(row.deadline),
      responsibleTeamId: nullableText(row.responsible_team_id),
      responsibleResearcherId: nullableText(row.responsible_researcher_id),
      status: ["pending", "in_progress", "at_risk", "completed"].includes(String(row.status)) ? row.status : "pending",
      createdBy: text(row.created_by),
      updatedAt: iso(row.updated_at),
    }))
    .sort((a, b) => (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31"));
}

export async function listTaskSubmissionHistory(
  taskId: string,
): Promise<{ submissions: TaskSubmission[]; reviews: TaskReview[] }> {
  const { db } = await requireTaskAccess((await getSessionUser())?.id ?? "", taskId);
  const submissionsSnapshot = await db
    .collection("task_submissions")
    .where("task_id", "==", taskId)
    .orderBy("version", "desc")
    .limit(100)
    .get();
  const submissions: TaskSubmission[] = submissionsSnapshot.docs.map((doc) => {
    const row = doc.data();
    return {
      id: doc.id,
      taskId,
      version: Number(row.version ?? 0),
      submittedBy: text(row.submitted_by),
      notes: text(row.notes),
      documentIds: Array.isArray(row.document_ids) ? row.document_ids.map(String) : [],
      documents: [],
      createdAt: iso(row.created_at),
    } satisfies TaskSubmission;
  });
  const documentIds = [...new Set(submissions.flatMap((submission) => submission.documentIds))];
  const documentSnapshots = documentIds.length
    ? await db.getAll(...documentIds.map((id) => db.collection("documents").doc(id)))
    : [];
  const documentsById = new Map(
    documentSnapshots
      .filter((doc) => doc.exists && doc.get("task_id") === taskId)
      .map((doc) => [
        doc.id,
        {
          id: doc.id,
          submissionId: text(doc.get("submission_version_id")),
          title: text(doc.get("title")),
          fileName: text(doc.get("file_name")),
        },
      ]),
  );
  for (const submission of submissions) {
    submission.documents = submission.documentIds
      .map((id) => documentsById.get(id))
      .filter(
        (doc): doc is { id: string; submissionId: string; title: string; fileName: string } =>
          doc !== undefined && doc.submissionId === submission.id,
      )
      .map(({ id, title, fileName }) => ({ id, title, fileName }));
  }
  const reviewsSnapshot = await db
    .collection("task_reviews")
    .where("task_id", "==", taskId)
    .orderBy("created_at", "desc")
    .limit(200)
    .get();
  const reviews = reviewsSnapshot.docs.map((doc) => {
    const row = doc.data();
    return {
      id: doc.id,
      taskId,
      submissionId: text(row.submission_id),
      reviewerId: text(row.reviewer_id),
      decision: row.decision,
      feedback: text(row.feedback),
      createdAt: iso(row.created_at),
    } satisfies TaskReview;
  });
  return { submissions, reviews };
}

export async function listResearcherProfiles(): Promise<ResearcherRecord[]> {
  const user = await getSessionUser();
  if (!user) throw new AppError("NOT_AUTHENTICATED");
  const db = firebaseAdminFirestore();
  const profile = await db.collection("profiles").doc(user.id).get();
  if (profile.get("is_platform_admin") !== true) throw new AppError("PERMISSION_DENIED");
  const profiles = await db.collection("profiles").limit(500).get();
  const profileDocs = profiles.docs.filter((doc) => doc.get("is_platform_admin") !== true);
  const ids = profileDocs.map((doc) => doc.id);
  const chunks = Array.from({ length: Math.ceil(ids.length / 30) }, (_, index) =>
    ids.slice(index * 30, index * 30 + 30),
  );
  const [membershipSnapshots, teamMembershipSnapshots, taskSnapshots] = await Promise.all([
    Promise.all(
      chunks.map((chunk) =>
        db
          .collection("project_members")
          .where("user_id", "in", chunk)
          .where("status", "==", "active")
          .limit(1000)
          .get(),
      ),
    ),
    Promise.all(
      chunks.map((chunk) =>
        db.collection("team_members").where("user_id", "in", chunk).where("status", "==", "active").limit(1000).get(),
      ),
    ),
    Promise.all(chunks.map((chunk) => db.collection("tasks").where("assigned_to", "in", chunk).limit(2000).get())),
  ]);
  const memberships = membershipSnapshots.flatMap((snapshot) => snapshot.docs);
  const teamMemberships = teamMembershipSnapshots.flatMap((snapshot) => snapshot.docs);
  const assignedTasks = taskSnapshots.flatMap((snapshot) => snapshot.docs);
  const projectIds = [...new Set(memberships.map((membership) => text(membership.get("project_id"))))];
  const teamIds = [...new Set(teamMemberships.map((membership) => text(membership.get("team_id"))))];
  const [projectDocs, teamDocs] = await Promise.all([
    projectIds.length ? db.getAll(...projectIds.map((id) => db.collection("projects").doc(id))) : Promise.resolve([]),
    teamIds.length ? db.getAll(...teamIds.map((id) => db.collection("teams").doc(id))) : Promise.resolve([]),
  ]);
  const projectNames = new Map<string, string>(projectDocs.map((doc) => [doc.id, text(doc.get("name"))] as const));
  const teamNames = new Map<string, { name: string; projectId: string }>(
    teamDocs.map((doc) => [doc.id, { name: text(doc.get("name")), projectId: text(doc.get("project_id")) }] as const),
  );
  const byUser = new Map<string, string[]>();
  for (const membership of memberships) {
    const userId = text(membership.get("user_id"));
    const items = byUser.get(userId) ?? [];
    items.push(text(membership.get("project_id")));
    byUser.set(userId, items);
  }
  const teamsByUser = new Map<string, string[]>();
  for (const membership of teamMemberships) {
    const userId = text(membership.get("user_id"));
    const items = teamsByUser.get(userId) ?? [];
    items.push(text(membership.get("team_id")));
    teamsByUser.set(userId, items);
  }
  const tasksByUser = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const task of assignedTasks) {
    const userId = text(task.get("assigned_to"));
    const items = tasksByUser.get(userId) ?? [];
    items.push(task);
    tasksByUser.set(userId, items);
  }
  const today = new Date().toISOString().slice(0, 10);
  return profileDocs
    .map((doc) => {
      const row = doc.data();
      const userTasks = tasksByUser.get(doc.id) ?? [];
      return {
        id: doc.id,
        email: nullableText(row.email),
        fullName: text(row.full_name),
        phone: nullableText(row.phone),
        avatarUrl: nullableText(row.avatar_url),
        specialization: text(row.specialization),
        skills: Array.isArray(row.skills) ? row.skills.filter((item): item is string => typeof item === "string") : [],
        academicBackground: text(row.academic_background),
        status: researcherStatus(row.status),
        notes: text(row.researcher_notes),
        createdAt: iso(row.created_at),
        lastSignInAt: row.last_sign_in_at ? iso(row.last_sign_in_at) : null,
        assignedProjects: [...new Set(byUser.get(doc.id) ?? [])].map((id) => ({
          id,
          name: projectNames.get(id) ?? "",
        })),
        assignedTeams: [...new Set(teamsByUser.get(doc.id) ?? [])].map((id) => ({
          id,
          ...(teamNames.get(id) ?? { name: "", projectId: "" }),
        })),
        activeTaskCount: userTasks.filter(
          (task) => !["completed", "approved", "rejected", "cancelled"].includes(String(task.get("status"))),
        ).length,
        completedTaskCount: userTasks.filter((task) => ["completed", "approved"].includes(String(task.get("status"))))
          .length,
        overdueTaskCount: userTasks.filter(
          (task) =>
            !["completed", "approved", "rejected", "cancelled"].includes(String(task.get("status"))) &&
            typeof task.get("due_date") === "string" &&
            String(task.get("due_date")) < today,
        ).length,
      } satisfies ResearcherRecord;
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getResearcherTaskWorkload(userId: string) {
  const actor = await getSessionUser();
  if (!actor) throw new AppError("NOT_AUTHENTICATED");
  const db = firebaseAdminFirestore();
  if ((await db.collection("profiles").doc(actor.id).get()).get("is_platform_admin") !== true)
    throw new AppError("PERMISSION_DENIED");
  const [profile, tasksSnapshot] = await Promise.all([
    db.collection("profiles").doc(userId).get(),
    db.collection("tasks").where("assigned_to", "==", userId).limit(500).get(),
  ]);
  if (!profile.exists || profile.get("is_platform_admin") === true) throw new AppError("NOT_FOUND");
  const tasks = tasksSnapshot.docs;
  const projects = await db.getAll(
    ...[...new Set(tasks.map((task) => text(task.get("project_id"))))].map((id) => db.collection("projects").doc(id)),
  );
  const projectNames = new Map<string, string>(
    projects.map((project) => [project.id, text(project.get("name"))] as const),
  );
  return tasks
    .map((task) => ({
      id: task.id,
      projectId: text(task.get("project_id")),
      projectName: projectNames.get(text(task.get("project_id"))) ?? "",
      title: text(task.get("title")),
      status: task.get("status"),
      dueDate: nullableText(task.get("due_date")),
    }))
    .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"));
}
