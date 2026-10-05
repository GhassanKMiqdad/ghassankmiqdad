import type { ReviewDecision, SubmissionStatus } from "@/lib/research-workflow";

export type DeliverableStatus = "pending" | "submitted" | "revision_required" | "approved";
export type DeliverableType = "document" | "dataset" | "report" | "code" | "other";

export type TaskDeliverable = {
  id: string;
  projectId: string;
  teamId: string | null;
  taskId: string;
  name: string;
  description: string;
  required: boolean;
  type: DeliverableType;
  status: DeliverableStatus;
  submittedFileIds: string[];
  submissionId: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
};

export type SubmissionFile = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  deliverableId: string | null;
  deliverableName: string | null;
};

export type SubmissionReview = {
  id: string;
  reviewerId: string;
  reviewerName: string;
  decision: ReviewDecision;
  feedback: string;
  createdAt: string;
};

export type SubmissionHistoryItem = {
  id: string;
  taskId: string;
  projectId: string;
  researcherId: string;
  researcherName: string;
  versionNumber: number;
  previousVersionId: string | null;
  notes: string;
  status: SubmissionStatus;
  submittedAt: string;
  files: SubmissionFile[];
  reviews: SubmissionReview[];
};

export type SubmittableDocument = SubmissionFile & { createdAt: string };
