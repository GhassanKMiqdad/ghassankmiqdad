"use client";

import { ExternalLink, FileCheck2 } from "lucide-react";

import { DateText } from "@/components/shared/date-text";
import { TaskFileList } from "@/components/tasks/task-file-list";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { SubmissionItem, TaskFileItem } from "@/types/app";

const STATUS_VARIANT = {
  submitted: "warning",
  under_review: "warning",
  revision_required: "destructive",
  approved: "success",
} as const;

/** Every version, newest first, with the reviews it received. Private to supervisors and the responsible member. */
export function SubmissionHistory({ submissions, files }: { submissions: SubmissionItem[]; files: TaskFileItem[] }) {
  const { t, fmt, date } = useI18n();
  if (submissions.length === 0) return <p className="text-sm text-muted-foreground">{t.submissions.empty}</p>;

  return (
    <ol className="space-y-4">
      {submissions.map((submission) => (
        <li
          key={submission.id}
          className={cn("rounded-lg border p-4", submission.isFinal && "border-success/40 bg-success/5")}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{fmt(t.submissions.version, { version: submission.version })}</span>
            <Badge variant={STATUS_VARIANT[submission.status]}>{t.submissions.status[submission.status]}</Badge>
            {submission.isFinal ? (
              <Badge variant="success" className="gap-1">
                <FileCheck2 aria-hidden />
                {t.submissions.final}
              </Badge>
            ) : null}
            <span className="ms-auto text-xs text-muted-foreground">
              {submission.submittedBy
                ? `${fmt(t.submissions.submittedBy, { name: submission.submittedBy.name })} · `
                : ""}
              <DateText value={submission.submittedAt} style="datetime" />
            </span>
          </div>
          <p dir="auto" className="mt-3 text-start text-sm whitespace-pre-wrap">
            {submission.summary}
          </p>
          {submission.links.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {submission.links.map((link) => (
                <li key={link}>
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    dir="ltr"
                    className="inline-flex max-w-full items-center gap-1 truncate text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{link}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {submission.documentIds.length > 0 ? (
            <div className="mt-2">
              <TaskFileList files={files.filter((file) => submission.documentIds.includes(file.id))} />
            </div>
          ) : null}
          {submission.notes ? (
            <p dir="auto" className="mt-2 text-start text-xs whitespace-pre-wrap text-muted-foreground">
              {submission.notes}
            </p>
          ) : null}
          {submission.reviews.map((review) => (
            <div
              key={review.id}
              className="mt-3 space-y-1.5 rounded-md border-s-4 border-s-primary/40 bg-muted/40 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={review.decision === "approved" ? "success" : "destructive"}>
                  {t.submissions.decision[review.decision]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {review.reviewer ? `${fmt(t.submissions.reviewBy, { name: review.reviewer.name })} · ` : ""}
                  <DateText value={review.createdAt} style="datetime" />
                </span>
              </div>
              {review.comment ? (
                <p dir="auto" className="text-start whitespace-pre-wrap">
                  {review.comment}
                </p>
              ) : null}
              {review.requiredChanges ? (
                <p dir="auto" className="text-start whitespace-pre-wrap">
                  <span className="font-medium">{t.workflow.requiredChanges}: </span>
                  {review.requiredChanges}
                </p>
              ) : null}
              {review.additionalInstructions ? (
                <p dir="auto" className="text-start whitespace-pre-wrap">
                  <span className="font-medium">{t.workflow.additionalInstructions}: </span>
                  {review.additionalInstructions}
                </p>
              ) : null}
              {review.newDueAt ? (
                <p className="text-xs font-medium text-warning-foreground dark:text-warning">
                  {fmt(t.submissions.deadlineChanged, { date: date(review.newDueAt, "datetime") })}
                </p>
              ) : null}
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}
