"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { updateTaskAction } from "@/server/actions/tasks";

export function TaskProgressEditor({
  taskId,
  progress,
  workNotes,
  canUpdateProgress,
  canAddWorkNotes,
}: {
  taskId: string;
  progress: number;
  workNotes: string;
  canUpdateProgress: boolean;
  canAddWorkNotes: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  const [nextProgress, setNextProgress] = useState(progress);
  const [nextNotes, setNextNotes] = useState(workNotes);

  async function save() {
    const patch: { progress?: number; workNotes?: string } = {};
    if (canUpdateProgress) patch.progress = nextProgress;
    if (canAddWorkNotes) patch.workNotes = nextNotes;
    const result = await run(() => updateTaskAction(taskId, patch), { success: t.tasks.progressSaved });
    if (result?.ok) router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.tasks.myWork}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canUpdateProgress ? (
          <label className="block space-y-2 text-sm">
            <span className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t.tasks.fields.progress}</span>
              <span className="tabular-nums">{nextProgress}%</span>
            </span>
            <Input
              type="range"
              min={0}
              max={100}
              step={5}
              value={nextProgress}
              onChange={(event) => setNextProgress(Number(event.target.value))}
              aria-label={t.tasks.fields.progress}
            />
          </label>
        ) : null}
        {canAddWorkNotes ? (
          <label className="block space-y-2 text-sm">
            <span className="text-muted-foreground">{t.tasks.fields.workNotes}</span>
            <Textarea
              value={nextNotes}
              onChange={(event) => setNextNotes(event.target.value)}
              maxLength={10000}
              rows={4}
              dir="auto"
            />
          </label>
        ) : null}
        <div className="flex justify-end">
          <Button type="button" disabled={pending} onClick={() => void save()}>
            {t.tasks.saveProgress}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
