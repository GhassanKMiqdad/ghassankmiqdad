import "server-only";

import { can } from "@/lib/permissions/policy";
import { firebaseAdminFirestore } from "@/lib/firebase/admin";
import { assertProjectAccess, getProjectAccess, hasTeamAccess } from "@/server/access";
import { getTask } from "@/server/queries/tasks";
import type { SubmittableDocument, SubmissionHistoryItem, SubmissionReview } from "@/types/research-workflow";

function asIso(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return (value.toDate() as Date).toISOString();
  }
  return typeof value === "string" ? value : new Date(0).toISOString();
}

export async function listMySubmittableDocuments(
  projectId: string,
  teamId: string | null,
): Promise<SubmittableDocument[]> {
  const access = await assertProjectAccess(projectId);
  if (!(await hasTeamAccess(access, teamId))) return [];
  const db = firebaseAdminFirestore();
  const snapshot = await db
    .collection("documents")
    .where("project_id", "==", projectId)
    .where("uploaded_by", "==", access.userId)
    .limit(100)
    .get();
  return snapshot.docs
    .filter(
      (doc) =>
        !doc.get("submission_id") && !doc.get("task_id") && (!doc.get("team_id") || doc.get("team_id") === teamId),
    )
    .map((doc) => ({
      id: doc.id,
      title: String(doc.get("title") ?? doc.get("file_name") ?? "Document"),
      fileName: String(doc.get("file_name") ?? ""),
      mimeType: String(doc.get("mime_type") ?? "application/octet-stream"),
      sizeBytes: Number(doc.get("size_bytes") ?? 0),
      deliverableId: null,
      deliverableName: null,
      createdAt: asIso(doc.get("created_at")),
    }));
}

export async function listTaskSubmissionHistory(projectId: string, taskId: string): Promise<SubmissionHistoryItem[]> {
  const access = await getProjectAccess(projectId);
  if (!access) return [];
  const task = await getTask(taskId);
  if (!task || task.projectId !== projectId) return [];
  const mayView = can(access, "tasks.view") || can(access, "tasks.review") || task.assignedToId === access.userId;
  if (!mayView) return [];

  const db = firebaseAdminFirestore();
  const submissions = await db
    .collection("submissions")
    .where("project_id", "==", projectId)
    .where("task_id", "==", taskId)
    .orderBy("version_number", "desc")
    .limit(50)
    .get();
  const visible = submissions.docs.filter(
    (doc) => doc.get("researcher_id") === access.userId || can(access, "tasks.view") || can(access, "tasks.review"),
  );

  const result = await Promise.all(
    visible.map(async (submission) => {
      const row = submission.data();
      const [reviews, files] = await Promise.all([
        db
          .collection("reviews")
          .where("submission_id", "==", submission.id)
          .orderBy("created_at", "desc")
          .limit(50)
          .get(),
        Promise.all(
          (Array.isArray(row.file_ids) ? row.file_ids : [])
            .slice(0, 10)
            .map((id: unknown) => db.collection("documents").doc(String(id)).get()),
        ),
      ]);
      const reviewItems: SubmissionReview[] = await Promise.all(
        reviews.docs.map(async (reviewDoc) => {
          const review = reviewDoc.data();
          const reviewerId = String(review.reviewer_id ?? "");
          const profile = reviewerId ? await db.collection("profiles").doc(reviewerId).get() : null;
          return {
            id: reviewDoc.id,
            reviewerId,
            reviewerName: String(review.reviewer_name ?? profile?.get("full_name") ?? "Reviewer"),
            decision: review.decision,
            feedback: String(review.feedback ?? ""),
            createdAt: asIso(review.created_at),
          };
        }),
      );
      const fileItems = await Promise.all(
        files
          .filter(
            (file) =>
              file.exists && file.get("project_id") === projectId && file.get("submission_id") === submission.id,
          )
          .map(async (file) => {
            const deliverableId =
              typeof file.get("deliverable_id") === "string" ? String(file.get("deliverable_id")) : null;
            const deliverable = deliverableId ? await db.collection("deliverables").doc(deliverableId).get() : null;
            return {
              id: file.id,
              title: String(file.get("title") ?? file.get("file_name") ?? "Document"),
              fileName: String(file.get("file_name") ?? ""),
              mimeType: String(file.get("mime_type") ?? "application/octet-stream"),
              sizeBytes: Number(file.get("size_bytes") ?? 0),
              deliverableId,
              deliverableName:
                deliverable?.exists && deliverable.get("task_id") === taskId
                  ? String(deliverable.get("name") ?? "")
                  : null,
            };
          }),
      );
      return {
        id: submission.id,
        taskId,
        projectId,
        researcherId: String(row.researcher_id ?? ""),
        researcherName: String(row.researcher_name ?? "Researcher"),
        versionNumber: Number(row.version_number ?? 0),
        previousVersionId: typeof row.previous_version_id === "string" ? row.previous_version_id : null,
        notes: String(row.notes ?? ""),
        status: row.status,
        submittedAt: asIso(row.submitted_at ?? row.created_at),
        files: fileItems,
        reviews: reviewItems,
      };
    }),
  );
  return result.sort((a, b) => b.versionNumber - a.versionNumber);
}
