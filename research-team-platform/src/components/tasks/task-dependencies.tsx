"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Hourglass, Loader2, Plus, X } from "lucide-react";

import { TaskCode, TaskStatusBadge } from "@/components/shared/badges";
import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/provider";
import { addTaskDependencyAction, removeTaskDependencyAction } from "@/server/actions/tasks";
import type { DependencyItem, TaskOption } from "@/types/app";

export function TaskDependencies({
  projectId,
  taskId,
  dependencies,
  options,
  editable,
}: {
  projectId: string;
  taskId: string;
  dependencies: DependencyItem[];
  options: TaskOption[];
  editable: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  const [choice, setChoice] = useState<string>("");

  return (
    <div className="space-y-3">
      {dependencies.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.dependencies.empty}</p>
      ) : (
        <ul className="space-y-2">
          {dependencies.map((dependency) => (
            <li key={dependency.taskId} className="flex items-center gap-2 text-sm">
              {dependency.done ? (
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-label={t.dependencies.done} />
              ) : (
                <Hourglass className="size-4 shrink-0 text-warning-foreground dark:text-warning" aria-label={t.dependencies.blocked} />
              )}
              <TaskCode code={dependency.code} />
              <Link href={`/projects/${projectId}/tasks/${dependency.taskId}`} className="min-w-0 flex-1 truncate hover:underline">
                {dependency.title}
              </Link>
              <TaskStatusBadge status={dependency.status} />
              {editable ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.dependencies.remove}
                  disabled={pending}
                  onClick={async () => {
                    const result = await run(() => removeTaskDependencyAction(taskId, dependency.taskId), {
                      success: t.dependencies.removed,
                    });
                    if (result?.ok) router.refresh();
                  }}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editable && options.length > 0 ? (
        <div className="flex gap-2">
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger className="min-w-0 flex-1" aria-label={t.dependencies.choose}>
              <SelectValue placeholder={t.dependencies.choose} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.code} · {option.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!choice || pending}
            onClick={async () => {
              const result = await run(() => addTaskDependencyAction(taskId, { dependsOn: choice }), {
                success: t.dependencies.added,
              });
              if (result?.ok) {
                setChoice("");
                router.refresh();
              }
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            {t.dependencies.add}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
