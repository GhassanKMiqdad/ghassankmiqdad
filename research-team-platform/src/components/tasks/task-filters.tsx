"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/provider";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/permissions/catalog";
import { cn } from "@/lib/utils";

const ANY = "__any__";

/** One filter row above the list; every filter lives in the URL. */
export function TaskFilters({
  projects,
  teams,
  members,
  months = 3,
}: {
  projects?: { id: string; name: string }[];
  teams?: { id: string; name: string }[];
  members?: { id: string; name: string }[];
  /** Number of planning months offered in the month filter. */
  months?: number;
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const schedule = searchParams.get("schedule") ?? (searchParams.get("overdue") === "1" ? "overdue" : null);

  const update = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "schedule") params.delete("overdue");
    if (value === null || value === "" || value === ANY) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    startTransition(() => router.replace(params.size ? `${pathname}?${params}` : pathname));
  };

  // Debounced free-text search.
  useEffect(() => {
    const current = searchParams.get("q") ?? "";
    if (query === current) return;
    const timer = window.setTimeout(() => update("q", query.trim() || null), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const hasFilters = [
    "q",
    "status",
    "priority",
    "assignee",
    "project",
    "team",
    "month",
    "week",
    "schedule",
    "from",
    "to",
    "overdue",
  ].some((key) => searchParams.has(key));

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")}>
      <div className="relative w-full sm:w-64">
        <Search
          className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.tasks.placeholders.search}
          aria-label={t.common.search}
          className="ps-9"
        />
      </div>
      {projects && projects.length > 1 ? (
        <Select value={searchParams.get("project") ?? ANY} onValueChange={(value) => update("project", value)}>
          <SelectTrigger className="w-44" aria-label={t.tasks.fields.project}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t.tasks.filters.anyProject}</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {teams && teams.length > 1 ? (
        <Select value={searchParams.get("team") ?? ANY} onValueChange={(value) => update("team", value)}>
          <SelectTrigger className="w-40" aria-label={t.tasks.fields.team}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t.tasks.filters.anyTeam}</SelectItem>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Select value={searchParams.get("status") ?? ANY} onValueChange={(value) => update("status", value)}>
        <SelectTrigger className="w-40" aria-label={t.tasks.fields.status}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t.tasks.filters.anyStatus}</SelectItem>
          {TASK_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {t.taskStatus[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={searchParams.get("priority") ?? ANY} onValueChange={(value) => update("priority", value)}>
        <SelectTrigger className="w-40" aria-label={t.tasks.fields.priority}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t.tasks.filters.anyPriority}</SelectItem>
          {TASK_PRIORITIES.map((priority) => (
            <SelectItem key={priority} value={priority}>
              {t.taskPriority[priority]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={searchParams.get("assignee") ?? ANY} onValueChange={(value) => update("assignee", value)}>
        <SelectTrigger className="w-44" aria-label={t.tasks.fields.assignee}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t.tasks.filters.anyAssignee}</SelectItem>
          <SelectItem value="me">{t.tasks.filters.mine}</SelectItem>
          <SelectItem value="unassigned">{t.tasks.unassigned}</SelectItem>
          {(members ?? []).map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={searchParams.get("month") ?? ANY} onValueChange={(value) => update("month", value)}>
        <SelectTrigger className="w-32" aria-label={t.tasks.fields.planningMonth}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t.tasks.filters.anyMonth}</SelectItem>
          {Array.from({ length: Math.max(1, months) }, (_, index) => index + 1).map((month) => (
            <SelectItem key={month} value={String(month)}>
              {`M${String(month).padStart(2, "0")}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={searchParams.get("week") ?? ANY} onValueChange={(value) => update("week", value)}>
        <SelectTrigger className="w-32" aria-label={t.tasks.fields.planningWeek}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t.tasks.filters.anyWeek}</SelectItem>
          {[1, 2, 3, 4, 5].map((week) => (
            <SelectItem key={week} value={String(week)}>
              {fmt(t.tasks.week, { week })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={schedule ?? ANY} onValueChange={(value) => update("schedule", value)}>
        <SelectTrigger className="w-40" aria-label={t.tasks.fields.schedule}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t.tasks.filters.anySchedule}</SelectItem>
          <SelectItem value="overdue">{t.scheduleStatus.overdue}</SelectItem>
          <SelectItem value="due_soon">{t.scheduleStatus.due_soon}</SelectItem>
          <SelectItem value="unscheduled">{t.scheduleStatus.unscheduled}</SelectItem>
        </SelectContent>
      </Select>
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {t.tasks.filters.from}
        <Input
          type="date"
          dir="ltr"
          className="w-36"
          value={searchParams.get("from") ?? ""}
          onChange={(event) => update("from", event.target.value || null)}
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {t.tasks.filters.to}
        <Input
          type="date"
          dir="ltr"
          className="w-36"
          value={searchParams.get("to") ?? ""}
          onChange={(event) => update("to", event.target.value || null)}
        />
      </label>
      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setQuery("");
            startTransition(() => router.replace(pathname));
          }}
        >
          <X aria-hidden />
          {t.common.clearFilters}
        </Button>
      ) : null}
    </div>
  );
}
