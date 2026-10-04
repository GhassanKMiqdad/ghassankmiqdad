"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { markNotificationReadAction } from "@/server/actions/notifications";
import type { NotificationItem } from "@/types/app";

export function NotificationBell({ initialItems }: { initialItems: NotificationItem[] }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState(initialItems);
  const [open, setOpen] = useState(false);
  const unread = items.filter((item) => !item.readAt).length;

  const markRead = async (item: NotificationItem) => {
    if (item.readAt) return;
    const result = await markNotificationReadAction(item.id);
    if (result.ok)
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry)),
      );
  };

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t.notifications.title}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell aria-hidden />
        {unread > 0 ? (
          <span className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4 text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </Button>
      {open ? (
        <section
          className="absolute end-0 top-11 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
          aria-label={t.notifications.title}
        >
          <h2 className="px-3 py-2 text-sm font-semibold">{t.notifications.title}</h2>
          {items.length === 0 ? (
            <p className="px-3 py-5 text-center text-sm text-muted-foreground">{t.notifications.empty}</p>
          ) : (
            <ul className="max-h-[min(70vh,28rem)] overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={() => {
                      void markRead(item);
                      setOpen(false);
                    }}
                    className={`block rounded-lg px-3 py-2.5 text-start hover:bg-muted ${item.readAt ? "" : "bg-primary/5"}`}
                  >
                    <span className="flex items-start gap-2">
                      <span
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${item.readAt ? "bg-muted-foreground/30" : "bg-primary"}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{t.notifications[item.type]}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground" dir="auto">
                          {item.taskTitle}
                        </span>
                        <time className="mt-1 block text-[11px] text-muted-foreground" dateTime={item.createdAt}>
                          {new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(item.createdAt))}
                        </time>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
