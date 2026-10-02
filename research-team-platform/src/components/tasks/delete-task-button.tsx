"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useServerAction } from "@/components/shared/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { deleteTaskAction } from "@/server/actions/tasks";

export function DeleteTaskButton({
  taskId,
  trigger,
  redirectTo,
}: {
  taskId: string;
  trigger: ReactNode;
  redirectTo?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { run } = useServerAction();

  return (
    <ConfirmDialog
      trigger={trigger}
      title={t.tasks.deleteTitle}
      description={t.tasks.deleteDescription}
      confirmLabel={t.common.delete}
      onConfirm={async () => {
        const result = await run(() => deleteTaskAction(taskId), { success: t.tasks.deleted });
        if (result?.ok && redirectTo) router.push(redirectTo);
        return !!result?.ok;
      }}
    />
  );
}
