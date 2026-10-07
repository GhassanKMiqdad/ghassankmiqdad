import type { Metadata } from "next";
import Link from "next/link";
import { CalendarX2, ChevronLeft, ChevronRight, Flag, Play } from "lucide-react";

import { ScheduleFilters } from "@/components/schedule/schedule-filters";
import { PageHeader } from "@/components/shared/page-header";
import { TaskCode } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { getAppTimeZone } from "@/lib/env.server";
import { intlLocaleOf } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { can, canAssignTasks } from "@/lib/permissions/policy";
import { addDays, isoToZonedDate, isoToZonedLocal, startOfWeek, zonedDayRange } from "@/lib/schedule";
import { parseScheduleSearchParams } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { getMyProjectsAccess } from "@/server/access";
import { requireSessionUser } from "@/server/auth";
import { appToday } from "@/server/queries/shared";
import { countUnscheduledTasks, listAssignableMembers, listTasksInRange } from "@/server/queries/tasks";
import { listTeams } from "@/server/queries/teams";
import type { TaskListItem } from "@/types/app";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.schedule.title };
}

type CalendarEvent = { kind: "start" | "due"; task: TaskListItem; time: string };

const PRIORITY_DOT = { p0: "bg-destructive", p1: "bg-warning", p2: "bg-info", p3: "bg-muted-foreground/60" } as const;

export default async function SchedulePage(props: PageProps<"/schedule">) {
  const user = await requireSessionUser();
  const raw = await props.searchParams;
  const filters = parseScheduleSearchParams(raw);
  const timeZone = getAppTimeZone();
  const [i18n, access, teams] = await Promise.all([getI18n(), getMyProjectsAccess(), listTeams()]);
  const { t, fmt, locale } = i18n;

  const today = appToday();
  const anchor = filters.date ?? today;
  const monthFirst = `${anchor.slice(0, 7)}-01`;
  const gridStart = filters.view === "week" ? startOfWeek(anchor) : startOfWeek(monthFirst);
  const days = filters.view === "week" ? 7 : 42;
  const gridEnd = addDays(gridStart, days);
  const range = zonedDayRange(gridStart, gridEnd, timeZone);

  const projects = access.filter((item) => can(item, "project.view"));
  const memberSource = filters.project ? projects.find((item) => item.projectId === filters.project) : undefined;
  const [tasks, unscheduled, members] = await Promise.all([
    range.from && range.to
      ? listTasksInRange(user.id, { from: range.from, to: range.to }, filters)
      : Promise.resolve([] as TaskListItem[]),
    countUnscheduledTasks({ projectId: filters.project, teamId: filters.team }),
    memberSource && (can(memberSource, "team.view") || canAssignTasks(memberSource))
      ? listAssignableMembers(memberSource.projectId)
      : Promise.resolve([]),
  ]);

  const byDay = new Map<string, CalendarEvent[]>();
  const push = (day: string, event: CalendarEvent) => byDay.set(day, [...(byDay.get(day) ?? []), event]);
  for (const task of tasks) {
    if (task.plannedStartAt) {
      push(isoToZonedDate(task.plannedStartAt, timeZone), {
        kind: "start",
        task,
        time: isoToZonedLocal(task.plannedStartAt, timeZone).slice(11),
      });
    }
    if (task.dueAt) {
      push(isoToZonedDate(task.dueAt, timeZone), {
        kind: "due",
        task,
        time: isoToZonedLocal(task.dueAt, timeZone).slice(11),
      });
    }
  }
  for (const events of byDay.values()) events.sort((a, b) => a.time.localeCompare(b.time));

  const intl = intlLocaleOf(locale);
  const title =
    filters.view === "week"
      ? `${new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${gridStart}T00:00:00Z`))} – ${new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${addDays(gridStart, 6)}T00:00:00Z`))}`
      : new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(
          new Date(`${monthFirst}T00:00:00Z`),
        );

  const step = (direction: 1 | -1) => {
    if (filters.view === "week") return addDays(anchor, 7 * direction);
    const [y, m] = monthFirst.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1 + direction, 1));
    return next.toISOString().slice(0, 10);
  };
  const link = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = {
      view: filters.view,
      date: filters.date,
      project: filters.project,
      team: filters.team,
      assignee: filters.assignee,
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    return `/schedule?${params}`;
  };

  const weekdays = t.schedule.weekdays.split(",");
  const dayNumber = new Intl.DateTimeFormat(intl, { day: "numeric", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      <PageHeader title={t.schedule.title} description={t.schedule.subtitle} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" asChild>
            <Link href={link({ date: step(-1) })} aria-label={t.schedule.previous}>
              <ChevronLeft className="rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={link({ date: undefined })}>{t.schedule.today}</Link>
          </Button>
          <Button variant="outline" size="icon" asChild>
            <Link href={link({ date: step(1) })} aria-label={t.schedule.next}>
              <ChevronRight className="rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        </div>
        <h2 className="min-w-40 text-lg font-semibold">{title}</h2>
        <div className="ms-auto flex rounded-md border p-0.5" role="group" aria-label={t.schedule.title}>
          {(["month", "week"] as const).map((view) => (
            <Link
              key={view}
              href={link({ view })}
              aria-current={filters.view === view ? "page" : undefined}
              className={cn(
                "rounded px-3 py-1 text-sm",
                filters.view === view
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.schedule[view]}
            </Link>
          ))}
        </div>
      </div>

      <ScheduleFilters
        projects={projects.map((item) => ({ id: item.projectId, name: item.projectName }))}
        teams={teams.map((team) => ({ id: team.id, name: team.name }))}
        members={members.map((member) => ({ id: member.id, name: member.name }))}
      />

      {unscheduled > 0 ? (
        <Link
          href="/tasks?schedule=unscheduled"
          className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground hover:bg-muted/50"
        >
          <CalendarX2 className="size-4 shrink-0" aria-hidden />
          <span className="font-medium text-foreground">{t.schedule.unscheduledTitle}:</span>
          {fmt(t.schedule.unscheduledHint, { count: i18n.number(unscheduled) })}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1.5">
          <Play className="size-3" /> {t.schedule.starts}
        </span>
        <span className="flex items-center gap-1.5">
          <Flag className="size-3" /> {t.schedule.due}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <div className={cn("grid min-w-[56rem] grid-cols-7", filters.view === "week" && "min-w-[64rem]")}>
          {weekdays.map((name) => (
            <div key={name} className="border-b px-2 py-2 text-xs font-medium text-muted-foreground">
              {name}
            </div>
          ))}
          {Array.from({ length: days }, (_, index) => {
            const day = addDays(gridStart, index);
            const events = byDay.get(day) ?? [];
            const outside = filters.view === "month" && day.slice(0, 7) !== monthFirst.slice(0, 7);
            const limit = filters.view === "week" ? 50 : 4;
            return (
              <div
                key={day}
                className={cn(
                  "space-y-1 border-e border-b p-1.5 [&:nth-child(7n)]:border-e-0",
                  filters.view === "week" ? "min-h-80" : "min-h-28",
                  outside && "bg-muted/30",
                )}
              >
                <div className="flex justify-end">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                      day === today
                        ? "bg-primary font-semibold text-primary-foreground"
                        : outside
                          ? "text-muted-foreground/60"
                          : "text-muted-foreground",
                    )}
                  >
                    {dayNumber.format(new Date(`${day}T00:00:00Z`))}
                  </span>
                </div>
                {events.slice(0, limit).map((event) => {
                  const Icon = event.kind === "start" ? Play : Flag;
                  return (
                    <Link
                      key={`${event.kind}-${event.task.id}`}
                      href={`/projects/${event.task.projectId}/tasks/${event.task.id}`}
                      title={`${event.task.code} · ${event.task.title} — ${event.kind === "start" ? t.schedule.starts : t.schedule.due} ${event.time}`}
                      className={cn(
                        "block rounded-md border px-1.5 py-1 text-[11px] leading-tight hover:bg-muted",
                        event.kind === "due" &&
                          event.task.scheduleStatus === "overdue" &&
                          "border-destructive/50 bg-destructive/5",
                        event.task.status === "completed" && "opacity-60",
                      )}
                    >
                      <span className="flex items-center gap-1">
                        <span
                          className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[event.task.priority])}
                          aria-hidden
                        />
                        <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="text-muted-foreground tabular-nums" dir="ltr">
                          {event.time}
                        </span>
                        <TaskCode code={event.task.code} className="px-1 py-0 text-[10px]" />
                      </span>
                      <span dir="auto" className="mt-0.5 block truncate font-medium">
                        {event.task.title}
                      </span>
                      {filters.view === "week" && event.task.responsibleName ? (
                        <span className="block truncate text-muted-foreground">{event.task.responsibleName}</span>
                      ) : null}
                    </Link>
                  );
                })}
                {events.length > limit ? (
                  <Link
                    href={link({ view: "week", date: day })}
                    className="block px-1 text-[11px] text-primary hover:underline"
                  >
                    +{i18n.number(events.length - limit)}
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {tasks.length === 0 ? <p className="text-sm text-muted-foreground">{t.schedule.noTasks}</p> : null}
    </div>
  );
}
