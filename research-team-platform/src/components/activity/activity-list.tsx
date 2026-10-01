"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Globe, Monitor } from "lucide-react";

import { RelativeTime } from "@/components/shared/date-text";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { activityChanges, activityReason, describeActivity } from "@/lib/activity";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { ActivityItem } from "@/types/app";

export function ActivityList({
  items,
  showProject = false,
  compact = false,
}: {
  items: ActivityItem[];
  showProject?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t.activity.empty}</p>;
  }
  return (
    <ol className="relative space-y-1">
      {items.map((item) => (
        <ActivityRow key={item.id} item={item} showProject={showProject} compact={compact} />
      ))}
    </ol>
  );
}

function ActivityRow({ item, showProject, compact }: { item: ActivityItem; showProject: boolean; compact: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [open, setOpen] = useState(false);
  const changes = activityChanges(item, { t, date: (value) => i18n.date(value), locale: i18n.locale });
  const reason = activityReason(item, t);
  const hasDetails = !compact && (changes.length > 0 || !!item.ipAddress || !!item.userAgent);

  return (
    <li className="rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50">
      <div className="flex items-start gap-3">
        <UserAvatar
          name={item.actorName ?? t.common.system}
          seed={item.actorId ?? "system"}
          className="mt-0.5 size-7"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm leading-relaxed">{describeActivity(item, t)}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <RelativeTime value={item.createdAt} />
            {showProject && item.projectId ? (
              item.projectName ? (
                <Link href={`/projects/${item.projectId}`} className="hover:text-foreground hover:underline">
                  {item.projectName}
                </Link>
              ) : (
                <span>{t.activity.meta.deletedProject}</span>
              )
            ) : null}
            {reason ? <Badge variant="muted">{reason}</Badge> : null}
            {hasDetails ? (
              <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                aria-expanded={open}
              >
                {open ? t.activity.hideDetails : t.activity.showDetails}
                <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden />
              </button>
            ) : null}
          </div>

          {open ? (
            <div className="mt-2 space-y-2 rounded-md border bg-card p-3">
              {changes.length > 0 ? (
                <dl className="space-y-2 text-xs">
                  {changes.map((change) => (
                    <div key={change.field} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                      <dt className="font-medium text-muted-foreground">{change.label}</dt>
                      <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        {change.before !== null || item.oldValues ? (
                          <span className="rounded bg-destructive/8 px-1.5 py-0.5 break-words text-foreground/80 line-through decoration-destructive/40">
                            <span className="sr-only">{t.activity.old}: </span>
                            {change.before ?? "—"}
                          </span>
                        ) : null}
                        {item.newValues ? (
                          <>
                            <span aria-hidden className="text-muted-foreground rtl:rotate-180">
                              →
                            </span>
                            <span className="rounded bg-success/10 px-1.5 py-0.5 break-words">
                              <span className="sr-only">{t.activity.new}: </span>
                              {change.after ?? "—"}
                            </span>
                          </>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {item.ipAddress || item.userAgent ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
                  {item.ipAddress ? (
                    <span className="inline-flex items-center gap-1" dir="ltr">
                      <Globe className="size-3" aria-hidden />
                      {t.activity.meta.ip}: {item.ipAddress}
                    </span>
                  ) : null}
                  {item.userAgent ? (
                    <span className="inline-flex min-w-0 items-center gap-1" dir="ltr">
                      <Monitor className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{item.userAgent}</span>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
