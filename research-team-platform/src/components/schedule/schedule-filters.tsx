"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

const ANY = "__any__";

export function ScheduleFilters({
  projects,
  teams,
  members,
}: {
  projects: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  members: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === ANY) params.delete(key);
    else params.set(key, value);
    if (key === "project") params.delete("assignee");
    startTransition(() => router.replace(params.size ? `${pathname}?${params}` : pathname));
  };

  return (
    <div className={cn("flex flex-wrap gap-2 transition-opacity", pending && "opacity-60")}>
      {projects.length > 1 ? (
        <Select value={searchParams.get("project") ?? ANY} onValueChange={(value) => update("project", value)}>
          <SelectTrigger className="w-48" aria-label={t.tasks.fields.project}>
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
      {teams.length > 1 ? (
        <Select value={searchParams.get("team") ?? ANY} onValueChange={(value) => update("team", value)}>
          <SelectTrigger className="w-44" aria-label={t.tasks.fields.team}>
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
      <Select value={searchParams.get("assignee") ?? ANY} onValueChange={(value) => update("assignee", value)}>
        <SelectTrigger className="w-44" aria-label={t.tasks.fields.assignee}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t.tasks.filters.anyAssignee}</SelectItem>
          <SelectItem value="me">{t.tasks.filters.mine}</SelectItem>
          {members.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
