"use client";

import { useRouter } from "next/navigation";
import { Check, CheckCheck } from "lucide-react";

import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/server/actions/notifications";

export function MarkReadButton({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t.notifications.markRead}
      disabled={pending}
      onClick={async () => {
        const result = await run(() => markNotificationReadAction(id));
        if (result?.ok) router.refresh();
      }}
    >
      <Check aria-hidden />
    </Button>
  );
}

export function MarkAllReadButton() {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={async () => {
        const result = await run(() => markAllNotificationsReadAction());
        if (result?.ok) router.refresh();
      }}
    >
      <CheckCheck aria-hidden />
      {t.notifications.markAllRead}
    </Button>
  );
}
