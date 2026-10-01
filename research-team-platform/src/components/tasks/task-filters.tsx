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
  members,
}: {
  projects?: { id: string; name: string }[];
  members?: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  const update = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
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

  const hasFilters = ["q", "status", "priority", "assignee", "project", "overdue"].some((key) => searchParams.has(key));

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
      <Button
        type="button"
        variant={searchParams.get("overdue") === "1" ? "secondary" : "outline"}
        aria-pressed={searchParams.get("overdue") === "1"}
        onClick={() => update("overdue", searchParams.get("overdue") === "1" ? null : "1")}
      >
        {t.tasks.filters.overdue}
      </Button>
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
