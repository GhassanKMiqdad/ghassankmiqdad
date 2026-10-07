"use client";

import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";

import { applyFieldErrors, useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { taskProgressSchema, type TaskProgressInput } from "@/lib/validation/task";
import { updateTaskProgressAction } from "@/server/actions/tasks";

/** Progress and work notes: editable by the responsible member (and supervisors). */
export function TaskExecutionCard({
  taskId,
  progress,
  workNotes,
  editable,
}: {
  taskId: string;
  progress: number;
  workNotes: string;
  editable: boolean;
}) {
  const { t, message, number } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  const form = useForm<TaskProgressInput>({
    resolver: zodResolver(taskProgressSchema),
    defaultValues: { progress, workNotes },
  });
  const current = Number(useWatch({ control: form.control, name: "progress" })) || 0;

  if (!editable) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Progress value={progress} aria-label={t.tasks.fields.progress} />
          <span className="w-12 text-end text-sm tabular-nums">{number(progress)}%</span>
        </div>
        <p dir="auto" className="text-start text-sm whitespace-pre-wrap text-muted-foreground">
          {workNotes || "—"}
        </p>
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async () => {
    const result = await run(() => updateTaskProgressAction(taskId, form.getValues()), {
      success: t.workflow.progressSaved,
    });
    if (result?.ok) router.refresh();
    else applyFieldErrors(result, form.setError);
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="progress"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.tasks.fields.progress}</FormLabel>
              <div className="flex items-center gap-3">
                <FormControl>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    className="h-2 w-full cursor-pointer accent-primary"
                    aria-label={t.tasks.fields.progress}
                    {...field}
                    value={Number(field.value) || 0}
                  />
                </FormControl>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="w-20 tabular-nums"
                  aria-label={t.tasks.fields.progress}
                  value={current}
                  onChange={(event) => field.onChange(event.target.value)}
                />
              </div>
              <FormMessage localize={message} />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="workNotes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.tasks.fields.workNotes}</FormLabel>
              <FormControl>
                <Textarea rows={4} placeholder={t.tasks.placeholders.workNotes} {...field} />
              </FormControl>
              <FormMessage localize={message} />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {t.workflow.saveProgress}
          </Button>
        </div>
      </form>
    </Form>
  );
}
