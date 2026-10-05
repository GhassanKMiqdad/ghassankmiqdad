import type { TaskStatus } from "@/lib/permissions/catalog";

export type SubmissionStatus = "submitted" | "under_review" | "revision_required" | "approved" | "rejected";
export type ReviewDecision = "approved" | "revision_required" | "rejected";

export type VersionedSubmission = {
  id: string;
  taskId: string;
  researcherId: string;
  versionNumber: number;
  previousVersionId: string | null;
  status: SubmissionStatus;
  createdAt: string;
};

/** Compute the next immutable version from the latest existing version. */
export function nextSubmissionVersion(latest: Pick<VersionedSubmission, "id" | "versionNumber"> | null) {
  return {
    versionNumber: latest ? latest.versionNumber + 1 : 1,
    previousVersionId: latest?.id ?? null,
  };
}

/** Only an assigned researcher may submit work from active or revision-required states. */
export function canSubmitTask(status: TaskStatus, assignedResearcherId: string | null, actorId: string) {
  return assignedResearcherId === actorId && (status === "in_progress" || status === "revision_required");
}

/** Map a durable review decision to its explicit task lifecycle state. */
export function taskStatusForReview(decision: ReviewDecision): TaskStatus {
  switch (decision) {
    case "approved":
      return "approved";
    case "revision_required":
      return "revision_required";
    case "rejected":
      return "cancelled";
  }
}

/** Stable, newest-first history ordering, with version number as deterministic tie-breaker. */
export function sortSubmissionHistory<T extends Pick<VersionedSubmission, "versionNumber" | "createdAt">>(items: T[]) {
  return [...items].sort((a, b) => b.versionNumber - a.versionNumber || b.createdAt.localeCompare(a.createdAt));
}

/** Researchers may only see their own submissions; task reviewers/managers may see authorized task history. */
export function canReadSubmission(
  actorId: string,
  researcherId: string,
  mayReviewTask: boolean,
  mayViewAllTasks: boolean,
) {
  return actorId === researcherId || mayReviewTask || mayViewAllTasks;
}
