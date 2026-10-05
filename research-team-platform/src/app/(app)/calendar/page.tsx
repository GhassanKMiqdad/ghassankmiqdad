import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { calendarRange, type CalendarView, listAuthorizedCalendarEvents } from "@/server/queries/calendar";

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date().toISOString().slice(0, 10);
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : new Date().toISOString().slice(0, 10);
}

function shiftDate(value: string, view: CalendarView, direction: -1 | 1) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (view === "day") date.setUTCDate(date.getUTCDate() + direction);
  else if (view === "week") date.setUTCDate(date.getUTCDate() + direction * 7);
  else date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}

export default async function CalendarPage(props: PageProps<"/calendar">) {
  const params = await props.searchParams;
  const view: CalendarView = params.view === "day" || params.view === "week" ? params.view : "month";
  const date = validDate(typeof params.date === "string" ? params.date : undefined);
  const range = calendarRange(view, date);
  const events = await listAuthorizedCalendarEvents(range.from, range.to);
  const grouped = new Map<string, typeof events>();
  for (const event of events) grouped.set(event.date, [...(grouped.get(event.date) ?? []), event]);
  const shift = (direction: -1 | 1) => `/calendar?view=${view}&date=${shiftDate(date, view, direction)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Research calendar"
        description="Project, task and milestone dates within your authorized project scope."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1" aria-label="Calendar view">
          {(["day", "week", "month"] as const).map((item) => (
            <Button key={item} variant={view === item ? "default" : "outline"} size="sm" asChild>
              <Link href={`/calendar?view=${item}&date=${date}`} aria-current={view === item ? "page" : undefined}>
                {item[0]!.toUpperCase() + item.slice(1)}
              </Link>
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" asChild aria-label="Previous period">
            <Link href={shift(-1)}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <time className="min-w-36 text-center text-sm font-medium" dateTime={range.from}>
            {range.from === range.to ? range.from : `${range.from} — ${range.to}`}
          </time>
          <Button variant="outline" size="icon" asChild aria-label="Next period">
            <Link href={shift(1)}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
      {grouped.size ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[...grouped.entries()].map(([day, dayEvents]) => (
            <Card key={day}>
              <CardHeader>
                <CardTitle className="text-base">{day}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {dayEvents.map((event) => (
                  <Link
                    key={event.id}
                    href={event.href}
                    className="flex items-start gap-3 rounded-md border p-3 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0">
                      <span className="block font-medium">{event.title}</span>
                      <span className="text-xs text-muted-foreground">{event.kind.replaceAll("_", " ")}</span>
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No authorized project or task events in this period.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
