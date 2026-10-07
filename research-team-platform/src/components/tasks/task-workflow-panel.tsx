"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Ban,
  CheckCheck,
  CircleSlash,
  Eye,
  Loader2,
  Megaphone,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Undo2,
} from "lucide-react";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { applyFieldErrors, useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { fromAccessDTO, type ProjectAccessDTO } from "@/lib/permissions/access";
import type { TaskStatus } from "@/lib/permissions/catalog";
import {
  canChangeTaskStatus,
  canExecuteTask,
  canReviewTask,
  canSubmitTask,
  canSuperviseTasks,
  type TaskSnapshot,
} from "@/lib/permissions/policy";
import {
  completeTaskSchema,
  reviewTaskSchema,
  submitTaskSchema,
  type CompleteTaskInput,
  type ReviewTaskInput,
  type SubmitTaskInput,
  type SubmitTaskValues,
} from "@/lib/validation/task";
import {
  changeTaskStatusAction,
  completeTaskAction,
  reviewTaskAction,
  startTaskReviewAction,
  submitTaskAction,
} from "@/server/actions/tasks";

type WorkflowTask = TaskSnapshot & { id: string; isBlocked: boolean; hasSubmissions: boolean };

/**
 * The actions offered here are exactly the ones the policy (and the
 * database) allows for this user and status; everything else is not shown.
 */
export function TaskWorkflowPanel({ task, access }: { task: WorkflowTask; access: ProjectAccessDTO }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  const subject = useMemo(() => fromAccessDTO(access), [access]);

  const executor = canExecuteTask(subject, task);
  const supervisor = canSuperviseTasks(subject);
  const reviewer = canReviewTask(subject, task);
  const can = (status: TaskStatus) => canChangeTaskStatus(subject, task, status);

  const changeStatus = async (status: TaskStatus, success: string) => {
    const result = await run(() => changeTaskStatusAction(task.id, { status }), { success });
    if (result?.ok) router.refresh();
    return !!result?.ok;
  };

  const actions: ReactNode[] = [];

  if (["not_started", "scheduled"].includes(task.status) && can("in_progress") && !task.isBlocked) {
    actions.push(
      <Button key="start" onClick={() => changeStatus("in_progress", t.workflow.started)} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
        {t.workflow.start}
      </Button>,
    );
  }
  if (task.status === "revision_required" && can("in_progress")) {
    actions.push(
      <Button key="resume" variant="outline" onClick={() => changeStatus("in_progress", t.workflow.started)} disabled={pending}>
        <RotateCcw aria-hidden />
        {t.workflow.resume}
      </Button>,
    );
  }
  if (canSubmitTask(subject, task)) {
    actions.push(<SubmitDialog key="submit" taskId={task.id} resubmit={task.hasSubmissions} />);
  }
  if (reviewer && task.status === "submitted") {
    actions.push(
      <Button
        key="start-review"
        variant="outline"
        disabled={pending}
        onClick={async () => {
          const result = await run(() => startTaskReviewAction(task.id), { success: t.workflow.reviewStarted });
          if (result?.ok) router.refresh();
        }}
      >
        <Eye aria-hidden />
        {t.workflow.startReview}
      </Button>,
    );
  }
  if (reviewer && (task.status === "submitted" || task.status === "under_review")) {
    actions.push(<ReviewDialog key="review" taskId={task.id} />);
  }
  if (reviewer && task.status === "approved") {
    actions.push(<CompleteDialog key="complete" taskId={task.id} />);
  }
  if (task.status === "blocked" && can("in_progress")) {
    actions.push(
      <Button key="unblock" variant="outline" onClick={() => changeStatus("in_progress", fmt(t.workflow.statusChanged, { status: t.taskStatus.in_progress }))} disabled={pending}>
        <Undo2 aria-hidden />
        {t.workflow.unblock}
      </Button>,
    );
  }
  if (supervisor && can("blocked") && task.status !== "blocked") {
    actions.push(
      <Button key="block" variant="ghost" onClick={() => changeStatus("blocked", fmt(t.workflow.statusChanged, { status: t.taskStatus.blocked }))} disabled={pending}>
        <CircleSlash aria-hidden />
        {t.workflow.block}
      </Button>,
    );
  }
  if (task.status === "cancelled" && can("not_started")) {
    actions.push(
      <Button key="reopen" variant="outline" onClick={() => changeStatus("not_started", fmt(t.workflow.statusChanged, { status: t.taskStatus.not_started }))} disabled={pending}>
        <RotateCcw aria-hidden />
        {t.workflow.reopen}
      </Button>,
    );
  }
  if (supervisor && can("cancelled") && task.status !== "cancelled") {
    actions.push(
      <ConfirmDialog
        key="cancel"
        trigger={
          <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={pending}>
            <Ban aria-hidden />
            {t.workflow.cancel}
          </Button>
        }
        title={t.workflow.cancel}
        description={t.workflow.cancelConfirm}
        confirmLabel={t.workflow.cancel}
        onConfirm={() => changeStatus("cancelled", fmt(t.workflow.statusChanged, { status: t.taskStatus.cancelled }))}
      />,
    );
  }

  const hint = (() => {
    if (task.status === "completed" || task.status === "cancelled") return t.workflow.closed;
    if (task.isBlocked && ["not_started", "scheduled"].includes(task.status)) return t.workflow.blockedByDependencies;
    if (task.status === "approved") return reviewer ? null : t.workflow.waitingForCompletion;
    if (task.status === "submitted" || task.status === "under_review") {
      if (reviewer) return null;
      return t.workflow.waitingForReview;
    }
    if (!executor && ["not_started", "scheduled", "in_progress", "revision_required"].includes(task.status)) {
      return t.workflow.waitingForMember;
    }
    return null;
  })();

  const selfReview =
    !reviewer &&
    task.assignedTo === subject.userId &&
    subject.permissions.has("tasks.review") &&
    ["submitted", "under_review", "approved"].includes(task.status);

  return (
    <div className="space-y-3">
      {actions.length > 0 ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {selfReview ? <p className="text-xs text-muted-foreground">{t.workflow.selfReviewNotice}</p> : null}
      {actions.length === 0 && !hint ? <p className="text-sm text-muted-foreground">{t.workflow.noActions}</p> : null}
    </div>
  );
}

function SubmitDialog({ taskId, resubmit }: { taskId: string; resubmit: boolean }) {
  const { t, fmt, message } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  const form = useForm<SubmitTaskInput, unknown, SubmitTaskValues>({
    resolver: zodResolver(submitTaskSchema),
    defaultValues: { summary: "", links: "", notes: "" },
  });

  const onSubmit = form.handleSubmit(async () => {
    const result = await run(() => submitTaskAction(taskId, form.getValues()));
    if (result?.ok) {
      const { toast } = await import("sonner");
      toast.success(fmt(t.workflow.submitted, { version: result.data.version }));
      setOpen(false);
      form.reset();
      router.refresh();
    } else applyFieldErrors(result, form.setError);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Send aria-hidden />
          {resubmit ? t.workflow.resubmit : t.workflow.submit}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{resubmit ? t.workflow.resubmitTitle : t.workflow.submitTitle}</DialogTitle>
          <DialogDescription>{t.workflow.submitDescription}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="summary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.workflow.summary}</FormLabel>
                  <FormControl>
                    <Textarea rows={5} placeholder={t.workflow.summaryPlaceholder} {...field} />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="links"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.workflow.links}</FormLabel>
                  <FormControl>
                    <Textarea rows={3} dir="ltr" placeholder="https://" {...field} />
                  </FormControl>
                  <FormDescription>{t.workflow.linksHint}</FormDescription>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t.workflow.notes} <span className="text-muted-foreground">({t.common.optional})</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                {resubmit ? t.workflow.resubmit : t.workflow.submit}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({ taskId }: { taskId: string }) {
  const { t, message } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  const form = useForm<ReviewTaskInput>({
    resolver: zodResolver(reviewTaskSchema),
    defaultValues: { decision: "approved", comment: "", requiredChanges: "", additionalInstructions: "", newDueAt: "" },
  });
  const decision = form.watch("decision");

  const onSubmit = form.handleSubmit(async () => {
    const values = form.getValues();
    const result = await run(() => reviewTaskAction(taskId, values), {
      success: values.decision === "approved" ? t.workflow.approved : t.workflow.revisionRequested,
    });
    if (result?.ok) {
      setOpen(false);
      form.reset();
      router.refresh();
    } else applyFieldErrors(result, form.setError);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <ShieldCheck aria-hidden />
          {t.workflow.review}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{t.workflow.reviewTitle}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="decision"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.workflow.decision}</FormLabel>
                  <div role="radiogroup" aria-label={t.workflow.decision} className="grid grid-cols-2 gap-2">
                    {(["approved", "revision_required"] as const).map((value) => (
                      <Button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={field.value === value}
                        variant={field.value === value ? (value === "approved" ? "default" : "destructive") : "outline"}
                        onClick={() => field.onChange(value)}
                      >
                        {value === "approved" ? t.workflow.approve : t.workflow.requestRevision}
                      </Button>
                    ))}
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="comment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.workflow.comment}</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            {decision === "revision_required" ? (
              <>
                <FormField
                  control={form.control}
                  name="requiredChanges"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.workflow.requiredChanges}</FormLabel>
                      <FormControl>
                        <Textarea rows={3} {...field} />
                      </FormControl>
                      <FormMessage localize={message} />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="additionalInstructions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.workflow.additionalInstructions}</FormLabel>
                      <FormControl>
                        <Textarea rows={2} {...field} />
                      </FormControl>
                      <FormMessage localize={message} />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="newDueAt"
                  render={({ field }) => (
                    <FormItem className="sm:max-w-xs">
                      <FormLabel>{t.workflow.newDeadline}</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" dir="ltr" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage localize={message} />
                    </FormItem>
                  )}
                />
              </>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={pending} variant={decision === "approved" ? "default" : "destructive"}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCheck aria-hidden />}
                {decision === "approved" ? t.workflow.approve : t.workflow.requestRevision}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({ taskId }: { taskId: string }) {
  const { t, message } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  const form = useForm<CompleteTaskInput>({
    resolver: zodResolver(completeTaskSchema),
    defaultValues: { teamComment: "" },
  });

  const onSubmit = form.handleSubmit(async () => {
    const result = await run(() => completeTaskAction(taskId, form.getValues()), { success: t.workflow.completed });
    if (result?.ok) {
      setOpen(false);
      router.refresh();
    } else applyFieldErrors(result, form.setError);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-success text-success-foreground hover:bg-success/90">
          <Megaphone aria-hidden />
          {t.workflow.markCompleted}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{t.workflow.completeTitle}</DialogTitle>
          <DialogDescription>{t.workflow.completeDescription}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="teamComment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.workflow.teamComment}</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={pending} className="bg-success text-success-foreground hover:bg-success/90">
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Megaphone aria-hidden />}
                {t.workflow.markCompleted}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
