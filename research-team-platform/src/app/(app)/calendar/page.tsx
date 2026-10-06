import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, FolderKanban } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { buildCalendarMonth } from "@/lib/calendar/month";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { getMyProjectsAccess } from "@/server/access";
import { requireSessionUser } from "@/server/auth";
import { appToday } from "@/server/queries/shared";
import { listTasks } from "@/server/queries/tasks";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.calendar.title };
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const user = await requireSessionUser();
  const [i18n, access, params] = await Promise.all([getI18n(), getMyProjectsAccess(), searchParams]);
  const { t, fmt } = i18n;
  if (!access.some((item) => can(item, "project.view"))) {
    return <EmptyState icon={FolderKanban} title={t.projects.title} description={t.projects.noProjectAccess} />;
  }

  const today = appToday();
  const month = buildCalendarMonth(params.month, today);
  const result = await listTasks(user.id, { dueFrom: month.start, dueTo: month.end, pageSize: 250 });
  const tasksByDate = new Map<string, typeof result.items>();
  for (const task of result.items) {
    if (!task.dueDate) continue;
    const key = task.dueDate.slice(0, 10);
    tasksByDate.set(key, [...(tasksByDate.get(key) ?? []), task]);
  }

  const monthDate = new Date(`${month.start}T00:00:00Z`);
  const monthLabel = new Intl.DateTimeFormat(i18n.locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthDate);
  const weekdays = Array.from({ length: 7 }, (_, weekday) => {
    const date = new Date(Date.UTC(2023, 0, 1 + weekday));
    return new Intl.DateTimeFormat(i18n.locale, { weekday: "short", timeZone: "UTC" }).format(date);
  });
  const weeks = Array.from({ length: month.cells.length / 7 }, (_, week) => month.cells.slice(week * 7, week * 7 + 7));
  const agendaDays = month.cells.filter((cell) => cell.inMonth && (tasksByDate.get(cell.date)?.length ?? 0) > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.calendar.title}
        description={`${t.calendar.subtitle} ${fmt(t.calendar.taskCount, { count: i18n.number(result.total) })}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/calendar?month=${month.previous}`} aria-label={t.calendar.previousMonth}>
                <ChevronLeft aria-hidden />
                <span className="hidden sm:inline">{t.calendar.previousMonth}</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/calendar?month=${month.next}`} aria-label={t.calendar.nextMonth}>
                <span className="hidden sm:inline">{t.calendar.nextMonth}</span>
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{monthLabel}</h2>
        {month.key !== today.slice(0, 7) ? (
          <Button asChild variant="ghost" size="sm">
            <Link href="/calendar">{t.calendar.currentMonth}</Link>
          </Button>
        ) : null}
      </div>

      {result.total > result.items.length ? (
        <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          {fmt(t.calendar.showingLimit, {
            shown: i18n.number(result.items.length),
            total: i18n.number(result.total),
          })}{" "}
          <Link href="/tasks" className="font-medium underline underline-offset-4">
            {t.nav.tasks}
          </Link>
        </p>
      ) : null}

      {result.items.length === 0 ? (
        <EmptyState icon={CalendarDays} title={t.calendar.noTasks} description={t.calendar.subtitle} />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <table className="w-full table-fixed border-collapse" aria-label={monthLabel}>
              <thead>
                <tr>
                  {weekdays.map((weekday, index) => (
                    <th
                      key={`${weekday}-${index}`}
                      scope="col"
                      className="border-b bg-muted/40 px-2 py-3 text-start text-xs font-medium text-muted-foreground"
                    >
                      {weekday}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, weekIndex) => (
                  <tr key={weekIndex}>
                    {week.map((cell) => {
                      const dueTasks = tasksByDate.get(cell.date) ?? [];
                      return (
                        <td
                          key={cell.date}
                          className={`h-32 border-e border-b p-2 align-top last:border-e-0 ${cell.inMonth ? "" : "bg-muted/20 text-muted-foreground/60"}`}
                        >
                          <time
                            dateTime={cell.date}
                            className={`mb-2 inline-flex size-7 items-center justify-center rounded-full text-xs ${
                              cell.date === today ? "bg-primary font-semibold text-primary-foreground" : "font-medium"
                            }`}
                          >
                            {i18n.number(cell.day)}
                          </time>
                          <ul className="space-y-1">
                            {dueTasks.slice(0, 3).map((task) => (
                              <li key={task.id}>
                                <Link
                                  href={`/projects/${task.projectId}/tasks/${task.id}`}
                                  title={`${task.title} · ${t.taskStatus[task.status]}`}
                                  className="block truncate rounded bg-primary/8 px-1.5 py-1 text-xs hover:bg-primary/15 hover:underline"
                                >
                                  {task.title}
                                </Link>
                              </li>
                            ))}
                            {dueTasks.length > 3 ? (
                              <li className="px-1 text-xs text-muted-foreground">
                                {fmt(t.calendar.moreTasks, { count: i18n.number(dueTasks.length - 3) })}
                              </li>
                            ) : null}
                          </ul>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {agendaDays.map((day) => (
              <Card key={day.date} className="p-4">
                <h3 className="mb-3 font-semibold">
                  <time dateTime={day.date}>{i18n.date(day.date)}</time>
                  {day.date === today ? <span className="ms-2 text-xs text-primary">{t.calendar.today}</span> : null}
                </h3>
                <ul className="space-y-2">
                  {(tasksByDate.get(day.date) ?? []).map((task) => (
                    <li key={task.id} className="border-s-2 border-primary/50 ps-3">
                      <Link
                        href={`/projects/${task.projectId}/tasks/${task.id}`}
                        className="font-medium hover:underline"
                      >
                        {task.title}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {task.projectName} · {t.taskStatus[task.status]}
                        {task.assignee ? ` · ${task.assignee.name}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
