"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info, Loader2 } from "lucide-react";

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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { fromAccessDTO, type ProjectAccessDTO } from "@/lib/permissions/access";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskStatus } from "@/lib/permissions/catalog";
import {
  allowedTaskStatuses,
  can,
  canAssignTasks,
  canEditTaskContent,
  type TaskSnapshot,
} from "@/lib/permissions/policy";
import { taskFormSchema, type TaskFormInput, type TaskFormValues } from "@/lib/validation/task";
import { createTaskAction, updateTaskAction } from "@/server/actions/tasks";
import type { MemberOption, TaskDetails } from "@/types/app";

const UNASSIGNED = "__unassigned__";

/**
 * Create / edit dialog. Fields the user may not change are disabled (and the
 * server rejects them anyway): content needs edit rights, the assignee needs
 * tasks.assign, and only allowed status transitions are offered.
 */
export function TaskFormDialog({
  projectId,
  access,
  members,
  task,
  trigger,
  defaultOpen = false,
}: {
  projectId: string;
  access: ProjectAccessDTO;
  members: MemberOption[];
  task?: TaskDetails;
  trigger: ReactNode;
  defaultOpen?: boolean;
}) {
  const { t, message } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const { pending, run } = useServerAction();
  const subject = useMemo(() => fromAccessDTO(access), [access]);

  const snapshot: TaskSnapshot = task
    ? { createdBy: task.createdById, assignedTo: task.assignedToId, status: task.status }
    : { createdBy: subject.userId, assignedTo: null, status: "todo" };
  const editable = task ? canEditTaskContent(subject, snapshot) : can(subject, "tasks.create");
  const assignable = canAssignTasks(subject);
  const statusOptions: TaskStatus[] = task
    ? allowedTaskStatuses(subject, snapshot)
    : TASK_STATUSES.filter((status) => can(subject, "tasks.edit") || (status !== "completed" && status !== "rejected"));

  const assigneeOptions = assignable
    ? members
    : members.filter((member) => member.id === subject.userId || member.id === task?.assignedToId);

  const form = useForm<TaskFormInput, unknown, TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: task?.title ?? "",
      description: task?.description ?? "",
      status: task?.status ?? "todo",
      priority: task?.priority ?? "medium",
      assignedTo: task?.assignedToId ?? "",
      dueDate: task?.dueDate ?? "",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (task) {
      const result = await run(() => updateTaskAction(task.id, values), { success: t.tasks.updated });
      if (result?.ok) setOpen(false);
      else applyFieldErrors(result, form.setError);
    } else {
      const result = await run(() => createTaskAction(projectId, values), { success: t.tasks.created });
      if (result?.ok) {
        setOpen(false);
        form.reset();
        router.refresh();
      } else applyFieldErrors(result, form.setError);
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl" closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{task ? t.tasks.editTitle : t.tasks.createTitle}</DialogTitle>
          {task && !editable ? <DialogDescription>{t.tasks.readOnly}</DialogDescription> : null}
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.tasks.fields.title}</FormLabel>
                  <FormControl>
                    <Input placeholder={t.tasks.placeholders.title} disabled={!editable} {...field} />
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
                    <Textarea rows={4} placeholder={t.tasks.placeholders.description} disabled={!editable} {...field} />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.tasks.fields.status}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={statusOptions.length <= 1}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {statusOptions.map((status) => (
                          <SelectItem key={status} value={status}>
                            {t.taskStatus[status]}
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
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.tasks.fields.priority}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TASK_PRIORITIES.map((priority) => (
                          <SelectItem key={priority} value={priority}>
                            {t.taskPriority[priority]}
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
                name="assignedTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.tasks.fields.assignee}</FormLabel>
                    <Select
                      value={field.value ? field.value : UNASSIGNED}
                      onValueChange={(value) => field.onChange(value === UNASSIGNED ? "" : value)}
                      disabled={task ? !assignable : false}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>{t.tasks.unassigned}</SelectItem>
                        {assigneeOptions.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.id === subject.userId ? `${member.name} (${t.common.you})` : member.name}
                          </SelectItem>
                        ))}
                        {!assignable && !assigneeOptions.some((member) => member.id === subject.userId) ? (
                          <SelectItem value={subject.userId}>{t.tasks.assignToMe}</SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                    <FormMessage localize={message} />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.tasks.fields.dueDate}</FormLabel>
                    <FormControl>
                      <Input type="date" disabled={!editable} {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage localize={message} />
                  </FormItem>
                )}
              />
            </div>
            {!can(subject, "tasks.edit") && !can(subject, "tasks.review") ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t.tasks.workflowHint}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {task ? t.common.saveChanges : t.common.create}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
