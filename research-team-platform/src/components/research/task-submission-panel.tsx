"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock3, FileText, Loader2, MessageSquareReply, Send, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { UploadDocumentDialog } from "@/components/documents/upload-document-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { fromAccessDTO, type ProjectAccessDTO } from "@/lib/permissions/access";
import { can } from "@/lib/permissions/policy";
import { getDocumentUrlAction } from "@/server/actions/documents";
import {
  completeApprovedTaskAction,
  reviewTaskSubmissionAction,
  startTaskReviewAction,
  submitTaskWorkAction,
} from "@/server/actions/research";
import type { TaskDetails } from "@/types/app";
import type { TaskReview, TaskSubmission } from "@/types/research";

export function TaskSubmissionPanel({
  task,
  access: accessDto,
  history,
}: {
  task: TaskDetails;
  access: ProjectAccessDTO;
  history: { submissions: TaskSubmission[]; reviews: TaskReview[] };
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const access = fromAccessDTO(accessDto);
  const isAssignee = task.assignedToId === access.userId;
  const canSubmit =
    isAssignee && can(access, "tasks.submit") && ["accepted", "in_progress", "revision_required"].includes(task.status);
  const canReview = can(access, "tasks.review") && !isAssignee;
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState("");
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [openingFile, setOpeningFile] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const perform = async (operation: () => Promise<{ ok: boolean; data?: unknown; error?: { message: string } }>) => {
    setPending(true);
    try {
      const result = await operation();
      if (!result.ok) {
        toast.error(result.error?.message ?? t.errors.UNEXPECTED);
        return null;
      }
      router.refresh();
      return { data: result.data };
    } finally {
      setPending(false);
    }
  };

  const submit = async () => {
    const result = await perform(() => submitTaskWorkAction({ taskId: task.id, notes, documentIds }));
    if (result && typeof result.data === "object" && result.data && "version" in result.data) {
      toast.success(fmt(t.tasks.workflow.submissionSaved, { version: String(result.data.version) }));
      setNotes("");
      setDocumentIds([]);
    }
  };

  const startReview = async () => {
    const result = await perform(() => startTaskReviewAction(task.id));
    if (result) toast.success(t.tasks.workflow.reviewStarted);
  };

  const decide = async (decision: "approved" | "revision_required" | "rejected") => {
    if (decision !== "approved" && feedback.trim().length < 3) {
      toast.error(t.tasks.workflow.feedbackRequired);
      return;
    }
    const result = await perform(() =>
      reviewTaskSubmissionAction({
        taskId: task.id,
        submissionId: task.latestSubmissionId,
        decision,
        feedback,
      }),
    );
    if (result) {
      toast.success(t.tasks.workflow.decisionSaved);
      setFeedback("");
    }
  };

  const openFile = async (documentId: string) => {
    setOpeningFile(documentId);
    setFileError(null);
    try {
      const result = await getDocumentUrlAction(documentId, "download");
      if (!result.ok) {
        setFileError(result.error.message);
        return;
      }
      window.open(result.data.url, "_blank", "noopener,noreferrer");
    } finally {
      setOpeningFile(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          <CardTitle>{t.tasks.workflow.submissionHistory}</CardTitle>
        </div>
        <CardDescription>
          {task.submissionVersion > 0
            ? fmt(t.tasks.workflow.version, { version: String(task.submissionVersion) })
            : t.tasks.workflow.noSubmissions}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {history.submissions.length > 0 ? (
          <ol className="space-y-4">
            {history.submissions.map((submission) => {
              const reviews = history.reviews.filter((review) => review.submissionId === submission.id);
              return (
                <li key={submission.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {fmt(t.tasks.workflow.version, { version: String(submission.version) })}
                      {submission.id === task.latestSubmissionId ? ` · ${t.tasks.workflow.latest}` : ""}
                    </p>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 className="size-3.5" aria-hidden />
                      {fmt(t.tasks.workflow.submittedAt, { date: new Date(submission.createdAt).toLocaleString() })}
                    </span>
                  </div>
                  <p dir="auto" className="mt-3 text-sm whitespace-pre-wrap">
                    {submission.notes}
                  </p>
                  {submission.documents.length ? (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {submission.documents.map((document) => (
                        <li key={document.id}>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={openingFile === document.id}
                            onClick={() => void openFile(document.id)}
                          >
                            {openingFile === document.id ? (
                              <Loader2 className="animate-spin" aria-hidden />
                            ) : (
                              <FileText aria-hidden />
                            )}
                            <span className="max-w-48 truncate">{document.title || document.fileName}</span>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {reviews.map((review) => (
                    <div key={review.id} className="mt-4 rounded-md bg-muted/60 p-3 text-sm">
                      <p className="font-medium">{t.taskStatus[review.decision]}</p>
                      {review.feedback ? (
                        <p dir="auto" className="mt-1 whitespace-pre-wrap">
                          {review.feedback}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </li>
              );
            })}
          </ol>
        ) : null}

        {fileError ? (
          <p className="text-sm text-destructive" role="alert">
            {fileError}
          </p>
        ) : null}

        {canSubmit ? (
          <section className="space-y-3 border-t pt-4">
            <label htmlFor="submission-notes" className="text-sm font-medium">
              {t.tasks.workflow.submitNotes}
            </label>
            <p className="text-xs text-muted-foreground">{t.tasks.workflow.submissionNotesHint}</p>
            <Textarea
              id="submission-notes"
              value={notes}
              maxLength={10000}
              onChange={(event) => setNotes(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <UploadDocumentDialog
                projectId={task.projectId}
                taskId={task.id}
                onUploaded={(id) => setDocumentIds((current) => [...new Set([...current, id])])}
              />
              <Button type="button" disabled={pending || notes.trim().length === 0} onClick={() => void submit()}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                {t.tasks.workflow.submitWork}
              </Button>
            </div>
            {documentIds.length ? (
              <p className="text-xs text-muted-foreground">
                {fmt(t.tasks.workflow.selectedFiles, { count: String(documentIds.length) })}
              </p>
            ) : null}
          </section>
        ) : null}

        {canReview && task.status === "submitted" ? (
          <div className="border-t pt-4">
            <Button type="button" disabled={pending} onClick={() => void startReview()}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Clock3 aria-hidden />}
              {t.tasks.workflow.startReview}
            </Button>
          </div>
        ) : null}

        {canReview && task.status === "review" && task.latestSubmissionId ? (
          <section className="space-y-3 border-t pt-4">
            <label htmlFor="review-feedback" className="text-sm font-medium">
              {t.tasks.workflow.reviewFeedback}
            </label>
            <Textarea
              id="review-feedback"
              value={feedback}
              maxLength={10000}
              placeholder={t.tasks.workflow.feedbackRequired}
              onChange={(event) => setFeedback(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending} onClick={() => void decide("approved")}>
                <Check aria-hidden />
                {t.tasks.workflow.approveSubmission}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending || feedback.trim().length < 3}
                onClick={() => void decide("revision_required")}
              >
                <MessageSquareReply aria-hidden />
                {t.tasks.workflow.requestRevision}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending || feedback.trim().length < 3}
                onClick={() => void decide("rejected")}
              >
                <X aria-hidden />
                {t.tasks.workflow.rejectSubmission}
              </Button>
            </div>
          </section>
        ) : null}

        {canReview && task.status === "approved" ? (
          <div className="border-t pt-4">
            <Button
              type="button"
              disabled={pending}
              onClick={async () => {
                const result = await perform(() => completeApprovedTaskAction(task.id));
                if (result) toast.success(t.tasks.workflow.taskCompleted);
              }}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              {t.tasks.workflow.markCompleted}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
