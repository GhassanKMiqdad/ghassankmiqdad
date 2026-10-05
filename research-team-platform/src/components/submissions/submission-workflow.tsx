"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, Loader2, RotateCcw, Send } from "lucide-react";

import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import type { SubmissionHistoryItem, SubmittableDocument, TaskDeliverable } from "@/types/research-workflow";
import { createTaskDeliverableAction } from "@/server/actions/deliverables";
import {
  createSubmissionAction,
  reviewSubmissionAction,
  startSubmissionReviewAction,
} from "@/server/actions/submissions";
import { getDocumentUrlAction } from "@/server/actions/documents";

function displayStatus(status: SubmissionHistoryItem["status"], t: ReturnType<typeof useI18n>["t"]): string {
  switch (status) {
    case "submitted":
      return t.taskStatus.submitted;
    case "under_review":
      return t.taskStatus.under_review;
    case "approved":
      return t.taskStatus.approved;
    case "revision_required":
      return t.taskStatus.revision_required;
    case "rejected":
      return t.tasks.workflow.rejected;
  }
}

function SubmissionCard({ item, canReview }: { item: SubmissionHistoryItem; canReview: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  const [feedback, setFeedback] = useState("");
  const latestNeedsReview = item.status === "submitted" || item.status === "under_review";

  async function startReview() {
    const result = await run(() => startSubmissionReviewAction(item.id), { success: t.tasks.workflow.reviewRecorded });
    if (result?.ok) router.refresh();
  }

  async function review(decision: "approved" | "revision_required" | "rejected") {
    const result = await run(() => reviewSubmissionAction({ submissionId: item.id, decision, feedback }), {
      success: t.tasks.workflow.reviewRecorded,
    });
    if (result?.ok) {
      setFeedback("");
      router.refresh();
    }
  }

  async function download(documentId: string) {
    const result = await run(() => getDocumentUrlAction(documentId, "download"));
    if (result?.ok && typeof window !== "undefined") window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-base">
            {t.tasks.workflow.version.replace("{number}", String(item.versionNumber))}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {item.researcherName} · {new Date(item.submittedAt).toLocaleString()}
          </p>
        </div>
        <span className="rounded-full border px-2.5 py-1 text-xs font-medium">{displayStatus(item.status, t)}</span>
      </CardHeader>
      <CardContent className="space-y-4">
        {item.notes ? <p className="text-sm whitespace-pre-wrap">{item.notes}</p> : null}
        {item.files.length ? (
          <ul className="space-y-2 border-t pt-3">
            {item.files.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="block truncate">
                    {file.title} <span className="text-muted-foreground">({file.fileName})</span>
                  </span>
                  {file.deliverableName ? (
                    <span className="block text-xs text-muted-foreground">
                      {t.tasks.workflow.deliveredFor.replace("{name}", file.deliverableName)}
                    </span>
                  ) : null}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={pending}
                  onClick={() => void download(file.id)}
                  aria-label={`${t.common.download} ${file.fileName}`}
                >
                  <Download aria-hidden />
                  {t.common.download}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {item.reviews.length ? (
          <div className="space-y-3 border-t pt-3">
            <h3 className="text-sm font-semibold">{t.tasks.history}</h3>
            {item.reviews.map((reviewItem) => (
              <div key={reviewItem.id} className="rounded-md bg-muted/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
                  <span>{reviewItem.reviewerName}</span>
                  <span>{displayStatus(reviewItem.decision, t)}</span>
                </div>
                {reviewItem.feedback ? <p className="mt-2 text-sm whitespace-pre-wrap">{reviewItem.feedback}</p> : null}
                <p className="mt-2 text-xs text-muted-foreground">{new Date(reviewItem.createdAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        ) : null}
        {canReview && latestNeedsReview ? (
          <div className="space-y-3 border-t pt-4">
            {item.status === "submitted" ? (
              <div className="flex justify-end">
                <Button type="button" disabled={pending} onClick={() => void startReview()}>
                  {t.tasks.workflow.startReview}
                </Button>
              </div>
            ) : (
              <>
                <label className="block space-y-2 text-sm">
                  <span className="font-medium">{t.tasks.workflow.reviewerFeedback}</span>
                  <Textarea
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                    rows={4}
                    maxLength={10000}
                  />
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending || feedback.trim().length < 3}
                    onClick={() => void review("revision_required")}
                  >
                    {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
                    {t.tasks.workflow.requestRevision}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending || feedback.trim().length < 3}
                    onClick={() => void review("rejected")}
                  >
                    {t.tasks.workflow.reject}
                  </Button>
                  <Button type="button" disabled={pending} onClick={() => void review("approved")}>
                    {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                    {t.tasks.workflow.approve}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SubmissionWorkflow({
  taskId,
  submissions,
  documents,
  deliverables,
  canSubmit,
  canReview,
  canManageDeliverables,
}: {
  taskId: string;
  submissions: SubmissionHistoryItem[];
  documents: SubmittableDocument[];
  deliverables: TaskDeliverable[];
  canSubmit: boolean;
  canReview: boolean;
  canManageDeliverables: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [fileLinks, setFileLinks] = useState<Record<string, string>>({});
  const [deliverableName, setDeliverableName] = useState("");
  const [deliverableDescription, setDeliverableDescription] = useState("");
  const [deliverableRequired, setDeliverableRequired] = useState(true);
  const [deliverableType, setDeliverableType] = useState<TaskDeliverable["type"]>("document");
  const [typeError, setTypeError] = useState("");

  const eligibleDeliverables = useMemo(() => deliverables.filter((item) => item.status !== "approved"), [deliverables]);
  const mappedAttachments = selected.flatMap((documentId) => {
    const deliverableId = fileLinks[documentId];
    return deliverableId ? [{ documentId, deliverableId }] : [];
  });
  const unlinkedSelection = selected.some((documentId) => !fileLinks[documentId]);
  const missingRequired = deliverables.some(
    (item) =>
      item.required &&
      item.status !== "approved" &&
      !mappedAttachments.some((attachment) => attachment.deliverableId === item.id),
  );

  async function submit() {
    if (unlinkedSelection || missingRequired) return;
    const result = await run(() => createSubmissionAction(taskId, { notes, attachments: mappedAttachments }), {
      success: t.tasks.workflow.submissionCreated,
    });
    if (result?.ok) {
      setNotes("");
      setSelected([]);
      setFileLinks({});
      router.refresh();
    }
  }

  async function createDeliverable() {
    setTypeError("");
    const result = await run(
      () =>
        createTaskDeliverableAction(taskId, {
          name: deliverableName,
          description: deliverableDescription,
          required: deliverableRequired,
          type: deliverableType,
        }),
      { success: t.tasks.workflow.deliverableCreated },
    );
    if (result?.ok) {
      setDeliverableName("");
      setDeliverableDescription("");
      router.refresh();
    }
  }

  function toggleDocument(documentId: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...new Set([...current, documentId])] : current.filter((id) => id !== documentId),
    );
    if (!checked) {
      setFileLinks((current) => {
        const next = { ...current };
        delete next[documentId];
        return next;
      });
    } else if (eligibleDeliverables.length === 1) {
      setFileLinks((current) => ({ ...current, [documentId]: eligibleDeliverables[0].id }));
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.tasks.workflow.deliverablesTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {deliverables.length ? (
            <ul className="space-y-2">
              {deliverables.map((item) => (
                <li key={item.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {item.name}
                      {item.required ? ` · ${t.tasks.workflow.required}` : ""}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {item.status === "pending"
                        ? t.tasks.workflow.pending
                        : item.status === "submitted"
                          ? t.taskStatus.submitted
                          : item.status === "revision_required"
                            ? t.taskStatus.revision_required
                            : t.taskStatus.approved}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{item.description}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">{item.type}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t.tasks.workflow.noDeliverables}</p>
          )}

          {canManageDeliverables ? (
            <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>{t.tasks.workflow.deliverableName}</span>
                <Input
                  value={deliverableName}
                  onChange={(event) => setDeliverableName(event.target.value)}
                  maxLength={160}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>{t.tasks.workflow.deliverableType}</span>
                <select
                  value={deliverableType}
                  onChange={(event) => setDeliverableType(event.target.value as TaskDeliverable["type"])}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {(["document", "dataset", "report", "code", "other"] as const).map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span>{t.tasks.workflow.deliverableDescription}</span>
                <Textarea
                  value={deliverableDescription}
                  onChange={(event) => setDeliverableDescription(event.target.value)}
                  rows={2}
                  maxLength={2000}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={deliverableRequired}
                  onCheckedChange={(checked) => setDeliverableRequired(checked === true)}
                />
                {t.tasks.workflow.required}
              </label>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={pending || deliverableName.trim().length < 2}
                  onClick={() => void createDeliverable()}
                >
                  {t.tasks.workflow.createDeliverable}
                </Button>
              </div>
              {typeError ? (
                <p role="alert" className="text-sm text-destructive">
                  {typeError}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canSubmit ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.tasks.workflow.submissionTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-2 text-sm">
              <span className="font-medium">{t.tasks.workflow.submissionNotes}</span>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                maxLength={10000}
                dir="auto"
              />
            </label>
            {documents.length ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t.tasks.workflow.attachFiles}</legend>
                {documents.map((document) => (
                  <div key={document.id} className="space-y-2 rounded-md border p-3 text-sm">
                    <label className="flex items-start gap-3">
                      <Checkbox
                        checked={selected.includes(document.id)}
                        onCheckedChange={(checked) => toggleDocument(document.id, checked === true)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{document.title}</span>
                        <span className="text-muted-foreground">{document.fileName}</span>
                      </span>
                    </label>
                    {selected.includes(document.id) ? (
                      <label className="block space-y-1 text-sm">
                        <span>{t.tasks.workflow.linkToDeliverable}</span>
                        <select
                          value={fileLinks[document.id] ?? ""}
                          onChange={(event) =>
                            setFileLinks((current) => ({ ...current, [document.id]: event.target.value }))
                          }
                          className="h-10 w-full rounded-md border bg-background px-3"
                        >
                          <option value="">{t.tasks.workflow.selectDeliverable}</option>
                          {eligibleDeliverables.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                ))}
              </fieldset>
            ) : (
              <p className="text-sm text-muted-foreground">{t.tasks.workflow.uploadHint}</p>
            )}
            {unlinkedSelection ? <p className="text-sm text-destructive">{t.tasks.workflow.unlinkedFiles}</p> : null}
            {missingRequired ? (
              <p className="text-sm text-destructive">{t.tasks.workflow.requiredDeliverablesMissing}</p>
            ) : null}
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => void submit()}
                disabled={
                  pending ||
                  selected.length > 10 ||
                  (!notes.trim() && selected.length === 0) ||
                  unlinkedSelection ||
                  missingRequired
                }
              >
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                {t.tasks.workflow.submitVersion}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t.tasks.workflow.historyTitle}</h2>
        {submissions.length ? (
          submissions.map((item) => <SubmissionCard key={item.id} item={item} canReview={canReview} />)
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t.tasks.workflow.noSubmissions}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
