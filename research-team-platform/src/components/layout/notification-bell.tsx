"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";

export function NotificationBell({ unread }: { unread: number }) {
  const { t, fmt, number } = useI18n();
  const label = unread > 0 ? `${t.notifications.open} (${fmt(t.notifications.unread, { count: number(unread) })})` : t.notifications.open;
  return (
    <Button variant="ghost" size="icon" asChild>
      <Link href="/notifications" aria-label={label} className="relative">
        <Bell aria-hidden />
        {unread > 0 ? (
          <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white tabular-nums">
            {unread > 99 ? "99+" : number(unread)}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
