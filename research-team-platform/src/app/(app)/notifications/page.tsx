import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";

import { MarkAllReadButton, MarkReadButton } from "@/components/notifications/mark-read";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { RelativeTime } from "@/components/shared/date-text";
import { Card, CardContent } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { describeNotification } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { requireSessionUser } from "@/server/auth";
import { listNotifications } from "@/server/queries/notifications";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.notifications.title };
}

export default async function NotificationsPage() {
  await requireSessionUser();
  const [{ t }, items] = await Promise.all([getI18n(), listNotifications(100)]);
  const unread = items.filter((item) => !item.readAt).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.notifications.title}
        description={t.notifications.subtitle}
        actions={unread > 0 ? <MarkAllReadButton /> : null}
      />
      {items.length === 0 ? (
        <EmptyState icon={Bell} title={t.notifications.empty} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {items.map((item) => {
                const sentence = describeNotification(t, item, t.common.unknownUser);
                const href = item.projectId && item.taskId ? `/projects/${item.projectId}/tasks/${item.taskId}` : null;
                return (
                  <li key={item.id} className={cn("flex items-start gap-3 px-4 py-3", !item.readAt && "bg-primary/5")}>
                    <span
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.readAt ? "bg-transparent" : "bg-primary")}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      {href && item.type !== "task_published" ? (
                        <Link href={href} dir="auto" className="block text-sm hover:underline">
                          {sentence}
                        </Link>
                      ) : item.type === "task_published" ? (
                        <Link href="/results" dir="auto" className="block text-sm hover:underline">
                          {sentence}
                        </Link>
                      ) : (
                        <p dir="auto" className="text-sm">
                          {sentence}
                        </p>
                      )}
                      <RelativeTime value={item.createdAt} className="text-xs text-muted-foreground" />
                    </div>
                    {!item.readAt ? <MarkReadButton id={item.id} /> : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
