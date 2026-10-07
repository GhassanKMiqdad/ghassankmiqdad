"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Flag,
  Info,
  Loader2,
  Target,
  UserRound,
} from "lucide-react";

import { PriorityBadge, TaskCode } from "@/components/shared/badges";
import { applyFieldErrors, useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { fromAccessDTO, type ProjectAccessDTO } from "@/lib/permissions/access";
import { DURATION_UNITS, TASK_PRIORITIES } from "@/lib/permissions/catalog";
import { canAssignTasks, canEditTaskContent, canEditTaskSchedule, type TaskSnapshot } from "@/lib/permissions/policy";
import { calculateDueAt, isoToZonedLocal, taskCodePrefix, zonedLocalToIso } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { taskFormSchema, type TaskFormInput, type TaskFormValues } from "@/lib/validation/task";
import { createTaskAction, updateTaskAction } from "@/server/actions/tasks";
import type { MemberOption, TaskDetails } from "@/types/app";

const UNASSIGNED = "__unassigned__";
const NO_WEEK = "__none__";
const ROSTER_PREFIX = "roster:";

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Info;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-primary" aria-hidden />
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

/**
 * Task assignment form (Director / Team Lead). Fields the user may not change
 * are disabled; the database enforces the same rules (members can never
 * change the plan or the schedule). The deadline is previewed here and
 * calculated by the database.
 */
export function TaskEditor({
  projectId,
  projectName,
  teamName,
  access,
  members,
  task,
}: {
  projectId: string;
  projectName: string;
  teamName: string | null;
  access: ProjectAccessDTO;
  members: MemberOption[];
  task?: TaskDetails;
}) {
  const i18n = useI18n();
  const { t, fmt, message, timeZone } = i18n;
  const router = useRouter();
  const { pending, run } = useServerAction();
  const [step, setStep] = useState<"edit" | "summary">("edit");
  const subject = useMemo(() => fromAccessDTO(access), [access]);

  const snapshot: TaskSnapshot = task
    ? { createdBy: task.createdById, assignedTo: task.assignedToId, status: task.status }
    : { createdBy: subject.userId, assignedTo: null, status: "not_started" };
  const contentEditable = task ? canEditTaskContent(subject, snapshot) : true;
  const scheduleEditable = canEditTaskSchedule(subject, snapshot);
  const assignable = canAssignTasks(subject);
  const assigneeOptions = assignable
    ? members
    : members.filter((member) => member.id === subject.userId || member.id === task?.assignedToId);

  const form = useForm<TaskFormInput, unknown, TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      taskCode: "",
      title: task?.title ?? "",
      description: task?.description ?? "",
      originalInstructions: task?.originalInstructions ?? "",
      expectedOutput: task?.expectedOutput ?? "",
      completionCriteria: task?.completionCriteria ?? "",
      assignedTo: task?.assignedToId ?? "",
      responsibleMemberId: task?.assignedToId ? "" : (task?.responsibleMemberId ?? ""),
      priority: task?.priority ?? "p2",
      planningMonth: task?.planningMonth ?? 1,
      planningWeek: task?.planningWeek ?? "",
      plannedStart: isoToZonedLocal(task?.plannedStartAt, timeZone),
      plannedDuration: task?.plannedDuration ?? "",
      durationUnit: task?.durationUnit ?? "days",
      dueOverride: task?.dueAtOverridden ?? false,
      dueAt: task?.dueAtOverridden ? isoToZonedLocal(task.dueAt, timeZone) : "",
    },
  });

  const watched = useWatch({ control: form.control });
  const selectedMember = members.find((member) =>
    watched.assignedTo ? member.id === watched.assignedTo : member.pending && member.id === watched.responsibleMemberId,
  );
  const durationNumber = Number(watched.plannedDuration);
  const startIso = watched.plannedStart ? zonedLocalToIso(watched.plannedStart, timeZone) : null;
  const calculatedDue =
    startIso && durationNumber > 0 && watched.durationUnit
      ? calculateDueAt(startIso, durationNumber, watched.durationUnit)
      : null;
  const effectiveDue = watched.dueOverride
    ? watched.dueAt
      ? zonedLocalToIso(watched.dueAt, timeZone)
      : null
    : calculatedDue;
  const codePreview = `${taskCodePrefix(
    Number(watched.planningMonth) || 1,
    selectedMember?.code ?? null,
    watched.planningWeek ? Number(watched.planningWeek) : null,
  )}…`;

  const toSummary = form.handleSubmit(() => setStep("summary"));

  // The server action re-validates the raw form values (never the client-parsed output).
  const onConfirm = form.handleSubmit(async () => {
    const values = form.getValues();
    if (task) {
      const result = await run(() => updateTaskAction(task.id, values), { success: t.tasks.updated });
      if (result?.ok) {
        router.push(`/projects/${projectId}/tasks/${task.id}`);
        router.refresh();
      } else {
        setStep("edit");
        applyFieldErrors(result, form.setError);
      }
      return;
    }
    const result = await run(() => createTaskAction(projectId, values));
    if (result?.ok) {
      const { toast } = await import("sonner");
      toast.success(fmt(t.tasks.created, { code: result.data.code }));
      router.push(`/projects/${projectId}/tasks/${result.data.taskId}`);
      router.refresh();
    } else {
      setStep("edit");
      applyFieldErrors(result, form.setError);
    }
  });

  const backHref = task ? `/projects/${projectId}/tasks/${task.id}` : `/projects/${projectId}/tasks`;

  if (step === "summary") {
    const values = form.getValues();
    const rows: [string, React.ReactNode][] = [
      [
        t.tasks.fields.taskCode,
        task ? (
          <TaskCode code={task.code} />
        ) : values.taskCode ? (
          <TaskCode code={String(values.taskCode).toUpperCase()} />
        ) : (
          <TaskCode code={codePreview} />
        ),
      ],
      [
        t.tasks.fields.title,
        <span key="title" dir="auto">
          {values.title}
        </span>,
      ],
      [t.tasks.fields.project, `${projectName}${teamName ? ` · ${teamName}` : ""}`],
      [
        t.tasks.fields.assignee,
        selectedMember
          ? `${selectedMember.name}${selectedMember.jobTitle ? ` — ${selectedMember.jobTitle}` : ""}${
              selectedMember.pending ? ` (${t.tasks.pendingAccount})` : ""
            }`
          : t.tasks.unassigned,
      ],
      [
        t.tasks.fields.planningWeek,
        values.planningWeek
          ? fmt(t.tasks.planLabel, {
              month: String(values.planningMonth).padStart(2, "0"),
              week: String(values.planningWeek),
            })
          : fmt(t.tasks.planMonthOnly, { month: String(values.planningMonth).padStart(2, "0") }),
      ],
      [t.tasks.fields.priority, <PriorityBadge key="priority" priority={values.priority ?? "p2"} />],
      [t.tasks.fields.plannedStart, startIso ? i18n.date(startIso, "datetime") : t.tasks.scheduleNotDefined],
      [
        t.tasks.fields.duration,
        durationNumber > 0 && values.durationUnit
          ? fmt(t.tasks.durationValue, {
              value: i18n.number(durationNumber),
              unit: (durationNumber === 1 ? t.durationUnitsOne : t.durationUnits)[values.durationUnit],
            })
          : "—",
      ],
      [t.tasks.fields.dueAt, effectiveDue ? i18n.date(effectiveDue, "datetime") : t.tasks.scheduleNotDefined],
      [
        t.tasks.fields.expectedOutput,
        <span key="expected" dir="auto" className="whitespace-pre-wrap">
          {values.expectedOutput || "—"}
        </span>,
      ],
      [
        t.tasks.fields.completionCriteria,
        <span key="criteria" dir="auto" className="whitespace-pre-wrap">
          {values.completionCriteria || "—"}
        </span>,
      ],
    ];
    return (
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="size-5 text-primary" aria-hidden />
            {t.tasks.summaryTitle}
          </CardTitle>
          <CardDescription>{t.tasks.summaryDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="divide-y rounded-lg border">
            {rows.map(([label, value]) => (
              <div key={label} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-3 sm:gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="sm:col-span-2">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t.tasks.hints.privateUntilCompleted}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setStep("edit")} disabled={pending}>
              {t.tasks.backToEdit}
            </Button>
            <Button type="button" onClick={onConfirm} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}
              {task ? t.tasks.confirmSave : t.tasks.confirmCreate}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={toSummary} className="mx-auto max-w-3xl space-y-6" noValidate>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t.common.back}
        </Link>

        <Section icon={Info} title={t.tasks.sections.basic}>
          {task ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t.tasks.fields.taskCode}</span>
              <TaskCode code={task.code} />
            </div>
          ) : (
            <FormField
              control={form.control}
              name="taskCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t.tasks.fields.taskCode} <span className="text-muted-foreground">({t.common.optional})</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      dir="ltr"
                      className="font-mono uppercase"
                      placeholder={codePreview}
                      disabled={!scheduleEditable}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormDescription>{t.tasks.hints.taskCode}</FormDescription>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.tasks.fields.title}</FormLabel>
                <FormControl>
                  <Input placeholder={t.tasks.placeholders.title} disabled={!contentEditable} {...field} />
                </FormControl>
                <FormMessage localize={message} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.tasks.fields.description}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    placeholder={t.tasks.placeholders.description}
                    disabled={!contentEditable}
                    {...field}
                  />
                </FormControl>
                <FormMessage localize={message} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="originalInstructions"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.tasks.fields.originalInstructions}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    placeholder={t.tasks.placeholders.originalInstructions}
                    disabled={!contentEditable}
                    {...field}
                  />
                </FormControl>
                <FormMessage localize={message} />
              </FormItem>
            )}
          />
        </Section>

        <Section icon={UserRound} title={t.tasks.sections.assignment}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="assignedTo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.tasks.fields.assignee}</FormLabel>
                  <Select
                    value={
                      field.value
                        ? field.value
                        : watched.responsibleMemberId
                          ? `${ROSTER_PREFIX}${watched.responsibleMemberId}`
                          : UNASSIGNED
                    }
                    onValueChange={(value) => {
                      // A roster member without an account: plan the task for their roster entry.
                      if (value.startsWith(ROSTER_PREFIX)) {
                        field.onChange("");
                        form.setValue("responsibleMemberId", value.slice(ROSTER_PREFIX.length));
                      } else {
                        field.onChange(value === UNASSIGNED ? "" : value);
                        form.setValue("responsibleMemberId", "");
                      }
                    }}
                    disabled={!assignable}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>{t.tasks.unassigned}</SelectItem>
                      {assigneeOptions.map((member) => (
                        <SelectItem key={member.id} value={member.pending ? `${ROSTER_PREFIX}${member.id}` : member.id}>
                          {member.code ? `${member.code} · ` : ""}
                          {member.name}
                          {member.jobTitle ? ` — ${member.jobTitle}` : ""}
                          {member.pending ? ` (${t.tasks.pendingAccount})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {members.length === 0 ? <FormDescription>{t.tasks.hints.noMembers}</FormDescription> : null}
                  {!field.value && watched.responsibleMemberId ? (
                    <FormDescription>{t.tasks.pendingAccountHint}</FormDescription>
                  ) : null}
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <div className="space-y-2 text-sm">
              <p className="font-medium">{t.tasks.fields.project}</p>
              <p className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-muted-foreground">
                {projectName}
                {teamName ? ` · ${teamName}` : ""}
              </p>
            </div>
          </div>
        </Section>

        <Section icon={CalendarClock} title={t.tasks.sections.scheduling} description={t.tasks.hints.planning}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="planningMonth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.tasks.fields.planningMonth}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      inputMode="numeric"
                      disabled={!scheduleEditable}
                      {...field}
                      value={field.value as number | string}
                    />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="planningWeek"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.tasks.fields.planningWeek}</FormLabel>
                  <Select
                    value={field.value ? String(field.value) : NO_WEEK}
                    onValueChange={(value) => field.onChange(value === NO_WEEK ? "" : value)}
                    disabled={!scheduleEditable}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_WEEK}>{t.common.none}</SelectItem>
                      {[1, 2, 3, 4, 5].map((week) => (
                        <SelectItem key={week} value={String(week)}>
                          {fmt(t.tasks.week, { week })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="plannedStart"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.tasks.fields.plannedStart}</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      dir="ltr"
                      disabled={!scheduleEditable}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-[1fr_8rem] gap-2">
              <FormField
                control={form.control}
                name="plannedDuration"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.tasks.fields.duration}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        inputMode="decimal"
                        disabled={!scheduleEditable}
                        {...field}
                        value={(field.value as number | string | null) ?? ""}
                      />
                    </FormControl>
                    <FormMessage localize={message} />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="durationUnit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.tasks.fields.durationUnit}</FormLabel>
                    <Select value={field.value ?? "days"} onValueChange={field.onChange} disabled={!scheduleEditable}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {DURATION_UNITS.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {t.durationUnits[unit]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage localize={message} />
                  </FormItem>
                )}
              />
            </div>
          </div>
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
              calculatedDue ? "border-primary/30 bg-primary/5" : "bg-muted/40 text-muted-foreground",
            )}
          >
            <CalendarClock className="size-4 shrink-0" aria-hidden />
            {calculatedDue
              ? fmt(t.tasks.hints.dueCalculated, { date: i18n.date(calculatedDue, "datetime") })
              : startIso || durationNumber > 0
                ? t.tasks.hints.dueNeedsInputs
                : t.tasks.scheduleNotDefined}
          </div>
          <FormField
            control={form.control}
            name="dueOverride"
            render={({ field }) => (
              <FormItem className="flex items-center gap-3 space-y-0">
                <FormControl>
                  <Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={!scheduleEditable} />
                </FormControl>
                <FormLabel className="font-normal">{t.tasks.hints.dueOverride}</FormLabel>
              </FormItem>
            )}
          />
          {watched.dueOverride ? (
            <FormField
              control={form.control}
              name="dueAt"
              render={({ field }) => (
                <FormItem className="sm:max-w-xs">
                  <FormLabel>{t.tasks.fields.dueAt}</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      dir="ltr"
                      disabled={!scheduleEditable}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
          ) : null}
          {!scheduleEditable ? (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {t.tasks.hints.membersCannotChange}
            </p>
          ) : null}
        </Section>

        <Section icon={Flag} title={t.tasks.sections.priority}>
          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="sr-only">{t.tasks.fields.priority}</FormLabel>
                <div
                  role="radiogroup"
                  aria-label={t.tasks.fields.priority}
                  className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                >
                  {TASK_PRIORITIES.map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      role="radio"
                      aria-checked={field.value === priority}
                      disabled={!contentEditable}
                      onClick={() => field.onChange(priority)}
                      className={cn(
                        "flex items-center justify-center rounded-lg border px-3 py-2.5 transition-colors disabled:opacity-60",
                        field.value === priority
                          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <PriorityBadge priority={priority} />
                    </button>
                  ))}
                </div>
                <FormMessage localize={message} />
              </FormItem>
            )}
          />
        </Section>

        <Section icon={Target} title={t.tasks.sections.expected}>
          <FormField
            control={form.control}
            name="expectedOutput"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.tasks.fields.expectedOutput}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    placeholder={t.tasks.placeholders.expectedOutput}
                    disabled={!contentEditable}
                    {...field}
                  />
                </FormControl>
                <FormMessage localize={message} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="completionCriteria"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.tasks.fields.completionCriteria}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    placeholder={t.tasks.placeholders.completionCriteria}
                    disabled={!contentEditable}
                    {...field}
                  />
                </FormControl>
                <FormMessage localize={message} />
              </FormItem>
            )}
          />
        </Section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" asChild>
            <Link href={backHref}>{t.common.cancel}</Link>
          </Button>
          <Button type="submit">
            <ClipboardCheck aria-hidden />
            {t.tasks.reviewSummary}
          </Button>
        </div>
      </form>
    </Form>
  );
}
