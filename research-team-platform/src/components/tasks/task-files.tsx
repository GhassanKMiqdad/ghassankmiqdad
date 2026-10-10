"use client";

import { useRouter } from "next/navigation";
import { Lock, Trash2 } from "lucide-react";

import { UploadDocumentDialog } from "@/components/documents/upload-document-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useServerAction } from "@/components/shared/use-action";
import { TaskFileList } from "@/components/tasks/task-file-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { deleteDocumentAction } from "@/server/actions/documents";
import type { TaskFileItem } from "@/types/app";

/**
 * Private files of a task. Rights are computed on the server (and enforced
 * again by the database): files handed in with a version are locked.
 */
export function TaskFiles({
  projectId,
  taskId,
  files,
  lockedIds,
  removableIds,
  canUpload,
}: {
  projectId: string;
  taskId: string;
  files: TaskFileItem[];
  lockedIds: string[];
  removableIds: string[];
  canUpload: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();

  return (
    <div className="space-y-3">
      {files.length === 0 ? <p className="text-sm text-muted-foreground">{t.taskFiles.empty}</p> : null}
      <TaskFileList
        files={files}
        actions={(file) =>
          lockedIds.includes(file.id) ? (
            <Badge variant="secondary" className="gap-1" title={t.taskFiles.lockedHint}>
              <Lock aria-hidden />
              {t.taskFiles.locked}
            </Badge>
          ) : removableIds.includes(file.id) ? (
            <ConfirmDialog
              title={t.taskFiles.removeTitle}
              description={t.taskFiles.removeDescription}
              confirmLabel={t.taskFiles.remove}
              destructive
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  disabled={pending}
                  aria-label={t.taskFiles.remove}
                  title={t.taskFiles.remove}
                >
                  <Trash2 aria-hidden />
                </Button>
              }
              onConfirm={async () => {
                const result = await run(() => deleteDocumentAction(file.id), { success: t.taskFiles.removed });
                if (result?.ok) router.refresh();
                return !!result?.ok;
              }}
            />
          ) : null
        }
      />
      {canUpload ? <UploadDocumentDialog projectId={projectId} taskId={taskId} label={t.taskFiles.upload} /> : null}
    </div>
  );
}
