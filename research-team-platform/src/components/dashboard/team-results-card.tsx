"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";

import { TaskCode } from "@/components/shared/badges";
import { DateText } from "@/components/shared/date-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";
import type { PublicationItem } from "@/types/app";

export function TeamResultsCard({ items }: { items: PublicationItem[] }) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <span className="flex size-7 items-center justify-center rounded-md bg-success/15 text-success">
          <Megaphone className="size-4" aria-hidden />
        </span>
        <CardTitle className="text-base">{t.planner.teamResults}</CardTitle>
        <Link href="/results" className="ms-auto text-sm text-primary hover:underline">
          {t.common.viewAll}
        </Link>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t.results.empty}</p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.taskId} className="space-y-1 py-2.5 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-2">
                  <TaskCode code={item.code} />
                  <span dir="auto" className="min-w-0 flex-1 truncate text-sm font-medium">
                    {item.title}
                  </span>
                </div>
                <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{item.responsibleName ?? t.common.unknownUser}</span>
                  <DateText value={item.completedAt} className="tabular-nums" />
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
